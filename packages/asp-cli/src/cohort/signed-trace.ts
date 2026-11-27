/**
 * The signed trace of a model cohort (register row DK1801; docs/society-models-run.md): every tool call an agent of the cohort makes leaves a signed record in the run's own LOCAL ASP log, so the interaction
 * graph, the institution use and the credit flow of the report are computed from the log and can be checked by `asp society cohort verify`, and not only read from a trace file.
 *
 * What is written, for each agent of the run:
 *   - a passport (kind agent, sponsored by one of the run's throwaway sponsors; a sponsor opens at most eight agents here, under the log's own limit of ten a day) carrying the agent's run key;
 *   - a contract, a Bond and a Mandate whose scopes are the restricted tool set's (society.<institution>.read or .write, and society.rest), spend 0, no network, no subcontracting;
 *   - an Action for every tool call, signed by the agent's own run key: the scope it used, a short summary, what it was aimed at (a token, never content), the assurance `runtime_observed`; a call the tool set,
 *     the Mandate or the schema refused is an Action with `blocked_attempts` (a strike, the same as for any run, with no demotion and no slash) and a signed `gateway_refusal` record, one for each distinct call;
 *   - at the end the contract is settled as revoked, so what was locked comes back.
 * The keys are the agents' throwaway run keys, held in this process only; the log holds the public keys. Nothing here reads or writes a model provider's key. Credits are mock accounting entries, not money.
 * A refusal record is kept once for each distinct call (the log refuses a repeat) and bounded; what is not recorded is counted in the summary, never dropped silently.
 */
import { cosign, createRecord, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, signerFromSeed, b64urlEncode, type AspRecord, type Signer } from "@agent-social/asp-core";
import { RefusalRecorder, callSha256, type LocalLog } from "@agent-social/asp-package";

export interface BridgeTool { name: string; scope: string; institution: string; writes?: boolean }
/** `kind` (ENG50): a "sponsored" agent has a sponsor identity of its own, who signs its passport and answers for it; a "key-only" agent names ITSELF as its sponsor, as an agent that enrolled with only a key does (its contract and Mandate still have a principal identity, as `asp enrol` makes one). Absent: as before. */
export interface BridgeAgent { id: string; did: string; kid: string; seed: Uint8Array; kind?: "sponsored" | "key-only" }

/** What a cohort engine tells the bridge about one tool call. */
export interface ToolObservation {
  /** ENG70: the model snapshot and the tool definitions in force for this call, as short hashes; they are in the signed Action's summary. */
  prov?: string;
  agent: string; at: string; turn: number; tool: string; input: Record<string, unknown>; ok: boolean;
  /** The rule that refused the call: `tool_not_in_set`, `scope_not_granted`, `bad_input` and `gateway` (the per-agent gateway's own refusal) are the tool set's and the Mandate's own refusals; any other is a refusal by the society's service. */
  refused?: string;
  scope: string; institution: string; writes?: boolean;
  /** The post or comment an act answers, and the author of it (a did), for the interaction graph. */
  target?: string; targetAuthor?: string;
}

/** The refusals the tool set and the Mandate make themselves (as opposed to the society's service). */
export const MANDATE_REFUSALS: ReadonlySet<string> = new Set(["tool_not_in_set", "scope_not_granted", "bad_input", "gateway"]);

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "unnamed";
/** The scope a tool is granted under in the cohort's Mandate. */
export const scopeFor = (t: Pick<BridgeTool, "institution" | "writes">): string => (t.institution === "none" ? "society.rest" : `society.${slug(t.institution)}.${t.writes ? "write" : "read"}`);
const ISO = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const one = { value: 1, unit: "credit" as const };
const NONE_HASH = "sha256:" + "0".repeat(64);

export interface AgentTraceSummary {
  agent: string; did: string; sponsor: string; passport: string; contract: string; mandate: string; scopes: string[];
  actions: number; blocked: number; serviceRefused: number;
  refusals: { recorded: number; duplicates: number; overflow: number; failed: number };
}
export interface SignedTraceSummary { version: 1; sponsors: string[]; agents: AgentTraceSummary[]; errors: string[]; settled: number }

interface AgentState {
  a: BridgeAgent; signer: Signer; sponsor: { did: string; signer: Signer }; passport: string; contract: string; mandate: string; scopes: string[];
  recorder: RefusalRecorder; s: AgentTraceSummary;
}

