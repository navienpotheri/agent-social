import {
  AspError, Job, b64urlDecode, defaultSchemas, didOf, sha256Id, shortType, verifyRecord,
  type AspRecord, type JobSnapshot, type KeyResolver, type SchemaSet,
} from "@agent-social/asp-core";
import { MemoryStore } from "./memory.ts";
import { DEFAULT_PANEL_SIZE, drawPanel, findRejection } from "./panel.ts";
import type { ChainRow, KeyRow, LogHead, LogTx, Store, StoredRecord } from "./store.ts";

/** Record types that exist only inside a job chain. */
const JOB_ONLY_TYPES = new Set(["contract", "bond", "mandate", "checkpoint", "delivery", "settlement"]);
/** Records that change identity. Only a person's own (passport) keys may sign them. */
const IDENTITY_TYPES = new Set(["passport", "fleet", "node"]);

const DEFAULT_MAX_NODE_TTL_MS = 24 * 60 * 60 * 1000;
/** Deterrence (docs/backlog.md "Making a slash actually matter"): tunable constants, a judgment
 * call like probation's 7 days, not a formula derived from anything. Per own slash, and per other
 * live fleet-mate's slash, how many extra permille of the contract price the next Bond must cover. */
const RISK_PERMILLE_PER_OWN_SLASH = 250;
const RISK_PERMILLE_PER_FLEET_SLASH = 100;
/**
 * Decided 2026-09-28: Settlement `fees` credit here — a local mock for a real platform/Insurer
 * account, same trust boundary as the mocked bank/panel DIDs in conformance/generate.ts (MOCKS.md).
 * No passport is required for a DID to hold a ledger balance (see `credit`), so this needs no
 * registration; it's just an account id.
 */
export const PLATFORM_DID = "did:web:asp.local:platform";

export interface EventLogOptions {
  schemas?: SchemaSet;
  /**
   * Consulted when a kid is not in the registry. For tests and for keys vouched for outside the log.
   * Mocked registry (MOCKS.md #9): did:web documents are not fetched yet.
   */
  fallbackResolver?: KeyResolver;
  /** Clock for appendedAt and node-key expiry. Defaults to the system clock. */
  now?: () => Date;
  /** Longest lifetime a Node record may grant. Default 24 hours. */
  maxNodeTtlMs?: number;
  /** How many jurors a Courts ruling panel draws. Default 3 (see panel.ts, DEFAULT_PANEL_SIZE). */
  panelSize?: number;
}

export interface AppendResult {
  seq: number;
  id: string;
  chain: string;
  logHash: string;
  /** Job state after this record, for job chains. */
  state: string | null;
  /** True if the record was already in the log; nothing was written. */
  duplicate: boolean;
}

export interface VerifyReport {
  ok: boolean;
  records: number;
  head: LogHead;
  /** First problem found, if any. */
  error?: { seq: number; id: string; code: string; message: string };
}

/** sha256 over the previous log hash and the new record id. */
export function nextLogHash(prev: string, id: string): string {
  return sha256Id(new TextEncoder().encode(`${prev}\n${id}`));
}

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
/** How well established a claim is, for comparing a verifier's grade with the performer's declared one. */
const GRADE_RANK: Record<string, number> = { measured: 3, simulated: 2, predicted: 1, unverified: 0 };
const after = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/**
 * The append-only signed event log. Every record is verified before it is stored; chains are
 * linear (one successor per record); job chains must follow the ASP lifecycle; passport, fleet
 * and node records maintain the registry. A running hash over record ids makes the order tamper-evident.
 */
export class EventLog {
  readonly store: Store;
  private readonly schemas: SchemaSet;
  private readonly fallback?: KeyResolver;
  private readonly now: () => Date;
  private readonly maxNodeTtlMs: number;
  private readonly panelSize: number;

  constructor(store: Store, opts: EventLogOptions = {}) {
    this.store = store;
    this.schemas = opts.schemas ?? defaultSchemas();
    this.fallback = opts.fallbackResolver;
    this.now = opts.now ?? (() => new Date());
    this.maxNodeTtlMs = opts.maxNodeTtlMs ?? DEFAULT_MAX_NODE_TTL_MS;
    this.panelSize = opts.panelSize ?? DEFAULT_PANEL_SIZE;
  }

  append(raw: unknown): Promise<AppendResult> {
    return this.appendAt(raw, this.now().toISOString());
  }

  /** @internal Appends as if the log's clock read `appendedAt`. verify() uses it to replay. */
  appendAt(raw: unknown, appendedAt: string): Promise<AppendResult> {
    this.schemas.assert("envelope", raw);
    const r = raw as AspRecord;
    return this.store.transaction((tx) => this.appendIn(tx, r, appendedAt));
  }

