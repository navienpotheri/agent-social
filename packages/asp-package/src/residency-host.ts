/**
 * Delegated custody for a resident agent (docs/institutions/residency.md 8; register row DK83; spec-delta S301): the sponsor keeps the root key; the host generates its own node key, hands the sponsor only
 * the PUBLIC half, and signs Actions as `<agent>#<node>` with the private half, which never leaves the host. The log refuses what a node may not do (identity records, co-signing, anything after expiry or
 * after a recall record) and, for `purpose: residency`, requires a cited Mandate and the city host. The host loop polls the revocation and stops within a stated deadline.
 */
import { b64urlEncode, createRecord, signerFromSeed, type AspRecord, type Signer } from "@agent-social/asp-core";
import { randomBytes } from "node:crypto";

/** After a recall the host stops its loop within this many seconds (residency.md 8, proposal). The log's own refusal of the node's records is immediate. */
export const RECALL_DEADLINE_SECONDS = 60;
/** The host polls the revocation at least this often; never slower than the deadline. */
export const POLL_SECONDS = 15;

export interface NodeKey { signer: Signer & { publicKey: Uint8Array }; kid: string; publicKey: string }

/** Runs on the HOST: a fresh key for one node. The private half stays in this process; only `publicKey` is sent to the sponsor. */
export function newNodeKey(agent: string, name: string): NodeKey {
  const kid = `${agent}#${name}`;
  const signer = signerFromSeed(kid, new Uint8Array(randomBytes(32)));
  return { signer, kid, publicKey: b64urlEncode(signer.publicKey) };
}

/** Runs on the SPONSOR's machine with the agent's root signer: the delegation takes only the node's public key. */
export function issueDelegation(root: Signer, agent: string, node: { kid: string; publicKey: string }, o: { mandate: string; host: string; expires: string; issuedAt: string }): AspRecord {
  return createRecord({ type: "node", issuer: agent, subject: null, prev: null, body: { node: node.kid, public_key: node.publicKey, expires: o.expires, mandate: o.mandate, purpose: "residency", host: o.host }, issued_at: o.issuedAt }, root);
}

/** Runs on the SPONSOR's machine: the recall chains onto the grant with `expires` at or before its issue time, which revokes the node key at once (log.ts node rule). */
export function recallDelegation(root: Signer, agent: string, grant: AspRecord, at: string): AspRecord {
  const b = grant.body as { node: string; public_key: string; mandate?: string; purpose?: string; host?: string };
  return createRecord({ type: "node", issuer: agent, subject: null, prev: grant.id, body: { node: b.node, public_key: b.public_key, expires: at, ...(b.mandate ? { mandate: b.mandate } : {}), ...(b.purpose ? { purpose: b.purpose } : {}), ...(b.host ? { host: b.host } : {}) }, issued_at: at }, root);
}

export interface HostLog {
  append(r: AspRecord): Promise<{ id: string }>;
  keys(did: string): Promise<{ kid: string; revokedAt: string | null; expiresAt: string | null }[]>;
}

/**
 * The host's loop for one resident: it holds only the node signer. `tick` polls the revocation when due and stops the loop (and tells the caller to end its model calls and seal the package) when the
 * node key is revoked or expired; `act` signs an Action as the node. The stop is within `pollSeconds` of the recall, which is at most the recall deadline.
 */
export class ResidentHost {
  private lastPoll = Number.NEGATIVE_INFINITY;
  stopped: { at: number; why: "revoked" | "expired" } | undefined;
  private readonly log: HostLog;
  readonly agent: string;
  private readonly node: Signer;
  private readonly nodeKid: string;
  readonly opts: { pollSeconds?: number; recallDeadlineSeconds?: number; onStop?: () => void };
  constructor(log: HostLog, agent: string, node: Signer, nodeKid: string, opts: { pollSeconds?: number; recallDeadlineSeconds?: number; onStop?: () => void } = {}) {
    if ((opts.pollSeconds ?? POLL_SECONDS) > (opts.recallDeadlineSeconds ?? RECALL_DEADLINE_SECONDS)) throw new Error("the host must poll at least as often as its recall deadline");
    this.log = log; this.agent = agent; this.node = node; this.nodeKid = nodeKid; this.opts = opts;
  }
  async tick(nowMs: number): Promise<"running" | "stopped"> {
    if (this.stopped) return "stopped";
    if (nowMs - this.lastPoll < (this.opts.pollSeconds ?? POLL_SECONDS) * 1000) return "running";
    this.lastPoll = nowMs;
    const row = (await this.log.keys(this.agent)).find((k) => k.kid === this.nodeKid);
    const revoked = !row || row.revokedAt !== null;
    const expired = !!row?.expiresAt && Date.parse(row.expiresAt) <= nowMs;
    if (revoked || expired) { this.stopped = { at: nowMs, why: revoked ? "revoked" : "expired" }; this.opts.onStop?.(); return "stopped"; }
    return "running";
  }
  /** One Action signed as `<agent>#<node>`: refused here once the loop has stopped, and by the log after a recall or expiry whatever the host does. */
  async act(contract: string, scopesUsed: string[], issuedAt: string, extra: Record<string, unknown> = {}): Promise<string> {
    if (this.stopped) throw new Error(`the host stopped (${this.stopped.why}): no more calls are signed`);
    const rec = createRecord({ type: "action", issuer: this.agent, actor: this.nodeKid, subject: contract, prev: null, body: { contract, scopes_used: scopesUsed, assurance: "gateway_enforced", ...extra }, issued_at: issuedAt }, this.node);
    return (await this.log.append(rec)).id;
  }
}