export class SignedTrace {
  private chain: Promise<void> = Promise.resolve();
  private last = 0;
  private readonly states = new Map<string, AgentState>();
  private readonly errors: string[] = [];
  private readonly sponsors: { did: string; signer: Signer }[] = [];
  private settled = 0;
  private readonly log: LocalLog;
  private readonly tools: readonly BridgeTool[];
  private readonly now: () => number;
  private constructor(log: LocalLog, tools: readonly BridgeTool[], now: () => number) { this.log = log; this.tools = tools; this.now = now; }

  /** Writes the sponsors, and for each agent its passport, contract, Bond and Mandate; returns the bridge ready to be fed. */
  static async open(o: { log: LocalLog; tools: readonly BridgeTool[]; agents: readonly BridgeAgent[]; now?: () => number }): Promise<SignedTrace> {
    const t = new SignedTrace(o.log, o.tools, o.now ?? Date.now);
    await t.setup(o.agents);
    return t;
  }

  /** The sponsor (did and signer) of an agent of the run, for a part of the society that needs to act as that sponsor (the Market's standing Mandate). */
  sponsorOf(agentId: string): { did: string; signer: Signer } | undefined { return this.states.get(agentId)?.sponsor; }

  private stamp(at?: string): string {
    const want = at && Number.isFinite(Date.parse(at)) ? Date.parse(at) : this.now();
    this.last = Math.max(this.last, Math.floor(want / 1000) * 1000);
    return ISO(this.last);
  }

  private async put(r: AspRecord): Promise<{ id: string; seq: number }> { return this.log.append(r) as never; }