  private async appendIn(tx: LogTx, r: AspRecord, appendedAt: string): Promise<AppendResult> {
    const existing = await tx.getRecord(r.id);
    if (existing) {
      const chain = await tx.getChain(existing.chain);
      return { seq: existing.seq, id: existing.id, chain: existing.chain, logHash: existing.logHash, state: chain?.state ?? null, duplicate: true };
    }

    const type = shortType(r.type);
    const { resolve, rows } = await this.resolverFor(tx, r, type);
    const verified = verifyRecord(r, resolve, this.schemas);
    this.checkKeyUse(verified, type!, rows, appendedAt);

    // Chain placement: a new chain, or the successor of its chain's head.
    let chain: ChainRow | undefined;
    if (verified.prev !== null) {
      const prev = await tx.getRecord(verified.prev);
      if (!prev) throw new AspError("BAD_PREV", `prev ${verified.prev} is not in the log`);
      chain = (await tx.getChain(prev.chain))!;
      if (chain.head !== verified.prev) {
        throw new AspError("BAD_PREV", `prev ${verified.prev} already has a successor; the chain head is ${chain.head}`);
      }
    }
    const root = chain?.root ?? verified.id;
    const kind = chain?.kind ?? type!;

    let snapshot: JobSnapshot | null = null;
    if (kind === "contract") {
      const job = chain?.snapshot ? Job.fromSnapshot(chain.snapshot, { schemas: this.schemas }) : new Job({ schemas: this.schemas });
      job.step(verified);
      snapshot = job.snapshot();
    } else {
      if (JOB_ONLY_TYPES.has(type!)) {
        throw new AspError("ILLEGAL_TRANSITION", `${verified.type} belongs in a job chain, not a ${kind} chain`);
      }
      // Outside jobs, a chain is the history of one kind of record (a passport's versions, a lineage).
      if (type !== kind) throw new AspError("ILLEGAL_TRANSITION", `a ${kind} chain cannot continue with ${verified.type}`);
      if (chain && Date.parse(verified.issued_at) < Date.parse(chain.lastIssuedAt)) {
        throw new AspError("TIME_REVERSED", `${verified.issued_at} is before ${chain.lastIssuedAt}`);
      }
    }

    const head = await tx.logHead();
    const stored: StoredRecord = {
      seq: head.seq + 1, id: verified.id, chain: root, logHash: nextLogHash(head.logHash, verified.id),
      appendedAt, record: verified,
    };
    // Insert first: projections reference the record. A projection that throws rolls the insert back.
    await tx.insertRecord(stored);
    if (type === "passport") await this.projectPassport(tx, verified);
    if (type === "fleet") await this.projectFleet(tx, verified);
    if (type === "node") await this.projectNode(tx, verified);
    if (type === "lineage") await this.projectLineage(tx, verified);
    if (type === "bond") await this.projectBond(tx, verified);
    if (type === "settlement") { await this.checkVerifiedBeforeSilence(tx, verified); await this.projectSettlement(tx, verified); }
    if (type === "juror") await this.projectJuror(tx, verified);
    if (type === "attestation") {
      await this.checkRulingPanel(tx, verified);
      await this.checkAllocationPanel(tx, verified);
      await this.checkVerification(tx, verified);
      await this.checkVerifiedBeforeAcceptance(tx, verified);
    }
    if (type === "mandate") { await this.checkMandateTier(tx, verified); this.checkMandateGates(verified); await this.projectMandate(tx, verified); }
    if (type === "action") await this.checkAction(tx, verified);
    if (type === "proposal") await this.checkProposerTier(tx, verified);
    if (type === "contract") await this.checkSubcontract(tx, verified);
    await tx.putChain({
      root, kind, head: verified.id, length: (chain?.length ?? 0) + 1, lastIssuedAt: verified.issued_at,
      state: snapshot?.state ?? null, snapshot,
    });
    await tx.setLogHead({ seq: stored.seq, logHash: stored.logHash });
    return { seq: stored.seq, id: stored.id, chain: root, logHash: stored.logHash, state: snapshot?.state ?? null, duplicate: false };
  }

  /** Keys for every kid on the record: registry first, then a self-issued first passport's own keys, then the fallback. */
  private async resolverFor(tx: LogTx, r: AspRecord, type: string | undefined) {
    const found = new Map<string, Uint8Array>();
    const rows = new Map<string, KeyRow>();
    for (const { kid } of [r.sig, ...(r.cosigs ?? [])]) {
      const k = await tx.getKey(kid);
      if (k && !k.revokedAt) {
        found.set(kid, b64urlDecode(k.publicKey));
        rows.set(kid, k);
      }
    }
    const body = r.body as { did?: string; keys?: { id: string; public_key: string }[] };
    // Bootstrap: a person's first passport may be self-issued, signed by a key it declares (MOCKS.md #8).
    if (type === "passport" && body.did === r.issuer && !(await tx.getPassport(r.issuer))) {
      for (const k of body.keys ?? []) if (!found.has(k.id)) found.set(k.id, b64urlDecode(k.public_key));
    }
    const resolve: KeyResolver = (kid) => found.get(kid) ?? this.fallback?.(kid);
    return { resolve, rows };
  }

  /** A node key signs only as its own node, only while it is live, never identity records, never as a co-signer. */
  private checkKeyUse(r: AspRecord, type: string, rows: Map<string, KeyRow>, appendedAt: string): void {
    for (const c of r.cosigs ?? []) {
      if (rows.get(c.kid)?.kind === "node") throw rule("node_key_cosign", `node key ${c.kid} cannot co-sign`);
    }
    const signer = rows.get(r.sig.kid);
    if (signer?.kind !== "node") return;
    if (r.actor !== r.sig.kid) throw rule("node_key_actor", `node key ${r.sig.kid} can only sign as that node, not as ${r.actor}`);
    if (IDENTITY_TYPES.has(type)) throw rule("node_key_identity", `node key ${r.sig.kid} cannot sign a ${type} record`);
    if (after(r.issued_at, signer.expiresAt!) || after(appendedAt, signer.expiresAt!)) {
      throw rule("node_key_expired", `node key ${r.sig.kid} expired at ${signer.expiresAt}`);
    }
  }

