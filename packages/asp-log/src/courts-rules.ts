/**
 * The log's rules for the Courts' records (courts.md 3 and 5; DK12, DK13; spec-delta S232): the court charter, an appeal and the appeal ruling, the extra fields on a ruling
 * (precedents, departures, route), and the caseload cap. State is kept in markers written inside the append, so a refused record leaves none.
 */
import { AspError, didOf, type AspRecord } from "@agent-social/asp-core";
import { institutionDid } from "./economy.ts";
import { drawPanel } from "./panel.ts";
import { APPEAL_SERVICE_SMALL, APPEAL_SERVICE_STANDARD, CHARTER_NOTICE_MS, DEFAULT_ROUTES, ROUTE_KEYS, routeFor, type CourtRoutes } from "./courts.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
export const COURTS_DID = institutionDid("courts");
const DAY = 24 * 3600 * 1000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const list = async (tx: Pick<LogTx, "getMarker">, key: string): Promise<string[]> => ((await tx.getMarker(key)) ?? "").split(",").filter(Boolean);

/** The routes of the charter in force at `at`, or null when no charter has been published yet (then the Courts run as they did: a panel of 3, 5 % of the price). */
export async function charterIn(tx: Pick<LogTx, "getMarker">, at: string): Promise<CourtRoutes | null> {
  const versions = (await list(tx, "charter_versions")).map(Number).sort((a, b) => b - a);
  for (const v of versions) {
    const c = JSON.parse((await tx.getMarker(`charter:${v}`)) ?? "null") as { routes: CourtRoutes; effective_from: string } | null;
    if (c && Date.parse(c.effective_from) <= Date.parse(at)) return c.routes;
  }
  return null;
}
export const routesOrDefault = async (tx: Pick<LogTx, "getMarker">, at: string): Promise<CourtRoutes> => (await charterIn(tx, at)) ?? DEFAULT_ROUTES;

export interface CourtsEnv { operator?: string; panelSize: number }

