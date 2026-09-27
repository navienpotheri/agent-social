import type { AspRecord, JobSnapshot } from "@agent-social/asp-core";

export const GENESIS_LOG_HASH = `sha256:${"0".repeat(64)}`;

export interface LogHead {
  seq: number;
  logHash: string;
}

export interface StoredRecord {
  seq: number;
  id: string;
  /** id of the first record in this record's chain. */
  chain: string;
  logHash: string;
  /** When the log accepted the record (ISO 8601). Replays use it as the clock. */
  appendedAt: string;
  record: AspRecord;
}

export interface ChainRow {
  root: string;
  /** Short type of the root record. "contract" means a job chain. */
  kind: string;
  head: string;
  length: number;
  lastIssuedAt: string;
  state: string | null;
  snapshot: JobSnapshot | null;
}

export interface KeyRow {
  kid: string;
  did: string;
  publicKey: string;
  /** "passport": one of the person's own keys. "node": a delegated key for one node. */
  kind: "passport" | "node";
  /** The passport or Node record that granted the key. */
  grantedBy: string;
  revokedAt: string | null;
  /** Node keys only. */
  expiresAt: string | null;
  /** Node keys working under a Mandate. */
  mandate: string | null;
}

export interface PassportRow {
  did: string;
  head: string;
  sponsor: string | null;
  fleet: string | null;
}

export interface FleetRow {
  did: string;
  head: string;
  org: string;
  name: string;
  maxMembers: number | null;
}

/**
 * The current probation window for a DID (decision D2), derived from lineage `update` records that
 * carry `probation_until`. Nothing is enforced against it yet — no self-modification pathway exists
 * to enforce it on — but it is tracked so that pathway can check it once it does (docs/backlog.md).
 */
export interface ProbationRow {
  did: string;
  until: string;
  /** The lineage record that set this window. */
  setBy: string;
}

/**
 * A DID's credit balance (the Bank ledger). v0.1 has one unit ("credit"), so this is a single
 * integer per DID. Moved by `projectBond`/`projectSettlement`.
 */
export interface AccountRow {
  did: string;
  balance: number;
}

/**
 * Cumulative credits ever minted to a DID by `EventLog.mint` — local, unsigned, un-replayed
 * test/bootstrap infrastructure (see MOCKS.md), since a closed-loop ledger still needs some way
 * to get the first credits into an account. Tracked separately from the live balance so
 * `EventLog.verify()`/`verifyCheckpoint()` can seed their replay with "everything ever minted" as
 * each DID's starting balance (assuming a mint always precedes whatever record spends it, true of
 * the actual append order, since the live append would have failed insufficient_balance otherwise)
 * rather than with the live, already-spent-from current balance, which would double-count.
 */
export interface MintRow {
  did: string;
  totalMinted: number;
}

/**
 * What a Bond locked for one contract, so Settlement can be checked against it: it may not
 * release, return or slash more than was actually locked. Cleared (not deleted) once settled.
 */
export interface EscrowRow {
  contract: string;
  escrowPayer: string;
  escrowLocked: number;
  backer: string;
  bondLocked: number;
  settled: boolean;
}

/**
 * A DID's self-registered stake to be randomly drawn onto a dispute's ruling panel (Courts,
 * `asp.juror/v0.2`). `staked` moves real credits: a later Juror record chained onto the first
 * locks more (debit) or returns some/all (credit) — see `EventLog.projectJuror`.
 */
export interface JurorRow {
  did: string;
  head: string;
  staked: number;
}

/** Reads and writes inside one append. Writes become visible only if the transaction commits. */
export interface LogTx {
  logHead(): Promise<LogHead>;
  getRecord(id: string): Promise<StoredRecord | undefined>;
  getChain(root: string): Promise<ChainRow | undefined>;
  getKey(kid: string): Promise<KeyRow | undefined>;
  keysForDid(did: string): Promise<KeyRow[]>;
  nodeKeysForMandate(mandate: string): Promise<KeyRow[]>;
  getPassport(did: string): Promise<PassportRow | undefined>;
  getFleet(did: string): Promise<FleetRow | undefined>;
  fleetMembers(fleet: string): Promise<PassportRow[]>;
  getProbation(did: string): Promise<ProbationRow | undefined>;
  getAccount(did: string): Promise<AccountRow | undefined>;
  getEscrow(contract: string): Promise<EscrowRow | undefined>;
  getMint(did: string): Promise<MintRow | undefined>;
  getJuror(did: string): Promise<JurorRow | undefined>;
  activeJurors(): Promise<JurorRow[]>;

  insertRecord(row: StoredRecord): Promise<void>;
  putChain(row: ChainRow): Promise<void>;
  putKey(row: KeyRow): Promise<void>;
  putPassport(row: PassportRow): Promise<void>;
  putFleet(row: FleetRow): Promise<void>;
  putProbation(row: ProbationRow): Promise<void>;
  putAccount(row: AccountRow): Promise<void>;
  putEscrow(row: EscrowRow): Promise<void>;
  putMint(row: MintRow): Promise<void>;
  putJuror(row: JurorRow): Promise<void>;
  setLogHead(head: LogHead): Promise<void>;
}

/** Storage behind an EventLog. Appends run one at a time; reads may run concurrently. */
export interface Store {
  /** Runs fn with exclusive append access; commits if it resolves, rolls back if it throws. */
  transaction<T>(fn: (tx: LogTx) => Promise<T>): Promise<T>;
  logHead(): Promise<LogHead>;
  getRecord(id: string): Promise<StoredRecord | undefined>;
  getChain(root: string): Promise<ChainRow | undefined>;
  chainRecords(root: string): Promise<StoredRecord[]>;
  /** Records with seq > afterSeq, in log order. */
  since(afterSeq: number, limit: number): Promise<StoredRecord[]>;
  getPassport(did: string): Promise<PassportRow | undefined>;
  getFleet(did: string): Promise<FleetRow | undefined>;
  fleetMembers(fleet: string): Promise<PassportRow[]>;
  getProbation(did: string): Promise<ProbationRow | undefined>;
  keysForDid(did: string): Promise<KeyRow[]>;
  getAccount(did: string): Promise<AccountRow | undefined>;
  getEscrow(contract: string): Promise<EscrowRow | undefined>;
  /** Every DID's cumulative minted total, as {did, balance}. Used to seed verify()'s replay. */
  allMints(): Promise<AccountRow[]>;
  getJuror(did: string): Promise<JurorRow | undefined>;
  activeJurors(): Promise<JurorRow[]>;
  close(): Promise<void>;
}
