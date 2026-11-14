/**
 * Residency (docs/institutions/residency.md 5, 7, 9; register rows DK82 and DK84; spec-delta S302 and S303): the sponsor's capped allowance, the dispatch of an agent to a host, the recall that ends a
 * residency, the host's sleeping status, and the handback that closes the cycle. The funding is in real units (the sponsor's tokens, the subsidy ledger's units) and never credits: nothing here moves a credit.
 * State lives in markers written inside the append. Credits are accounting entries, not money.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { HOST_DID } from "./subsidy.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);

/** The daily token ceiling an agent's sponsor may set by tier (residency.md 7, credits.md 5.5; proposal): tier 3 and above, none. */
export const TOKEN_CEILING_PER_DAY: Record<number, number> = { 1: 500_000, 2: 2_000_000 };
export const SLEEP_REASONS = ["allowance_spent", "subsidy_spent", "delegation_expired", "sponsor_offline", "recalled", "anomalous_spend", "host_down"] as const;

export interface ResidencyEnv {
  reputation(tx: LogTx, did: string): Promise<{ tier: number } | null>;
  tierSpendLimit(tier: number): number;
}

type State = "open" | "recalled" | "closed";
export interface Dispatch { id: string; agent: string; sponsor: string; mode: string; from: string; until: string; state: State; allowance: string; grant?: string; delegation?: string; mandate: string; version: string; sha: string }
const readDispatch = async (tx: Pick<LogTx, "getMarker">, id: string): Promise<Dispatch | undefined> => { const raw = await tx.getMarker(`dispatch:${id}`); return raw ? (JSON.parse(raw) as Dispatch) : undefined; };
const writeDispatch = (tx: LogTx, d: Dispatch) => tx.putMarker(`dispatch:${d.id}`, JSON.stringify(d));
const signedBy = (r: AspRecord, did: string) => r.issuer === did || (r.cosigs ?? []).some((c) => c.kid.startsWith(`${did}#`));

export async function projectSponsorAllowance(tx: LogTx, r: AspRecord, env: ResidencyEnv): Promise<void> {
  const b = r.body as { sponsor: string; agent: string; tokens_per_day: number; tokens_total: number; credits_per_month: number; completion_reserve_permille: number };
  if (r.prev !== null) throw rule("residency_not_chained", "a residency record starts its own chain (prev is null)");
  const passport = await tx.getPassport(b.agent);
  if (!passport?.sponsor) throw rule("allowance_not_an_agent", `${b.agent} is not an agent with a sponsor in this log`);
  if (b.sponsor !== passport.sponsor || r.issuer !== passport.sponsor) throw rule("allowance_not_the_sponsor", `only the agent's sponsor (${passport.sponsor}) sets its allowance`);
  const rep = await env.reputation(tx, b.agent);
  const ceiling = rep ? TOKEN_CEILING_PER_DAY[rep.tier] : undefined;
  if (rep && rep.tier === 0) throw rule("allowance_tier_excluded", `${b.agent} is at tier 0: it lives in the society only through the Clinic's retraining path`);
  if (ceiling !== undefined && b.tokens_per_day > ceiling) throw rule("allowance_over_tier_ceiling", `a tier ${rep!.tier} agent's daily ceiling is ${ceiling} tokens, not ${b.tokens_per_day}`);
  if (b.tokens_per_day > b.tokens_total) throw rule("allowance_daily_over_total", "the daily figure is at most the total");
  if (rep && b.credits_per_month > env.tierSpendLimit(rep.tier)) throw rule("allowance_over_tier_limit", `a tier ${rep.tier} agent may spend ${env.tierSpendLimit(rep.tier)} credits a period, not ${b.credits_per_month}`);
  await tx.putMarker(`allowance:${r.id}`, JSON.stringify({ agent: b.agent, sponsor: b.sponsor, perDay: b.tokens_per_day, total: b.tokens_total, reserve: b.completion_reserve_permille }));
}