  /** Registry rules: one passport chain per DID, issued by the DID itself or its sponsor. */
  private async projectPassport(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { did: string; kind: string; sponsor?: string; fleet?: string; keys: { id: string; public_key: string }[] };
    const current = await tx.getPassport(body.did);
    if ((current?.head ?? null) !== r.prev) {
      throw new AspError("BAD_PREV", current
        ? `a passport update for ${body.did} must follow ${current.head}`
        : `the first passport for ${body.did} must start a chain`);
    }
    const sponsor = current ? current.sponsor : body.sponsor ?? null;
    if (r.issuer !== body.did && r.issuer !== sponsor) {
      throw new AspError("WRONG_ISSUER", `${r.issuer} is neither ${body.did} nor its sponsor`);
    }
    for (const k of body.keys) {
      if (!k.id.startsWith(`${body.did}#`)) throw new AspError("KID_NOT_ISSUER", `key ${k.id} does not belong to ${body.did}`);
      const existing = await tx.getKey(k.id);
      if (existing?.kind === "node") throw rule("key_id_taken", `${k.id} is a node key`);
    }

    const newSponsor = body.sponsor ?? sponsor;
    if (body.fleet) await this.checkFleetMembership(tx, body.did, body.kind, newSponsor, body.fleet);

    const declared = new Set(body.keys.map((k) => k.id));
    let rotated = false;
    for (const old of await tx.keysForDid(body.did)) {
      if (old.kind === "passport" && !declared.has(old.kid) && !old.revokedAt) {
        await tx.putKey({ ...old, revokedAt: r.issued_at });
        rotated = true;
      }
    }
    if (rotated) {
      // Dropping a passport key breaks continuity of trust: every outstanding delegation made under
      // it is now suspect, so all of this person's live node keys are revoked too, not just expired.
      for (const nodeKey of await tx.keysForDid(body.did)) {
        if (nodeKey.kind === "node" && !nodeKey.revokedAt) await tx.putKey({ ...nodeKey, revokedAt: r.issued_at });
      }
    }
    for (const k of body.keys) {
      await tx.putKey({
        kid: k.id, did: body.did, publicKey: k.public_key, kind: "passport", grantedBy: r.id,
        revokedAt: null, expiresAt: null, mandate: null,
      });
    }
    await tx.putPassport({ did: body.did, head: r.id, sponsor: newSponsor, fleet: body.fleet ?? null });
  }

  /** An agent joins a fleet by naming it; the fleet must be declared, share the agent's sponsor and have room. */
  private async checkFleetMembership(tx: LogTx, did: string, kind: string, sponsor: string | null, fleetDid: string): Promise<void> {
    if (kind !== "agent") throw rule("fleet_member_kind", `only agents join fleets, not a ${kind}`);
    const fleet = await tx.getFleet(fleetDid);
    if (!fleet) throw rule("fleet_unknown", `fleet ${fleetDid} is not declared`);
    if (sponsor !== fleet.org) throw rule("fleet_sponsor_mismatch", `fleet ${fleetDid} belongs to ${fleet.org}; ${did} is sponsored by ${sponsor}`);
    if (fleet.maxMembers !== null) {
      const others = (await tx.fleetMembers(fleetDid)).filter((m) => m.did !== did);
      if (others.length >= fleet.maxMembers) throw rule("fleet_full", `fleet ${fleetDid} has ${fleet.maxMembers} members`);
    }
  }

  /** One declaration chain per fleet, issued by its org, which never changes. */
  private async projectFleet(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { did: string; org: string; name: string; max_members?: number };
    const current = await tx.getFleet(body.did);
    if ((current?.head ?? null) !== r.prev) {
      throw new AspError("BAD_PREV", current
        ? `a fleet update for ${body.did} must follow ${current.head}`
        : `the first declaration of ${body.did} must start a chain`);
    }
    if (r.issuer !== body.org) throw new AspError("WRONG_ISSUER", `fleet ${body.did} must be declared by its org ${body.org}`);
    if (current && current.org !== body.org) throw rule("fleet_org_change", `fleet ${body.did} belongs to ${current.org}`);
    await tx.putFleet({ did: body.did, head: r.id, org: body.org, name: body.name, maxMembers: body.max_members ?? null });
  }

  /**
   * A person delegates a short-lived key to one node, optionally under a Mandate whose max_parallel
   * it counts against. A second record for the same node id, chained onto the first (prev = its id),
   * is an update: a rotation (new key or extended expiry) or, by setting expires at or before
   * issued_at, an immediate revocation before the original grant would otherwise expire.
   */
  private async projectNode(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { node: string; public_key: string; expires: string; mandate?: string };
    if (!body.node.startsWith(`${r.issuer}#`)) throw new AspError("KID_NOT_ISSUER", `node ${body.node} is not under ${r.issuer}`);

    const existing = await tx.getKey(body.node);
    if (existing) {
      // Chain placement already proved r.prev is this record's rightful predecessor; only need to
      // confirm that predecessor really is this same node's own grant, not a hijack of its id.
      const prevRecord = r.prev && (await tx.getRecord(r.prev));
      if (!prevRecord || (prevRecord.record.body as any).node !== body.node) {
        throw rule("key_id_taken", `${body.node} is already a key id`);
      }
    } else if (r.prev) {
      throw rule("node_chain_start", `the first grant for ${body.node} must start its own chain (prev: null)`);
    }
    if (!existing && !after(body.expires, r.issued_at)) throw rule("node_ttl", "a node must expire after it is granted");
    if (Date.parse(body.expires) - Date.parse(r.issued_at) > this.maxNodeTtlMs) {
      throw rule("node_ttl", `a node may live at most ${this.maxNodeTtlMs / 3_600_000} hours`);
    }

    if (body.mandate) {
      const m = await tx.getRecord(body.mandate);
      if (!m || m.record.type !== "asp.mandate/v0.2") throw rule("node_mandate_unknown", `${body.mandate} is not a Mandate in this log`);
      const mandate = m.record.body as { expires: string; nodes: { max_parallel: number } };
      if (m.record.subject !== r.issuer) throw rule("node_mandate_subject", `the Mandate was issued to ${m.record.subject}, not ${r.issuer}`);
      if (after(body.expires, mandate.expires)) throw rule("node_outlives_mandate", `the Mandate expires at ${mandate.expires}`);
      const live = (await tx.nodeKeysForMandate(body.mandate)).filter((k) => after(k.expiresAt!, r.issued_at));
      if (live.length >= mandate.nodes.max_parallel) {
        throw rule("node_max_parallel", `the Mandate allows ${mandate.nodes.max_parallel} parallel nodes`);
      }
    }

    const revokedNow = !after(body.expires, r.issued_at); // expires <= issued_at: an immediate revocation
    await tx.putKey({
      kid: body.node, did: r.issuer, publicKey: body.public_key, kind: "node", grantedBy: r.id,
      revokedAt: revokedNow ? r.issued_at : null, expiresAt: body.expires, mandate: body.mandate ?? null,
    });
  }