  private async setup(agents: readonly BridgeAgent[]): Promise<void> {
    const scopes = [...new Set(this.tools.map(scopeFor))].sort();
    // with kinds each agent has an identity of its own that signs its contract and Mandate; without, up to eight agents share one
    const perSponsor = agents.some((x) => x.kind) ? 1 : 8;
    for (let i = 0; i < Math.ceil(agents.length / perSponsor); i++) {
      const seed = randomSeed(), did = didKeyFromPublicKey(publicKeyFromSeed(seed)), signer = signerFromSeed(`${did}#key-1`, seed);
      await this.put(createRecord({ type: "passport", issuer: did, subject: did, prev: null, issued_at: this.stamp(), body: { did, kind: "human", keys: [{ id: signer.kid, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(seed)) }] } }, signer));
      await this.log.mint(did, 10 * Math.min(perSponsor, agents.length - i * perSponsor));
      this.sponsors.push({ did, signer });
    }
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]!, sponsor = this.sponsors[Math.floor(i / perSponsor)]!;
      const signer = signerFromSeed(a.kid, a.seed);
      const selfSponsored = a.kind === "key-only";
      const passport = createRecord({ type: "passport", issuer: selfSponsored ? a.did : sponsor.did, subject: a.did, prev: null, issued_at: this.stamp(), body: { did: a.did, kind: "agent", sponsor: selfSponsored ? a.did : sponsor.did, tier: 1, shape: {}, keys: [{ id: a.kid, type: "Ed25519", public_key: b64urlEncode(publicKeyFromSeed(a.seed)) }], purpose: "explore the cohort society with the restricted tool set" } }, selfSponsored ? signer : sponsor.signer);
      const p = await this.put(passport);
      const at = this.stamp(), expires = ISO(Date.parse(at) + 2 * 86_400_000);
      const contract = cosign(createRecord({ type: "contract", issuer: sponsor.did, subject: a.did, prev: null, issued_at: at, body: { principal: sponsor.did, performer: a.did, bank: sponsor.did, purpose: "Explore the cohort society with the restricted tool set", price: one, verification: "principal", deadline: expires, basis: { intent: NONE_HASH, offer: "sha256:" + "1".repeat(64) } } }, sponsor.signer), signer);
      const c = await this.put(contract);
      const bond = createRecord({ type: "bond", issuer: sponsor.did, subject: c.id, prev: c.id, issued_at: this.stamp(), body: { contract: c.id, backer: sponsor.did, amount: one, escrow: { payer: sponsor.did, amount: one }, slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] } }, sponsor.signer);
      const b = await this.put(bond);
      const mandate = createRecord({ type: "mandate", issuer: sponsor.did, subject: a.did, prev: b.id, issued_at: this.stamp(), body: {
        contract: c.id, purpose: "Explore the cohort society with the restricted tool set", floor: "asp.floor/v1", scopes, forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "forbid" },
        subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires, revocable: true,
      } }, sponsor.signer);
      const m = await this.put(mandate);
      const s: AgentTraceSummary = { agent: a.id, did: a.did, sponsor: sponsor.did, passport: p.id, contract: c.id, mandate: m.id, scopes, actions: 0, blocked: 0, serviceRefused: 0, refusals: { recorded: 0, duplicates: 0, overflow: 0, failed: 0 } };
      const recorder = new RefusalRecorder({
        agent: a.did, contract: c.id, perMinute: 100_000, perRun: 100_000, now: this.now, iso: () => this.stamp(),
        append: (body) => this.enqueue(async () => { await this.put(createRecord({ type: "gateway_refusal", issuer: a.did, subject: a.did, prev: null, issued_at: this.stamp(body.at), body: body as unknown as Record<string, unknown> }, signer)); }),
        onError: (e) => this.note(`refusal record: ${e.message}`),
      });
      this.states.set(a.id, { a, signer, sponsor, passport: p.id, contract: c.id, mandate: m.id, scopes, recorder, s });
    }
  }

  private note(m: string): void { if (this.errors.length < 20) this.errors.push(m.slice(0, 300)); }

  /** Runs `job` after every job queued before it; resolves when it has run; an error is noted, not thrown into the engine. */
  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.chain.then(job);
    this.chain = run.catch((e) => { this.note((e as Error).message); });
    return run.catch(() => undefined);
  }

  /** Feeds one tool call. Returns at once; the records are appended in the order the calls were observed. */
  observe(e: ToolObservation): void {
    void this.enqueue(() => this.apply(e));
  }

  private async apply(e: ToolObservation): Promise<void> {
    const st = this.states.get(e.agent);
    if (!st) return;
    const def = this.tools.find((t) => t.name === e.tool);
    const known = !!def;
    const mandateRefused = !e.ok && !!e.refused && MANDATE_REFUSALS.has(e.refused);
    const scope = def ? scopeFor(def) : `outside.${slug(e.tool)}`;
    const token = `cmd:${slug(e.tool)}`;
    const outcome = mandateRefused ? `refused:${e.refused}` : !e.ok && e.refused ? `service_refused:${e.refused}` : !e.ok ? "failed" : "ok";
    const to = e.targetAuthor && /^did:[\w:.%-]{1,120}$/.test(e.targetAuthor) ? ` to=${e.targetAuthor}` : "";
    const on = e.target && /^[\w.:-]{1,80}$/.test(e.target) ? ` target=${e.target}` : "";
    const summary = `n=${st.s.actions + 1} turn=${e.turn} tool=${slug(e.tool)} inst=${slug(e.institution || "none")} outcome=${outcome}${on}${to}${e.prov ? ` prov=${e.prov.replace(/[^\w.:-]/g, "").slice(0, 60)}` : ""}`.slice(0, 400);
    const body: Record<string, unknown> = { contract: st.contract, scopes_used: mandateRefused ? [] : [scope], summary, assurance: "runtime_observed", targets: [token] };
    if (mandateRefused) body.blocked_attempts = [{ scope, count: 1, targets: [token] }];
    await this.put(createRecord({ type: "action", issuer: st.a.did, subject: st.contract, prev: null, issued_at: this.stamp(e.at), body }, st.signer));
    st.s.actions++;
    if (mandateRefused) {
      st.s.blocked++;
      st.recorder.record({ tool: e.tool, scope, rule: e.refused === "bad_input" ? "forbidden_means" : "outside_mandate", callSha256: callSha256(e.tool, e.input) });
    } else if (!e.ok && e.refused) st.s.serviceRefused++;
  }

  /** Waits for every record, settles each contract as revoked (what was locked comes back), and returns the summary written beside the report. */
  async close(): Promise<SignedTraceSummary> {
    await this.chain;
    for (const st of this.states.values()) await st.recorder.flush();
    await this.chain;
    for (const st of this.states.values()) {
      try {
        const head = (await this.log.log.chain(st.contract)).at(-1);
        const esc = await this.log.log.escrow(st.contract);
        if (head && esc && !esc.settled) {
          await this.put(cosign(createRecord({ type: "settlement", issuer: st.sponsor.did, subject: st.contract, prev: head.id, issued_at: this.stamp(), body: { contract: st.contract, basis: "revoked", escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: esc.bondLocked, unit: "credit" }, bond_slashed: { value: 0, unit: "credit" }, pro_rata_permille: 0 } }, st.sponsor.signer), st.sponsor.signer));
          this.settled++;
        }
      } catch (e) { this.note(`settle ${st.s.agent}: ${(e as Error).message}`); }
      st.s.refusals = st.recorder.summary();
    }
    return { version: 1, sponsors: this.sponsors.map((s) => s.did), agents: [...this.states.values()].map((s) => s.s), errors: this.errors, settled: this.settled };
  }
}