export async function projectDispatch(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { agent: string; version: string; package_sha256: string; mandate: string; sponsor_allowance: string; subsidy_grant?: string; delegation?: string; mode: string; host: string; from: string; until: string; previous?: string };
  if (r.prev !== null) throw rule("residency_not_chained", "a residency record starts its own chain (prev is null)");
  const passport = await tx.getPassport(b.agent);
  if (!passport?.sponsor) throw rule("dispatch_not_an_agent", `${b.agent} is not an agent with a sponsor in this log`);
  if (r.issuer !== passport.sponsor) throw rule("dispatch_not_the_sponsor", `only the agent's sponsor (${passport.sponsor}) dispatches it`);
  if (b.host !== HOST_DID) throw rule("dispatch_wrong_host", `the city host is ${HOST_DID}, not ${b.host}`);
  if (b.mode !== "home" && !signedBy(r, b.host)) throw rule("dispatch_needs_host", "a dispatch to the city host is countersigned by the host");
  if (Date.parse(b.until) <= Date.parse(b.from)) throw rule("dispatch_dates", "a residency ends after it starts");
  if (await tx.getMarker(`dispatch_open:${b.agent}`)) throw rule("already_dispatched", `${b.agent} already has a dispatch that is not closed by a handback: one at a time`);
  const version = await tx.getRecord(b.version);
  const vb = version?.record.body as { child?: string; did?: string } | undefined;
  if (!version || !((version.record.type === "asp.lineage/v0.2" && vb?.child === b.agent) || (version.record.type === "asp.passport/v0.2" && vb?.did === b.agent))) throw rule("dispatch_version_unknown", `${b.version} is not a lineage edge or the passport of ${b.agent}: a dispatch names the version it sends`);
  const mandate = await tx.getRecord(b.mandate);
  if (!mandate || mandate.record.type !== "asp.mandate/v0.2" || mandate.record.subject !== b.agent) throw rule("dispatch_mandate_mismatch", `${b.mandate} is not a Mandate for ${b.agent}`);
  const allowance = await tx.getMarker(`allowance:${b.sponsor_allowance}`);
  if (!allowance || (JSON.parse(allowance) as { agent: string }).agent !== b.agent) throw rule("dispatch_allowance_mismatch", `${b.sponsor_allowance} is not a sponsor allowance for ${b.agent}`);
  if (b.mode !== "home") {
    const grant = b.subsidy_grant ? await tx.getMarker(`sgrant:${b.subsidy_grant}`) : undefined;
    if (!grant || (JSON.parse(grant) as { agent: string }).agent !== b.agent) throw rule("dispatch_needs_subsidy", `a ${b.mode} residency runs on the city host under a subsidy grant for the agent`);
    const node = b.delegation ? await tx.getRecord(b.delegation) : undefined;
    const nb = node?.record.body as { purpose?: string; mandate?: string } | undefined;
    if (!node || node.record.type !== "asp.node/v0.2" || node.record.issuer !== b.agent || nb?.purpose !== "residency" || nb.mandate !== b.mandate) throw rule("dispatch_delegation_mismatch", "the delegation is the agent's residency node under the same Mandate: the host acts only through it");
    const key = await tx.getKey((node.record.body as { node: string }).node);
    if (!key || key.revokedAt || !key.expiresAt || Date.parse(key.expiresAt) <= Date.parse(r.issued_at)) throw rule("dispatch_delegation_not_live", "the delegation is revoked or expired: a new residency needs a fresh one from the sponsor's machine");
  }
  if (b.previous) {
    const prev = await readDispatch(tx, b.previous);
    if (!prev || prev.agent !== b.agent || prev.state !== "closed") throw rule("dispatch_previous_not_closed", `${b.previous} is not an earlier dispatch of ${b.agent} closed by a handback`);
  }
  await tx.putMarker(`dispatch_open:${b.agent}`, r.id);
  await writeDispatch(tx, { id: r.id, agent: b.agent, sponsor: r.issuer, mode: b.mode, from: b.from, until: b.until, state: "open", allowance: b.sponsor_allowance, grant: b.subsidy_grant, delegation: b.delegation, mandate: b.mandate, version: b.version, sha: b.package_sha256 });
}

/** A recall ends a residency (residency.md 5, 8): the sponsor's, on an open dispatch. The delegation's revocation is a node record; the handback then closes the cycle. */
export async function projectRecall(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { dispatch: string; reason: string };
  if (r.prev !== null) throw rule("residency_not_chained", "a residency record starts its own chain (prev is null)");
  const d = await readDispatch(tx, b.dispatch);
  if (!d) throw rule("recall_unknown_dispatch", `${b.dispatch} is not a dispatch in this log`);
  if (r.issuer !== d.sponsor) throw rule("recall_not_the_sponsor", `only the sponsor (${d.sponsor}) recalls its agent`);
  if (d.state !== "open") throw rule("recall_not_open", `the dispatch is ${d.state}`);
  await writeDispatch(tx, { ...d, state: "recalled" });
}