  /**
   * A lineage `update` record with `probation_until` sets that DID's current probation window
   * (decision D2). Nothing checks this yet — see the class doc on projectLineage.
   */
  private async projectLineage(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { child: string; probation_until?: string };
    if (body.probation_until) await tx.putProbation({ did: body.child, until: body.probation_until, setBy: r.id });
  }

  /** Debits an account, throwing insufficient_balance rather than letting it go negative. */
  private async debit(tx: LogTx, did: string, amount: number): Promise<void> {
    if (amount === 0) return;
    const balance = (await tx.getAccount(did))?.balance ?? 0;
    if (balance < amount) throw rule("insufficient_balance", `${did} has ${balance} credits, needs ${amount}`);
    await tx.putAccount({ did, balance: balance - amount });
  }

  private async credit(tx: LogTx, did: string, amount: number): Promise<void> {
    if (amount === 0) return;
    const balance = (await tx.getAccount(did))?.balance ?? 0;
    await tx.putAccount({ did, balance: balance + amount });
  }

  /**
   * A DID's current tier and slash count. Only tracked for agents (a Passport's `tier` is required
   * for kind "agent", not for humans/orgs) — humans aren't excluded or risk-loaded by this
   * mechanism. Falls back to the agent's self-declared Passport tier until its first slash.
   * Takes anything with these three reads — a LogTx mid-append, or the Store for a plain query.
   */
  private async reputation(tx: Pick<LogTx, "getPassport" | "getRecord" | "getReputation">, did: string): Promise<{ tier: number; slashCount: number } | null> {
    const passport = await tx.getPassport(did);
    if (!passport) return null;
    const existing = await tx.getReputation(did);
    if (existing) return { tier: existing.tier, slashCount: existing.slashCount };
    const head = await tx.getRecord(passport.head);
    const body = head?.record.body as { kind: string; tier?: number } | undefined;
    if (body?.kind !== "agent") return null;
    return { tier: body.tier ?? 1, slashCount: 0 };
  }

  /** Demotes a slashed backer by one tier (floor 0) and counts the slash, for its next Bond's risk floor. */
  private async demote(tx: LogTx, did: string): Promise<void> {
    const rep = await this.reputation(tx, did);
    if (!rep) return; // not an agent (or has no passport at all): this mechanism doesn't apply
    await tx.putReputation({ did, tier: Math.max(0, rep.tier - 1), slashCount: rep.slashCount + 1 });
  }

  /**
   * Deterrence, extended past Bond: a tier-0 agent (demoted to nothing by repeat slashes) can't
   * receive a Mandate either, not just bond a job. The envelope subject is the performer for a
   * Mandate (lifecycle's own subject_is_performer guard already establishes this).
   */
  private async checkMandateTier(tx: LogTx, r: AspRecord): Promise<void> {
    const rep = await this.reputation(tx, r.subject as string);
    if (rep?.tier === 0) throw rule("tier_excluded", `${r.subject} is excluded from receiving a Mandate: repeat slashes demoted it to tier 0`);
  }

  /** Deterrence, extended to allocation mode: a tier-0 agent can't submit a Proposal either. */
  private async checkProposerTier(tx: LogTx, r: AspRecord): Promise<void> {
    const rep = await this.reputation(tx, r.issuer);
    if (rep?.tier === 0) throw rule("tier_excluded", `${r.issuer} is excluded from proposing: repeat slashes demoted it to tier 0`);
  }

  /**
   * Subcontract nesting (decided 2026-09-28: the performer funds its own subcontract, no automatic
   * netting to the parent's escrow — `parent_contract` only links child to parent for audit). Real
   * checks, not just an unvalidated field: the parent must actually be a Contract still open (not
   * already Settled), and the child's principal must be the parent's own performer — a subcontract
   * is that performer hiring help for work it's already on the hook for, not an arbitrary DID
   * borrowing someone else's job id.
   */
  private async checkSubcontract(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { principal: string; parent_contract?: string };
    if (!body.parent_contract) return;
    const parent = await tx.getRecord(body.parent_contract);
    if (!parent || parent.record.type !== "asp.contract/v0.2") {
      throw rule("parent_contract_unknown", `${body.parent_contract} is not a Contract in this log`);
    }
    const parentChain = await tx.getChain(parent.chain);
    if (parentChain?.state === "Settled") throw rule("parent_already_settled", `contract ${body.parent_contract} is already Settled`);
    const parentBody = parent.record.body as { performer: string };
    if (parentBody.performer !== body.principal) {
      throw rule("subcontract_principal_mismatch", `a subcontract's principal must be the parent contract's own performer (${parentBody.performer}), not ${body.principal}`);
    }
  }

  /** Tracks a contract's current Mandate scopes, so a later Action report can be checked against it. */
  /** Approval gates: every scope the Mandate gates (or forbids) must be one it actually grants. */
  private checkMandateGates(r: AspRecord): void {
    const body = r.body as { scopes: string[]; irreversible?: { scopes?: string[] } };
    const stray = (body.irreversible?.scopes ?? []).filter((s) => !body.scopes.includes(s));
    if (stray.length) throw rule("gate_not_granted", `irreversible.scopes names scope(s) the Mandate does not grant: ${stray.join(", ")}`);
  }

  private async projectMandate(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { contract: string; scopes: string[] };
    await tx.putMandate({ contract: body.contract, scopes: body.scopes });
  }

