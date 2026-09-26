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

  insertRecord(row: StoredRecord): Promise<void>;
  putChain(row: ChainRow): Promise<void>;
  putKey(row: KeyRow): Promise<void>;
  putPassport(row: PassportRow): Promise<void>;
  putFleet(row: FleetRow): Promise<void>;
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
  keysForDid(did: string): Promise<KeyRow[]>;
  close(): Promise<void>;
}
