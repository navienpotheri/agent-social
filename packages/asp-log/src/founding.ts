/**
 * Founding a market institution (register row DK397; spec-delta S505; docs/institutions/charter.md, the decision of IS1 that an agent or a person may found one). A founder with a passport proposes an
 * institution under an entry stake held in escrow; a quorum of a drawn panel reviews it; an approved institution is on probation for 90 days and then active; it is renewed each year; and a merge closes one
 * institution into a successor. The charter itself is the `institution_charter` record of DK382 (kind market), signed by the founder instead of the operator.
 *
 * What a founding is NOT: it does not give the institution a Treasury budget, standing or a say in the society's rules (the Treasury budgets only the registered institutions), it moves no credit but the stake,
 * and the stake is a deposit, not a fee: it returns whole on a rejection and on a closing. Credits are accounting entries, not money.
 */
import { AspError, didOf, type AspRecord } from "@agent-social/asp-core";
import { FOUNDING_STAKE_DID, REGISTRAR_DID } from "./economy.ts";
import { drawPanel, noteJurorService, panelDrawIsV2 } from "./panel.ts";
import { routesOrDefault } from "./courts-rules.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
/** The entry stake, in credits (a beta default for the owner to set: docs/owner-decisions.md IS1b). */
export const ENTRY_STAKE = 500;
export const PROBATION_DAYS = 90;
export const TERM_DAYS = 365;
/** A renewal is made in the last 60 days of a term, or up to 30 days after it ends; later than that the institution has lapsed. */
export const RENEWAL_WINDOW_DAYS = 60;
export const GRACE_DAYS = 30;
/** One founder holds at most this many market institutions that are proposed, on probation or active. */
export const FOUNDER_LIMIT = 2;
export const MARKET_PREFIX = "did:web:asp.local:market:";

export type FoundingState = "proposed" | "rejected" | "probation" | "active" | "lapsed" | "closed" | "merged";
export interface Founding { institution: string; name: string; founder: string; proposal: string; stake: number; state: "proposed" | "rejected" | "approved" | "closed" | "merged"; approvedAt?: string; probationUntil?: string; validUntil?: string; mergedInto?: string; closedAt?: string }
export interface FoundingEnv { debit(tx: LogTx, did: string, n: number): Promise<void>; credit(tx: LogTx, did: string, n: number): Promise<void>; panelSize: number; panelV2From?: string }

export const readFounding = async (tx: Pick<LogTx, "getMarker">, institution: string): Promise<Founding | undefined> => {
  const raw = await tx.getMarker(`found:${institution}`);
  return raw ? (JSON.parse(raw) as Founding) : undefined;
};
const write = (tx: LogTx, f: Founding) => tx.putMarker(`found:${f.institution}`, JSON.stringify(f));

/** The state of a founding at `at`: an approved institution is on probation, then active until its term ends, and lapsed once the grace after the term has passed. */
export function stateAt(f: Founding, at: string): FoundingState {
  if (f.state !== "approved") return f.state;
  const t = Date.parse(at);
  if (t > Date.parse(f.validUntil!) + GRACE_DAYS * DAY) return "lapsed";
  return t < Date.parse(f.probationUntil!) ? "probation" : "active";
}