  /**
   * The runtime → protocol compliance bridge (docs/backlog.md): a self-issued, near-real-time
   * report of what scopes a performer's tool calls actually exercised, checked against that
   * contract's live Mandate. Self-reported — this can't catch a genuinely adversarial agent that
   * simply omits a violating action, but an honest report of an out-of-scope action can never be
   * laundered into a clean-looking log: it's refused, the same as any other guard failure, right
   * when it's submitted, not discovered later in a Delivery nobody double-checked.
   */
  private async checkAction(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { contract: string; scopes_used: string[] };
    const contract = await tx.getRecord(body.contract);
    if (!contract || contract.record.type !== "asp.contract/v0.2") {
      throw rule("action_contract_unknown", `${body.contract} is not a Contract in this log`);
    }
    const cbody = contract.record.body as { performer: string };
    if (r.issuer !== cbody.performer) throw new AspError("WRONG_ISSUER", `${r.issuer} is not the performer of ${body.contract}`);
    const chain = await tx.getChain(contract.chain);
    if (chain?.state !== "Running" && chain?.state !== "Checkpoint") {
      throw rule("action_not_running", `contract ${body.contract} is not currently Running (state: ${chain?.state ?? "unknown"})`);
    }
    const mandate = await tx.getMandate(body.contract);
    if (!mandate) throw rule("no_mandate_for_action", `contract ${body.contract} has no Mandate yet`);
    const outOfScope = body.scopes_used.filter((s) => !mandate.scopes.includes(s));
    if (outOfScope.length) {
      throw rule("scope_violation", `${r.issuer} used scope(s) not granted by the Mandate: ${outOfScope.join(", ")}`);
    }
  }

  /**
   * Bank: locks the principal's escrow and the backer's bond against the contract, debiting both
   * (Stage 2 slice 1). Fails with insufficient_balance rather than letting a job start uncovered.
   * The lock is recorded so `projectSettlement` cannot release more than was actually locked.
   *
   * Deterrence: a backer at tier 0 (demoted to nothing by repeat slashes) is excluded from bonding
   * at all; otherwise its own and its live fleet-mates' slash history raise the minimum bond it
   * must post for this contract's price (risk_floor), so a repeat offender needs more skin in the
   * game for the same job, and a sponsor whose fleet accumulates slashes feels it fleet-wide too.
   */
  private async projectBond(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as {
      contract: string; backer: string; amount: { value: number };
      escrow: { payer: string; amount: { value: number } };
    };
    const backerRep = await this.reputation(tx, body.backer);
    if (backerRep && backerRep.tier === 0) {
      throw rule("tier_excluded", `${body.backer} is excluded from bonding: repeat slashes demoted it to tier 0`);
    }
    if (backerRep) {
      let fleetSlashes = 0;
      const backerPassport = await tx.getPassport(body.backer);
      if (backerPassport?.fleet) {
        for (const member of await tx.fleetMembers(backerPassport.fleet)) {
          if (member.did === body.backer) continue;
          fleetSlashes += (await this.reputation(tx, member.did))?.slashCount ?? 0;
        }
      }
      const riskFloorPermille = Math.min(1000, backerRep.slashCount * RISK_PERMILLE_PER_OWN_SLASH + fleetSlashes * RISK_PERMILLE_PER_FLEET_SLASH);
      if (riskFloorPermille > 0) {
        const contract = await tx.getRecord(body.contract);
        const price = (contract?.record.body as { price?: { value: number } } | undefined)?.price?.value ?? 0;
        const minBond = Math.ceil((price * riskFloorPermille) / 1000);
        if (body.amount.value < minBond) {
          throw rule("bond_below_risk_floor", `${body.backer}'s slash history requires a bond of at least ${minBond} for this contract, got ${body.amount.value}`);
        }
      }
    }
    const debits = new Map<string, number>();
    debits.set(body.escrow.payer, (debits.get(body.escrow.payer) ?? 0) + body.escrow.amount.value);
    debits.set(body.backer, (debits.get(body.backer) ?? 0) + body.amount.value);
    for (const [did, amount] of debits) await this.debit(tx, did, amount);
    await tx.putEscrow({
      contract: body.contract, escrowPayer: body.escrow.payer, escrowLocked: body.escrow.amount.value,
      backer: body.backer, bondLocked: body.amount.value, settled: false,
    });
  }