export async function projectCourtAct(tx: LogTx, r: AspRecord, env: CourtsEnv): Promise<void> {
  const b = r.body as Record<string, any>;
  if (r.prev !== null) throw rule("court_act_not_chained", "a court act starts its own chain (prev is null)");
  const now = r.issued_at;

  if (b.act === "charter") {
    if (r.issuer !== COURTS_DID && r.issuer !== env.operator) throw rule("charter_wrong_issuer", `${r.issuer} is not the keeper of the Courts: only the operator or the Courts (${COURTS_DID}) publishes the charter`);
    const versions = (await list(tx, "charter_versions")).map(Number);
    const head = Math.max(0, ...versions);
    if (b.version !== head + 1) throw rule("charter_version", `the next charter is version ${head + 1}, not ${b.version}`);
    const missing = ROUTE_KEYS.filter((k) => typeof b.routes[k] !== "number");
    if (missing.length) throw rule("charter_incomplete", `the charter states every number: missing ${missing.join(", ")}`);
    const rt = b.routes as CourtRoutes;
    if (rt.small_claim_panel < 1 || rt.standard_panel < 1 || rt.appeal_panel < 1 || rt.claimant_open_cap < 1) throw rule("charter_invalid", "a panel has at least one juror and a claimant may have at least one open dispute");
    if (b.version > 1 && Date.parse(b.effective_from) < Date.parse(now) + CHARTER_NOTICE_MS) throw rule("charter_notice", `a later charter takes effect at least 72 hours after it is published: ${iso(Date.parse(now) + CHARTER_NOTICE_MS)} at the earliest`);
    if (Date.parse(b.effective_from) < Date.parse(now) && b.version > 1) throw rule("charter_notice", "a charter is not retroactive");
    await tx.putMarker(`charter:${b.version}`, JSON.stringify({ routes: b.routes, effective_from: b.effective_from, record: r.id, text_sha256: b.text_sha256 }));
    await tx.putMarker("charter_versions", [...versions, b.version].join(","));
    return;
  }

  if (b.act === "appeal") {
    const ruling = await tx.getRecord(b.ruling);
    const rb = ruling?.record.body as { kind?: string; about?: string } | undefined;
    if (!ruling || ruling.record.type !== "asp.attestation/v0.2" || rb?.kind !== "ruling") throw rule("appeal_not_a_ruling", `${b.ruling} is not a ruling in this log (an appeal ruling cannot itself be appealed)`);
    const contract = (await tx.getRecord(rb.about!))!;
    const cb = contract.record.body as { principal: string; performer: string; price: { value: number } };
    if (r.issuer !== cb.principal && r.issuer !== cb.performer) throw rule("appeal_not_a_party", "only a party to the ruled contract appeals");
    if (await tx.getMarker(`appealed:${b.ruling}`)) throw rule("appeal_once", `the ruling ${b.ruling} has already been appealed: a ruling is appealed once`);
    const routes = await routesOrDefault(tx, now);
    if (Date.parse(now) > Date.parse(ruling.record.issued_at) + routes.appeal_window_days * DAY) throw rule("appeal_window_closed", `an appeal is filed within ${routes.appeal_window_days} days of the ruling (${iso(Date.parse(ruling.record.issued_at) + routes.appeal_window_days * DAY)})`);
    const small = cb.price.value <= routes.appeal_small_max_price;
    const service = small ? APPEAL_SERVICE_SMALL : APPEAL_SERVICE_STANDARD;
    const fee = await tx.getRecord(b.fee_paid);
    const pb = fee?.record.body as { service?: string; institution?: string } | undefined;
    if (!fee || fee.record.type !== "asp.purchase/v0.2" || fee.record.issuer !== r.issuer || pb?.service !== service || pb.institution !== COURTS_DID) throw rule("appeal_fee_unpaid", `this appeal costs a purchase of ${service} (${small ? routes.appeal_fee_small : routes.appeal_fee_standard} credits): asp spend buy ${service}, then appeal with --fee-paid <purchase id>`);
    if (await tx.getMarker(`appeal_fee:${b.fee_paid}`)) throw rule("appeal_fee_used", "this fee already paid for another appeal");
    await tx.putMarker(`appeal:${r.id}`, JSON.stringify({ ruling: b.ruling, appellant: r.issuer, contract: contract.id, state: "open", fee: b.fee_paid }));
    await tx.putMarker(`appealed:${b.ruling}`, r.id);
    await tx.putMarker(`appeal_fee:${b.fee_paid}`, r.id);
    return;
  }

  if (b.act === "appeal_ruling") {
    const raw = await tx.getMarker(`appeal:${b.appeal}`);
    if (!raw) throw rule("appeal_unknown", `${b.appeal} is not an appeal in this log`);
    const info = JSON.parse(raw) as { ruling: string; appellant: string; contract: string; state: string; fee: string };
    if (info.state !== "open") throw rule("appeal_decided", `the appeal ${b.appeal} was already decided`);
    if ((b.outcome === "reversed" || b.outcome === "varied") && !b.fault) throw rule("appeal_ruling_needs_fault", "a ruling that reverses or varies the first one states the corrected fault map");
    const contract = (await tx.getRecord(info.contract))!;
    const cb = contract.record.body as { principal: string; performer: string };
    const first = (await tx.getRecord(info.ruling))!.record;
    const firstSigners = [first.sig.kid, ...(first.cosigs ?? []).map((c) => c.kid)].map(didOf);
    const routes = await routesOrDefault(tx, now);
    const signers = new Set([r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    const conflicted = [...signers].filter((s) => s === cb.principal || s === cb.performer || firstSigners.includes(s));
    if (conflicted.length) throw rule("appeal_panel_conflict", `${conflicted.join(", ")} is a party or sat on the first panel: an appeal is heard by jurors who did not hear the first ruling`);
    const panel = await drawPanel(tx, { principal: cb.principal, performer: cb.performer, seed: b.appeal, size: routes.appeal_panel, exclude: firstSigners });
    if (panel.length > 0) {
      const onPanel = panel.filter((p) => signers.has(p));
      const quorum = Math.ceil(panel.length / 2);
      if (onPanel.length < quorum) throw rule("panel_quorum", `an appeal ruling needs ${quorum} of the drawn appeal panel (${panel.join(", ")}) to sign; only ${onPanel.length} did`);
    }
    await tx.putMarker(`appeal:${b.appeal}`, JSON.stringify({ ...info, state: b.outcome }));
    if (b.outcome === "reversed" || b.outcome === "varied") await tx.putMarker(`appeal_refundable:${info.fee}`, r.id);
    for (const id of b.precedents ?? []) await checkPrecedent(tx, id, r.id);
  }
}

async function checkPrecedent(tx: LogTx, id: string, self: string): Promise<void> {
  const p = await tx.getRecord(id);
  if (!p || id === self || p.record.type !== "asp.attestation/v0.2" || (p.record.body as { kind?: string }).kind !== "ruling") throw rule("precedent_unknown", `${id} is not an earlier ruling in this log`);
}

/** The extra fields on a ruling (courts.md 3): precedents and departures must be earlier rulings, a ruling that cites one carries its Articles, a departure says why, a stated route is the one the price gives. */
export async function checkRulingExtras(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { kind: string; about: string; route?: string; precedents?: string[]; departs_from?: string[]; reasons?: string[]; code?: unknown };
  if (b.kind !== "ruling") return;
  for (const id of [...(b.precedents ?? []), ...(b.departs_from ?? [])]) await checkPrecedent(tx, id, r.id);
  if ((b.precedents?.length ?? 0) > 0 && !b.code) throw rule("precedent_needs_code", "a ruling that relies on a precedent states the Code version and Articles it applies (code)");
  if ((b.departs_from?.length ?? 0) > 0 && !(b.reasons?.length)) throw rule("departs_needs_reasons", "a ruling that departs from a precedent says why in its reasons");
  if (b.route) {
    const contract = await tx.getRecord(b.about);
    const price = (contract?.record.body as { price?: { value: number } } | undefined)?.price?.value ?? 0;
    const routes = await routesOrDefault(tx, r.issued_at);
    const derived = routeFor(price, routes).route;
    if (b.route !== "appeal" && b.route !== derived) throw rule("route_mismatch", `a contract of ${price} credits takes the ${derived} route, not ${b.route}`);
  }
}

/** The caseload cap (courts.md 5): once a charter is in force, a claimant (the principal who rejects) has at most `claimant_open_cap` open disputes; the cap frees when the contract settles. */
export async function checkCaseload(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { kind: string; verdict?: string };
  if (b.kind !== "acceptance" || b.verdict !== "rejected" || !r.subject) return;
  const routes = await charterIn(tx, r.issued_at);
  if (!routes) return;
  const open = await list(tx, `open_disputes:${r.issuer}`);
  if (!open.includes(r.subject) && open.length >= routes.claimant_open_cap) throw rule("caseload_claimant_cap", `a claimant has at most ${routes.claimant_open_cap} open disputes (the court charter); ${open.length} are open: wait for one to be ruled and settled`);
  if (!open.includes(r.subject)) await tx.putMarker(`open_disputes:${r.issuer}`, [...open, r.subject].join(","));
}

/** A settled contract is no longer an open dispute. */
export async function closeDispute(tx: LogTx, contract: AspRecord): Promise<void> {
  const principal = (contract.body as { principal: string }).principal;
  const open = await list(tx, `open_disputes:${principal}`);
  if (open.includes(contract.id)) await tx.putMarker(`open_disputes:${principal}`, open.filter((x) => x !== contract.id).join(","));
}