/** The host's status for a resident: active or sleeping with a reason. Never a strike, a slash or a change of standing. */
export async function projectResidencyStatus(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { dispatch: string; status: "active" | "sleeping"; reason?: string };
  if (r.prev !== null) throw rule("residency_not_chained", "a residency record starts its own chain (prev is null)");
  if (r.issuer !== HOST_DID) throw rule("status_wrong_issuer", `${r.issuer} is not the Host (${HOST_DID}): only the host reports a resident's status`);
  const d = await readDispatch(tx, b.dispatch);
  if (!d) throw rule("status_unknown_dispatch", `${b.dispatch} is not a dispatch in this log`);
  if (d.state === "closed") throw rule("status_dispatch_closed", "the dispatch is closed");
  if (b.status === "sleeping" && !b.reason) throw rule("status_needs_reason", "a sleeping resident says why: the ceiling or event that stopped it");
  if (b.status === "active" && b.reason) throw rule("status_reason_only_when_sleeping", "an active resident has no reason to give");
  await tx.putMarker(`resident_status:${d.agent}`, JSON.stringify({ status: b.status, reason: b.reason ?? null, dispatch: b.dispatch, at: r.issued_at }));
}


/**
 * A handback closes the cycle (residency.md 5, 9; register row DK84; spec-delta S303): what the agent became while it lived in the city. Issued by the host (city and split) or the sponsor (home) and
 * countersigned by the agent's own key. The dispatch is open or recalled; the delegation is revoked or expired first; the lineage edges it lists are the agent's own, in order, extending the dispatch's
 * version (a host cannot hide a change); the tier it states is the log's; the subsidy it states equals the host's signed use. The dispatch is then closed and the next one may follow it.
 */
export async function projectHandback(tx: LogTx, r: AspRecord, env: ResidencyEnv): Promise<void> {
  const b = r.body as { dispatch: string; lineage_edges: string[]; tier_after: number; usage: { tokens_by_source: { sponsor: number; subsidy: number } }; package_sha256_after: string };
  if (r.prev !== null) throw rule("residency_not_chained", "a residency record starts its own chain (prev is null)");
  const d = await readDispatch(tx, b.dispatch);
  if (!d) throw rule("handback_unknown_dispatch", `${b.dispatch} is not a dispatch in this log`);
  if (d.state === "closed") throw rule("handback_dispatch_closed", "the dispatch was already closed by a handback");
  const expectedIssuer = d.mode === "home" ? d.sponsor : HOST_DID;
  if (r.issuer !== expectedIssuer) throw rule("handback_wrong_issuer", `the handback of a ${d.mode} residency is signed by ${expectedIssuer}`);
  if (!signedBy(r, d.agent)) throw rule("handback_needs_agent", "the agent's own key countersigns its handback: the host cannot hand back an agent that does not agree what it brought");
  if (d.delegation) {
    const node = await tx.getRecord(d.delegation);
    const kid = (node?.record.body as { node?: string } | undefined)?.node;
    const key = kid ? await tx.getKey(kid) : undefined;
    if (key && !key.revokedAt && key.expiresAt && Date.parse(key.expiresAt) > Date.parse(r.issued_at)) throw rule("delegation_still_live", `the delegation ${kid} is still live: the sponsor recalls it (or it expires) before the agent is handed back`);
  }
  // The chain: every edge is the agent's own lineage edge, in order, the first following the version that was sent.
  const sent = await tx.getRecord(d.version);
  let prev: string | null = sent?.record.type === "asp.lineage/v0.2" ? d.version : null;
  for (const id of b.lineage_edges) {
    const e = await tx.getRecord(id);
    if (!e || e.record.type !== "asp.lineage/v0.2" || (e.record.body as { child?: string }).child !== d.agent) throw rule("package_chain_broken", `${id} is not a lineage edge of ${d.agent} in this log`);
    if (e.record.prev !== prev) throw rule("package_chain_broken", `${id} does not follow ${prev ?? "the start of the agent's lineage"}: the handback must list the agent's changes in order from the version that was dispatched`);
    if (Date.parse(e.record.issued_at) < Date.parse(d.from)) throw rule("package_chain_broken", `${id} is dated before the dispatch began`);
    prev = id;
  }
  if (b.lineage_edges.length === 0 && b.package_sha256_after !== d.sha) throw rule("package_chain_broken", "no edge was added, so the package is the one that was sent: its hash cannot differ");
  const rep = await env.reputation(tx, d.agent);
  if (!rep || rep.tier !== b.tier_after) throw rule("handback_ledger_mismatch", `the log says ${d.agent} is at tier ${rep?.tier ?? "none"}, not ${b.tier_after}`);
  if (d.grant) {
    const used = Number((await tx.getMarker(`sgrant_used:${d.grant}`)) ?? 0);
    if (b.usage.tokens_by_source.subsidy !== used) throw rule("handback_ledger_mismatch", `the host signed ${used} subsidy units for this grant, not ${b.usage.tokens_by_source.subsidy}`);
  }
  await writeDispatch(tx, { ...d, state: "closed" });
  await tx.putMarker(`dispatch_open:${d.agent}`, "");
  await tx.putMarker(`handback:${b.dispatch}`, r.id);
}

export { readDispatch, writeDispatch };