  /**
   * Bank: distributes what a Bond locked, once, per contract. escrow_released goes to the
   * performer, any escrow left over returns to the principal; bond_returned goes back to the
   * backer, bond_slashed compensates the principal (the harmed party), and any bond left over
   * also returns to the backer. Never releases, returns or slashes more than was locked.
   * `fees` (decided 2026-09-28) comes out of the same escrow, on top of `escrow_released`, and
   * credits to `PLATFORM_DID` — a local mock standing in for a real platform/Insurer account
   * (MOCKS.md), the same trust boundary as the mocked bank/panel DIDs conformance already uses.
   */
  private async projectSettlement(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as {
      contract: string; basis: string; cites?: string; escrow_released: { value: number };
      bond_returned: { value: number }; bond_slashed: { value: number }; fees?: { value: number };
    };
    const fees = body.fees?.value ?? 0;
    const escrow = await tx.getEscrow(body.contract);
    if (!escrow) throw rule("no_bond_for_settlement", `no Bond found for contract ${body.contract}`);
    if (escrow.settled) throw rule("already_settled", `contract ${body.contract} was already settled`);
    if (body.escrow_released.value + fees > escrow.escrowLocked) {
      throw rule("over_release", `escrow_released + fees exceeds the ${escrow.escrowLocked} locked`);
    }
    if (body.bond_returned.value + body.bond_slashed.value > escrow.bondLocked) {
      throw rule("over_release", `bond_returned + bond_slashed exceeds the ${escrow.bondLocked} bond locked`);
    }

    const contract = await tx.getRecord(body.contract);
    const cbody = contract!.record.body as { principal: string; performer: string };

    // A ruling-backed Settlement can't declare whatever it likes: the ruling's fault map for the
    // performer *is* the formula, so a bank can't rule one way and settle another (Courts becomes
    // a real adjudication, not a rubber stamp on top of it — docs/backlog.md).
    if (body.basis === "ruling") {
      const ruling = body.cites ? await tx.getRecord(body.cites) : undefined;
      const rbody = ruling?.record.body as { kind: string; fault?: Record<string, number> } | undefined;
      const performerFault = rbody?.kind === "ruling" ? (rbody.fault?.[cbody.performer] ?? 0) : 0;
      const expectedReleased = Math.floor((escrow.escrowLocked * (1000 - performerFault)) / 1000);
      const expectedSlashed = Math.ceil((escrow.bondLocked * performerFault) / 1000);
      if (body.escrow_released.value !== expectedReleased || body.bond_slashed.value !== expectedSlashed) {
        throw rule("settlement_mismatches_ruling",
          `the ruling puts ${performerFault}‰ fault on the performer: escrow_released must be ${expectedReleased} (got ${body.escrow_released.value}), bond_slashed must be ${expectedSlashed} (got ${body.bond_slashed.value})`);
      }
    }

    const escrowLeftover = escrow.escrowLocked - body.escrow_released.value - fees;
    const bondLeftover = escrow.bondLocked - body.bond_returned.value - body.bond_slashed.value;

    // earnings_split: the agent keeps agent_permille of its pay; the rest goes to its sponsor.
    const split = (r.body as { earnings_split?: { agent_permille: number } }).earnings_split;
    if (split && split.agent_permille < 1000 && body.escrow_released.value > 0) {
      const sponsor = (await tx.getPassport(cbody.performer))?.sponsor;
      if (!sponsor) throw rule("earnings_split_no_sponsor", `${cbody.performer} has no sponsor to receive the rest of an earnings_split`);
      const agentShare = Math.floor((body.escrow_released.value * split.agent_permille) / 1000);
      await this.credit(tx, cbody.performer, agentShare);
      await this.credit(tx, sponsor, body.escrow_released.value - agentShare);
    } else {
      await this.credit(tx, cbody.performer, body.escrow_released.value);
    }
    if (fees > 0) await this.credit(tx, PLATFORM_DID, fees);
    await this.credit(tx, cbody.principal, escrowLeftover + body.bond_slashed.value);
    await this.credit(tx, escrow.backer, body.bond_returned.value + bondLeftover);
    if (body.bond_slashed.value > 0) await this.demote(tx, escrow.backer);
    await tx.putEscrow({ ...escrow, settled: true });
  }

  /**
   * Courts, narrowly (Stage 2 slice): a DID self-registers a real credit stake to be eligible for
   * random draw onto a ruling panel. A second Juror record chained onto the first (prev = its id)
   * updates the stake — locking more (debit), returning some or all (credit) — never a fresh chain.
   */
  private async projectJuror(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { did: string; stake: { value: number } };
    if (r.issuer !== body.did) throw new AspError("WRONG_ISSUER", `a juror record must be self-issued by ${body.did}`);
    const current = await tx.getJuror(body.did);
    if ((current?.head ?? null) !== r.prev) {
      throw new AspError("BAD_PREV", current
        ? `a juror update for ${body.did} must follow ${current.head}`
        : `the first juror registration for ${body.did} must start a chain`);
    }
    const delta = body.stake.value - (current?.staked ?? 0);
    if (delta > 0) await this.debit(tx, body.did, delta);
    else if (delta < 0) await this.credit(tx, body.did, -delta);
    await tx.putJuror({ did: body.did, head: r.id, staked: body.stake.value });
  }

  /**
   * Courts, narrowly: a ruling Attestation must be signed by a majority of the panel drawn for
   * that dispute (drawPanel, panel.ts) — conflict-free, seeded from the rejection that opened it —
   * not by any DID. Everything this depends on (jurors, passports, the rejection record) replays
   * the same way every time, so this is fully checkable by EventLog.verify(), unlike EventLog.mint.
   */
  /** Allocation mode: only a DID named in the Call's `panel` may select a Proposal for it (MOCKS.md #14). */
  private async checkAllocationPanel(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { kind: string; about: string };
    if (body.kind !== "allocation") return;
    const proposal = await tx.getRecord(body.about);
    if (!proposal || shortType(proposal.record.type) !== "proposal") throw rule("allocation_unknown_proposal", `${body.about} is not a Proposal in the log`);
    const callId = (proposal.record.body as { call: string }).call;
    const call = await tx.getRecord(callId);
    if (!call || shortType(call.record.type) !== "call") throw rule("allocation_unknown_call", `the Proposal's Call ${callId} is not in the log`);
    const panel = (call.record.body as { panel: string[] }).panel;
    if (!panel.includes(r.issuer)) throw rule("not_on_call_panel", `${r.issuer} is not on the Call's panel (${panel.join(", ")})`);
  }