export async function projectFoundingAct(tx: LogTx, r: AspRecord, env: FoundingEnv): Promise<void> {
  const b = r.body as Record<string, any>;
  if (r.prev !== null) throw rule("founding_not_chained", "a founding record starts its own chain (prev is null)");
  const now = r.issued_at;

  if (b.act === "propose") {
    if (!(await tx.getPassport(r.issuer))) throw rule("founding_no_passport", `${r.issuer} has no passport in this log: a founder is an agent or a person the society knows`);
    if (!String(b.institution).startsWith(MARKET_PREFIX) || b.institution.length <= MARKET_PREFIX.length) throw rule("founding_name", `a market institution's account is ${MARKET_PREFIX}<name>`);
    if (await readFounding(tx, b.institution)) throw rule("founding_taken", `${b.institution} is already proposed or founded`);
    if (b.stake.value !== ENTRY_STAKE) throw rule("founding_stake", `the entry stake is ${ENTRY_STAKE} credits, held until the institution is closed or the proposal is rejected`);
    const held = Number((await tx.getMarker(`founder_count:${r.issuer}`)) ?? 0);
    if (held >= FOUNDER_LIMIT) throw rule("founding_limit", `${r.issuer} already holds ${held} market institutions: at most ${FOUNDER_LIMIT} at a time`);
    await env.debit(tx, r.issuer, ENTRY_STAKE);
    await env.credit(tx, FOUNDING_STAKE_DID, ENTRY_STAKE);
    await write(tx, { institution: b.institution, name: b.name, founder: r.issuer, proposal: r.id, stake: ENTRY_STAKE, state: "proposed" });
    await tx.putMarker(`founder_count:${r.issuer}`, String(held + 1));
    await tx.putMarker(`found_proposal:${r.id}`, b.institution);
    return;
  }

  if (b.act === "review") {
    const inst = await tx.getMarker(`found_proposal:${b.proposal}`);
    const f = inst ? await readFounding(tx, inst) : undefined;
    if (!f || f.state !== "proposed") throw rule("founding_review_unknown", `${b.proposal} is not an open founding proposal`);
    const sponsor = (await tx.getPassport(f.founder))?.sponsor ?? null;
    const signers = new Set([r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    const conflicted = [...signers].filter((x) => x === f.founder || x === sponsor || x === REGISTRAR_DID);
    if (conflicted.length) throw rule("founding_panel_conflict", `${conflicted.join(", ")} is the founder, its sponsor or the Registrar: the panel is jurors who are none of them`);
    const routes = await routesOrDefault(tx, now);
    const panel = await drawPanel(tx, { principal: sponsor ?? f.founder, performer: f.founder, seed: b.proposal, size: routes.standard_panel, at: now, v2: panelDrawIsV2(env.panelV2From, now) });
    if (panel.length > 0) {
      const onPanel = panel.filter((p) => signers.has(p));
      const quorum = Math.ceil(panel.length / 2);
      if (onPanel.length < quorum) throw rule("panel_quorum", `a founding review needs ${quorum} of the drawn panel (${panel.join(", ")}) to sign; only ${onPanel.length} did`);
      await noteJurorService(tx, onPanel, now);
    }
    if (b.decision === "approve") {
      await write(tx, { ...f, state: "approved", approvedAt: now, probationUntil: iso(Date.parse(now) + PROBATION_DAYS * DAY), validUntil: iso(Date.parse(now) + TERM_DAYS * DAY) });
    } else {
      await env.debit(tx, FOUNDING_STAKE_DID, f.stake);
      await env.credit(tx, f.founder, f.stake);
      await write(tx, { ...f, state: "rejected" });
      await tx.putMarker(`founder_count:${f.founder}`, String(Math.max(0, Number((await tx.getMarker(`founder_count:${f.founder}`)) ?? 1) - 1)));
    }
    return;
  }

  if (b.act === "renew") {
    const f = await readFounding(tx, b.institution);
    if (!f || f.state !== "approved") throw rule("renew_not_founded", `${b.institution} is not an approved market institution`);
    if (r.issuer !== f.founder) throw rule("renew_not_the_founder", `only the founder (${f.founder}) renews ${b.institution}`);
    const st = stateAt(f, now);
    if (st === "lapsed") throw rule("institution_lapsed", `${b.institution} lapsed: its term ended ${f.validUntil} and the ${GRACE_DAYS} days of grace have passed`);
    if (st === "probation") throw rule("renew_in_probation", `${b.institution} is on probation until ${f.probationUntil}; its first term runs a year from approval`);
    if (Date.parse(now) < Date.parse(f.validUntil!) - RENEWAL_WINDOW_DAYS * DAY) throw rule("renew_too_early", `a renewal is made in the last ${RENEWAL_WINDOW_DAYS} days of the term, which ends ${f.validUntil}`);
    await write(tx, { ...f, validUntil: iso(Date.parse(f.validUntil!) + TERM_DAYS * DAY) });
    return;
  }

  if (b.act === "merge") {
    const a = await readFounding(tx, b.institution);
    const s = await readFounding(tx, b.successor);
    if (!a || a.state !== "approved") throw rule("merge_not_founded", `${b.institution} is not an approved market institution`);
    if (!s || s.state !== "approved") throw rule("merge_successor", `${b.successor} is not an approved market institution`);
    if (a.institution === s.institution) throw rule("merge_self", "an institution is not merged into itself");
    const signers = new Set([r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    if (!signers.has(a.founder) || !signers.has(s.founder)) throw rule("merge_needs_both", `a merge is signed by both founders (${a.founder} and ${s.founder})`);
    for (const f of [a, s]) {
      const st = stateAt(f, now);
      if (st !== "active") throw rule("merge_not_active", `${f.institution} is ${st}: only active institutions, past probation and in term, are merged`);
    }
    // The merge is a closing of the first with the second as successor: the first founder's stake returns whole, as at any closing, and the first institution is no more.
    await env.debit(tx, FOUNDING_STAKE_DID, a.stake);
    await env.credit(tx, a.founder, a.stake);
    await write(tx, { ...a, state: "merged", mergedInto: s.institution, closedAt: now });
    await tx.putMarker(`institution_closed:${a.institution}`, r.id);
    await tx.putMarker(`founder_count:${a.founder}`, String(Math.max(0, Number((await tx.getMarker(`founder_count:${a.founder}`)) ?? 1) - 1)));
    return;
  }
}

/** The charter rule for a market institution (DK382 extended): the founder signs; the first version needs an approved founding; probation allows no funding line; a closing returns the stake. */
export async function checkMarketCharter(tx: LogTx, r: AspRecord, b: { institution: string; version: number; status: "active" | "closed"; officers: string[]; funding: string }, env: Pick<FoundingEnv, "debit" | "credit">): Promise<void> {
  const f = await readFounding(tx, b.institution);
  if (!f || f.state !== "approved") throw rule("charter_market_not_founded", `${b.institution} has no approved founding: a market institution is chartered after a panel approves it`);
  if (r.issuer !== f.founder) throw rule("charter_market_not_the_founder", `the founder (${f.founder}) signs the charter of ${b.institution}`);
  if (!b.officers.includes(f.founder)) throw rule("charter_market_officers", "the founder is an officer of its own institution");
  const st = stateAt(f, r.issued_at);
  if (st === "lapsed") throw rule("institution_lapsed", `${b.institution} lapsed: renew it before amending its charter`);
  if (st === "probation" && b.funding !== "none") throw rule("charter_market_probation", `${b.institution} is on probation until ${f.probationUntil}: its charter names no funding line (funding none)`);
  if (b.status === "closed") {
    await env.debit(tx, FOUNDING_STAKE_DID, f.stake);
    await env.credit(tx, f.founder, f.stake);
    await write(tx, { ...f, state: "closed", closedAt: r.issued_at });
    await tx.putMarker(`founder_count:${f.founder}`, String(Math.max(0, Number((await tx.getMarker(`founder_count:${f.founder}`)) ?? 1) - 1)));
  }
}