  private async checkRulingPanel(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { kind: string; about: string };
    if (body.kind !== "ruling") return;
    const contract = await tx.getRecord(body.about);
    if (!contract) return; // the lifecycle's own about_contract guard already rejects this
    const cbody = contract.record.body as { principal: string; performer: string };
    const seed = await findRejection(tx, r.prev);
    if (!seed) return; // defensive; the lifecycle's own guards already require a prior rejection
    const panel = await drawPanel(tx, { principal: cbody.principal, performer: cbody.performer, seed, size: this.panelSize });
    // No staked, conflict-free juror is registered anywhere: Courts hasn't been bootstrapped in
    // this log, so fall back to the pre-Courts mocked behavior (any neutral DID may rule) rather
    // than blocking every dispute — this is what keeps the `dispute_ruled`/`ruling_by_party`
    // conformance vectors (single mocked panel DID, no jurors) valid unchanged (MOCKS.md #4).
    if (panel.length === 0) return;
    const signers = new Set([r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    const onPanel = panel.filter((p) => signers.has(p));
    const quorum = Math.ceil(panel.length / 2);
    if (onPanel.length < quorum) {
      throw rule("panel_quorum", `a ruling needs ${quorum} of the drawn panel (${panel.join(", ")}) to sign; only ${onPanel.length} did`);
    }
  }

  /**
   * Outcome verification: when a Contract names a `verifier`, that DID (separate from the principal,
   * the performer, and anyone either sponsors) must re-check the Delivery and sign a verification
   * Attestation before the principal can accept it. The verification is a standalone record about the
   * Delivery (like an allocation), so it needs no lifecycle change; what it adds is a guard on
   * acceptance. Claims on the Delivery carry the performer's declared evidence grade; the verifier
   * confirms or downgrades each by index, and a "confirmed" verdict cannot hide a downgrade.
   */
  private async checkVerification(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { kind: string; about: string; verdict: string; claims?: { index: number; grade: string }[] };
    if (body.kind !== "verification") return;
    const delivery = await tx.getRecord(body.about);
    if (!delivery || delivery.record.type !== "asp.delivery/v0.2") {
      throw rule("verification_about_unknown", `${body.about} is not a Delivery in this log`);
    }
    const dbody = delivery.record.body as { contract: string; result: { claims?: { claim: string; grade: string }[] } };
    const contract = await tx.getRecord(dbody.contract);
    if (!contract || contract.record.type !== "asp.contract/v0.2" || delivery.chain !== contract.chain) {
      throw rule("verification_about_unknown", `the Delivery ${body.about} is not on a job chain in this log`);
    }
    const cbody = contract.record.body as { principal: string; performer: string; verifier?: string };
    if (!cbody.verifier) throw rule("no_verifier_named", `contract ${dbody.contract} names no verifier`);
    if (r.issuer !== cbody.verifier) throw rule("not_the_verifier", `${r.issuer} is not the verifier (${cbody.verifier}) named by contract ${dbody.contract}`);
    const parties = new Set([cbody.principal, cbody.performer]);
    const sponsor = (await tx.getPassport(r.issuer))?.sponsor;
    if (parties.has(r.issuer) || (sponsor && parties.has(sponsor))) {
      throw rule("verifier_conflicted", `${r.issuer} is, or is sponsored by, the principal or the performer, so it cannot verify this Delivery`);
    }
    const chain = await tx.getChain(contract.chain);
    if (chain?.state !== "Delivered") throw rule("verification_not_delivered", `contract ${dbody.contract} is not awaiting acceptance (state: ${chain?.state ?? "unknown"})`);
    if (await tx.getVerification(body.about)) throw rule("already_verified", `Delivery ${body.about} already has a verification`);

    const declared = dbody.result.claims ?? [];
    const given = body.claims ?? [];
    const seen = new Set<number>();
    for (const c of given) {
      if (c.index >= declared.length) throw rule("verification_claim_unknown", `the Delivery has ${declared.length} claim(s); there is no claim ${c.index}`);
      if (seen.has(c.index)) throw rule("verification_claim_duplicate", `claim ${c.index} is graded twice`);
      seen.add(c.index);
    }
    if (body.verdict === "partly_confirmed" && !declared.length) {
      throw rule("verification_no_claims", "a Delivery with no claims can only be confirmed or not confirmed");
    }
    if ((body.verdict === "confirmed" || body.verdict === "partly_confirmed") && declared.length && seen.size !== declared.length) {
      throw rule("verification_claims_incomplete", `grade all ${declared.length} claim(s), or the verdict cannot say what was established`);
    }
    if (body.verdict === "confirmed") {
      for (const c of given) {
        if ((GRADE_RANK[c.grade] ?? 0) < (GRADE_RANK[declared[c.index].grade] ?? 0)) {
          throw rule("verification_downgrade_not_confirmed", `claim ${c.index} was declared ${declared[c.index].grade} but verified only ${c.grade}; that is partly_confirmed at best`);
        }
      }
    }
    await tx.putVerification({ delivery: body.about, contract: dbody.contract, verifier: r.issuer, verdict: body.verdict });
  }

  /** Acceptance gate: with a verifier named, a Delivery needs a confirming verification before it is accepted. */
  private async checkVerifiedBeforeAcceptance(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { kind: string; about: string; verdict?: string };
    if (body.kind !== "acceptance" || body.verdict !== "accepted") return;
    const delivery = await tx.getRecord(body.about);
    if (!delivery || delivery.record.type !== "asp.delivery/v0.2") return; // the lifecycle's own guard rejects this
    const contract = await tx.getRecord((delivery.record.body as { contract: string }).contract);
    const verifier = (contract?.record.body as { verifier?: string } | undefined)?.verifier;
    if (!verifier) return;
    const ver = await tx.getVerification(body.about);
    if (!ver || ver.verdict === "not_confirmed") {
      throw rule("verification_required", `this contract names ${verifier} as verifier: the Delivery needs a confirming verification before it can be accepted${ver ? " (the verifier did not confirm it)" : ""}`);
    }
  }

  /** The same gate for settling on the principal's silence: silence cannot stand in for a verification. */
  private async checkVerifiedBeforeSilence(tx: LogTx, r: AspRecord): Promise<void> {
    const body = r.body as { contract: string; basis: string };
    if (body.basis !== "silence") return;
    const contract = await tx.getRecord(body.contract);
    const verifier = (contract?.record.body as { verifier?: string } | undefined)?.verifier;
    if (!contract || !verifier) return;
    const head = (await tx.getChain(contract.chain))?.head;
    const ver = head ? await tx.getVerification(head) : undefined;
    if (!ver || ver.verdict === "not_confirmed") {
      throw rule("verification_required", `this contract names ${verifier} as verifier: silence cannot settle a Delivery that was not confirmed`);
    }
  }

  get(id: string) { return this.store.getRecord(id); }
  head() { return this.store.logHead(); }
  chain(root: string) { return this.store.chainRecords(root); }
  chainInfo(root: string) { return this.store.getChain(root); }
  since(afterSeq: number, limit = 500) { return this.store.since(afterSeq, limit); }
  passport(did: string) { return this.store.getPassport(did); }
  keys(did: string) { return this.store.keysForDid(did); }
  probation(did: string) { return this.store.getProbation(did); }
  async balance(did: string) { return (await this.store.getAccount(did))?.balance ?? 0; }
  escrow(contract: string) { return this.store.getEscrow(contract); }
  juror(did: string) { return this.store.getJuror(did); }
  reputationOf(did: string) { return this.reputation(this.store, did); }
  mandateOf(contract: string) { return this.store.getMandate(contract); }
  verificationOf(delivery: string) { return this.store.getVerification(delivery); }

  /** The current panel for a contract's open dispute — for display before a ruling is issued. */
  async drawPanel(contract: string, size?: number): Promise<string[]> {
    const contractRec = await this.store.getRecord(contract);
    if (!contractRec) throw new AspError("BAD_PREV", `${contract} is not in the log`);
    const cbody = contractRec.record.body as { principal: string; performer: string };
    const chainRecords = await this.store.chainRecords(contract);
    const seed = await findRejection(this.store, chainRecords.at(-1)?.id ?? null);
    if (!seed) throw rule("no_dispute", `contract ${contract} has no open dispute (no rejection found)`);
    return drawPanel(this.store, { principal: cbody.principal, performer: cbody.performer, seed, size: size ?? this.panelSize });
  }

  /**
   * Bootstraps a DID's balance for local testing. Not a signed record, not part of the tamper-
   * evident log — a closed-loop ledger with no cash-out still needs some way to get the first
   * credits into an account, and there's no real payment rail behind it yet (MOCKS.md). Because
   * it isn't a record, `verify()` and `verifyCheckpoint()` can't independently re-derive it; they
   * seed their replay from a snapshot of current balances instead, the same trust boundary as
   * the fallback key resolver (MOCKS.md #9).
   */
  async mint(did: string, amount: number): Promise<number> {
    if (amount < 0) throw rule("mint_negative", "mint amount must be >= 0");
    return this.store.transaction(async (tx) => {
      const balance = ((await tx.getAccount(did))?.balance ?? 0) + amount;
      const totalMinted = ((await tx.getMint(did))?.totalMinted ?? 0) + amount;
      await tx.putAccount({ did, balance });
      await tx.putMint({ did, totalMinted });
      return balance;
    });
  }

  /**
   * Re-verifies a signed log checkpoint (decision D5, see @agent-social/asp-package's checkpoint.ts):
   * replays this log independently up to `at.seq` and checks the resulting hash matches `at.logHash`,
   * rather than trusting the stored value at that row.
   */
  async verifyCheckpoint(at: { seq: number; logHash: string }): Promise<boolean> {
    const replay = new EventLog(new MemoryStore(await this.store.allMints()), {
      schemas: this.schemas, fallbackResolver: this.fallback, maxNodeTtlMs: this.maxNodeTtlMs, panelSize: this.panelSize,
    });
    for (let afterSeq = 0; ; ) {
      const page = await this.store.since(afterSeq, 500);
      if (!page.length) return false; // the log is shorter than the checkpoint claims
      for (const s of page) {
        if (s.seq > at.seq) return false;
        const res = await replay.appendAt(s.record, s.appendedAt);
        if (s.seq === at.seq) return res.logHash === at.logHash;
        afterSeq = s.seq;
      }
    }
  }

  /** A fleet's declaration and its current members. */
  async fleet(did: string) {
    const fleet = await this.store.getFleet(did);
    return fleet && { ...fleet, members: await this.store.fleetMembers(did) };
  }

  /**
   * Re-verifies the whole log by replaying it into a fresh in-memory log, with each record's original
   * append time as the clock: every id, signature, chain link, lifecycle step, registry change and
   * log hash must come out the same.
   */
  async verify(pageSize = 500): Promise<VerifyReport> {
    const replay = new EventLog(new MemoryStore(await this.store.allMints()), {
      schemas: this.schemas, fallbackResolver: this.fallback, maxNodeTtlMs: this.maxNodeTtlMs, panelSize: this.panelSize,
    });
    let afterSeq = 0;
    let count = 0;
    for (;;) {
      const page = await this.store.since(afterSeq, pageSize);
      if (page.length === 0) break;
      for (const s of page) {
        try {
          if (s.seq !== afterSeq + 1) throw new AspError("BAD_PREV", `log gap: expected seq ${afterSeq + 1}, found ${s.seq}`);
          const res = await replay.appendAt(s.record, s.appendedAt);
          if (res.duplicate || res.id !== s.id) throw new AspError("BAD_ID", `stored id ${s.id} does not match its record`);
          if (res.logHash !== s.logHash) throw new AspError("BAD_ID", `log hash mismatch at seq ${s.seq}`);
          if (res.chain !== s.chain) throw new AspError("BAD_PREV", `record ${s.id} is filed under the wrong chain`);
        } catch (e) {
          if (!(e instanceof AspError)) throw e;
          return { ok: false, records: count, head: await replay.head(), error: { seq: s.seq, id: s.id, code: e.code, message: e.message } };
        }
        afterSeq = s.seq;
        count++;
      }
    }
    const head = await this.store.logHead();
    const replayed = await replay.head();
    if (head.seq !== replayed.seq || head.logHash !== replayed.logHash) {
      return { ok: false, records: count, head: replayed, error: { seq: head.seq, id: "", code: "BAD_ID", message: "log head does not match the replayed records" } };
    }
    return { ok: true, records: count, head };
  }
}
