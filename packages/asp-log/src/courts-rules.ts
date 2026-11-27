/**
 * The log's rules for the Courts' records (courts.md 3 and 5; DK12, DK13; spec-delta S232): the court charter, an appeal and the appeal ruling, the extra fields on a ruling
 * (precedents, departures, route), and the caseload cap. State is kept in markers written inside the append, so a refused record leaves none.
 */
import { AspError, didOf, type AspRecord } from "@agent-social/asp-core";
import { REGISTRAR_DID, TREASURY_DID, institutionDid, isReservedAccount, splitParts } from "./economy.ts";
import { disputeSeedV3, drawPanel, noteFunder, noteJurorService, panelDrawIsV2, panelDrawIsV3 } from "./panel.ts";
import { APPEAL_SERVICE_SMALL, APPEAL_SERVICE_STANDARD, CHARTER_NOTICE_MS, DEFAULT_ROUTES, ROUTE_KEYS, routeFor, type CourtRoutes } from "./courts.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
export const COURTS_DID = institutionDid("courts");
const DAY = 24 * 3600 * 1000;
/** The most a panel orders paid to a third-party victim in one case, in credits (accounting entries, not money). A beta default: docs/owner-decisions.md H4. */
export const ABUSE_RESTITUTION_CAP = 200;
/** From this time no credit restitution is paid to an outside victim and an upheld abuse ruling names the operator's remedy instead (DK530, S952; owner decision 2026-11-18, H4 and H4b). Rulings before it replay as they were. */
export const ABUSE_RESTITUTION_OFF_FROM = "2026-11-19T00:00:00Z";
/** The hold on a ruling's settlement (S1400, DK121; Code 3.8, owner decision 2026-11-13): an appeal filed in this time can still change the money. */
export const APPEAL_HOLD_MS = 72 * 3600 * 1000;
/** An appeal that nobody has decided this long after it was filed no longer holds the settlement: the ruling stands and the money moves, so a stalled appeal cannot freeze an escrow for ever. */
export const APPEAL_FREEZE_MAX_MS = 7 * DAY;
/** A juror whose ruling is reversed on appeal loses this share of its stake to the Treasury (courts.md 4, CT-13; a proposal value kept in docs/owner-questions.md). */
export const JUROR_PENALTY_PERMILLE = 200;
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

/** The operator answers a contest within this long; after it the contester may go to the Courts without an answer (AG3, S1552; owner answer 2026-11-21). */
export const CONTEST_OPERATOR_MS = 48 * 3600 * 1000;
/** The Courts decide a contest within this long of the case; a later ruling is recorded and marked late. */
export const CONTEST_COURTS_MS = 72 * 3600 * 1000;
export interface CourtsEnv { operator?: string; panelSize: number; panelV2From?: string; panelV3From?: string }

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

  // A Court's replay of a referee-run game (DK685, S986): the Courts record that they recomputed an entrant's transcript from the revealed moves and whether it matches what the result cited.
  if (b.act === "game_replay") {
    if (r.issuer !== COURTS_DID && r.issuer !== env.operator) throw rule("replay_wrong_issuer", `${r.issuer} is not the Courts (${COURTS_DID}) or the operator: only they record a replay`);
    const p = b.replay as { arena: string; season: string; agent: string; transcript_sha256: string; recomputed_sha256: string; outcome: string };
    const key = `${p.arena}|${p.season}`;
    const resId = await tx.getMarker(`arena_result:${key}|${p.agent}`);
    if (!resId) throw rule("replay_no_result", `${p.agent} has no result for ${p.arena} ${p.season} to replay`);
    const action = await tx.getRecord(((await tx.getRecord(resId))!.record.body as { run_log_hash: string }).run_log_hash);
    const cited = ((action?.record.body as { artifacts?: { sha256: string }[] } | undefined)?.artifacts ?? []).some((a) => a.sha256 === p.transcript_sha256);
    if (!cited) throw rule("replay_transcript_not_cited", "the transcript hash is not the one the agent's Action carries for this result");
    if ((p.outcome === "match") !== (p.transcript_sha256 === p.recomputed_sha256)) throw rule("replay_outcome_wrong", "the outcome must say whether the recomputed hash equals the transcript hash");
    await tx.putMarker(`game_replay:${key}|${p.agent}`, JSON.stringify({ outcome: p.outcome, record: r.id }));
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

  // The institutional route (courts.md 3; DK120; spec-delta S466): a holder takes a Registry takedown or suspension to a panel; the institution acts only on the ruling that names the order.
  if (b.act === "case") {
    const subject = await tx.getRecord(b.subject);
    const sb = subject?.record.body as { act?: string; holder?: string; appealable_until?: string; until?: string } | undefined;
    if (!subject || subject.record.type !== "asp.registry_act/v0.2" || (sb?.act !== "name_takedown" && sb?.act !== "identity_suspension")) throw rule("case_subject", `${b.subject} is not a Registry takedown or suspension: a case is about one of them`);
    if (r.issuer !== sb.holder) throw rule("case_not_the_holder", `only the holder (${sb.holder}) takes its takedown or suspension to the Courts`);
    if (await tx.getMarker(`case_for:${b.subject}`)) throw rule("case_once", `${b.subject} already has a case: one case for each act`);
    const closes = sb.act === "name_takedown" ? Date.parse(sb.appealable_until!) : Date.parse(sb.until!);
    if (Date.parse(now) > closes) throw rule("case_window_closed", sb.act === "name_takedown" ? `a takedown is appealed within 14 days: until ${sb.appealable_until}` : `a suspension is taken to the Courts while it lasts: it ended ${sb.until}`);
    const fee = await tx.getRecord(b.fee_paid);
    const pb = fee?.record.body as { service?: string; institution?: string } | undefined;
    if (!fee || fee.record.type !== "asp.purchase/v0.2" || fee.record.issuer !== r.issuer || pb?.service !== APPEAL_SERVICE_SMALL || pb.institution !== COURTS_DID) throw rule("case_fee_unpaid", `a case against an institution costs a purchase of ${APPEAL_SERVICE_SMALL} by the holder`);
    if (await tx.getMarker(`appeal_fee:${b.fee_paid}`)) throw rule("case_fee_used", "this fee already paid for another appeal or case");
    await tx.putMarker(`case:${r.id}`, JSON.stringify({ subject: b.subject, holder: r.issuer, kind: sb.act, state: "open", fee: b.fee_paid }));
    await tx.putMarker(`case_for:${b.subject}`, r.id);
    await tx.putMarker(`appeal_fee:${b.fee_paid}`, r.id);
    return;
  }

  if (b.act === "institutional_ruling") {
    const raw = await tx.getMarker(`case:${b.case}`);
    if (!raw) throw rule("case_unknown", `${b.case} is not a case in this log`);
    const info = JSON.parse(raw) as { subject: string; holder: string; kind: string; state: string; fee: string };
    if (info.state !== "open") throw rule("case_decided", `the case ${b.case} was already ruled on`);
    if (b.order === "restore_name" && info.kind !== "name_takedown") throw rule("order_not_for_this_case", "a name is restored only by a case about a takedown");
    if (b.order === "extend_suspension") {
      if (info.kind !== "identity_suspension") throw rule("order_not_for_this_case", "a suspension is extended only by a case about a suspension");
      const sus = (await tx.getRecord(info.subject))!.record.body as { until: string };
      if (!b.until || Date.parse(b.until) <= Date.parse(sus.until)) throw rule("extension_not_later", `an extension runs past the suspension's own end (${sus.until})`);
      if (Date.parse(b.until) > Date.parse(now) + 90 * DAY) throw rule("extension_too_long", "a Court extends a suspension by at most 90 days at a time");
    }
    const signers = new Set([r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    const conflicted = [...signers].filter((x) => x === info.holder || x === REGISTRAR_DID);
    if (conflicted.length) throw rule("case_panel_conflict", `${conflicted.join(", ")} is the holder or the Registrar: the panel is jurors who are neither`);
    const routes = await routesOrDefault(tx, now);
    const panel = await drawPanel(tx, { principal: info.holder, performer: REGISTRAR_DID, seed: b.case, size: routes.standard_panel, at: now, v2: panelDrawIsV2(env.panelV2From, now) });
    if (panel.length > 0) {
      const onPanel = panel.filter((p) => signers.has(p));
      const quorum = Math.ceil(panel.length / 2);
      if (onPanel.length < quorum) throw rule("panel_quorum", `a ruling on a case needs ${quorum} of the drawn panel (${panel.join(", ")}) to sign; only ${onPanel.length} did`);
      await noteJurorService(tx, onPanel, now);
    }
    await tx.putMarker(`case:${b.case}`, JSON.stringify({ ...info, state: b.order }));
    await tx.putMarker(`order:${r.id}`, JSON.stringify({ case: b.case, order: b.order, subject: info.subject, holder: info.holder, ...(b.until ? { until: b.until } : {}) }));
    if (b.order === "restore_name") await tx.putMarker(`appeal_refundable:${info.fee}`, r.id);
    return;
  }

  // A third party's abuse report as a case (H3, LW5, DK350; spec-delta S502): the Registrar refers an admitted report, a panel hears it and rules, and an upheld finding pays restitution to the reporter.
  if (b.act === "abuse_case") {
    if (r.issuer !== REGISTRAR_DID && r.issuer !== env.operator) throw rule("abuse_case_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}) or the operator: only they refer an abuse report to a panel`);
    const rep = await tx.getRecord(b.report);
    if (!rep || rep.record.type !== "asp.abuse_report/v0.2") throw rule("abuse_case_not_a_report", `${b.report} is not an admitted abuse report in this log`);
    if (await tx.getMarker(`abuse_case_for:${b.report}`)) throw rule("abuse_case_once", `${b.report} already has a case`);
    const accused = (rep.record.body as { accused: string }).accused;
    await tx.putMarker(`abuse_case:${r.id}`, JSON.stringify({ report: b.report, accused, reporter: rep.record.issuer, state: "open", at: now }));
    await tx.putMarker(`abuse_case_for:${b.report}`, r.id);
    return;
  }

  if (b.act === "abuse_ruling") {
    const raw = await tx.getMarker(`abuse_case:${b.case}`);
    if (!raw) throw rule("abuse_case_unknown", `${b.case} is not an abuse case in this log`);
    const info = JSON.parse(raw) as { report: string; accused: string; reporter: string; state: string };
    if (info.state !== "open") throw rule("abuse_case_decided", `the case ${b.case} was already ruled on`);
    if (b.restitution && Date.parse(now) >= Date.parse(ABUSE_RESTITUTION_OFF_FROM)) throw rule("abuse_restitution_off", "a third party is not paid in credits (they mean nothing outside the society): the ruling names the operator's remedy instead, takedown, suspension or a written response");
    if (b.finding === "upheld" && !b.remedy && Date.parse(now) >= Date.parse(ABUSE_RESTITUTION_OFF_FROM)) throw rule("abuse_remedy_needed", "an upheld abuse finding names the operator's remedy: takedown, suspension or written_response");
    if (b.remedy && b.finding !== "upheld") throw rule("abuse_remedy_needs_finding", "a remedy follows an upheld finding only");
    if (b.bad_faith && b.finding !== "dismissed") throw rule("abuse_bad_faith_needs_dismissal", "a report is found false and in bad faith only by a dismissed finding");
    if (b.restitution && b.finding !== "upheld") throw rule("abuse_restitution_needs_finding", "restitution follows an upheld finding only");
    if (b.restitution && b.restitution.amount.value > ABUSE_RESTITUTION_CAP) throw rule("abuse_restitution_cap", `restitution is at most ${ABUSE_RESTITUTION_CAP} credits a case (the Courts' cap)`);
    const accusedPassport = await tx.getPassport(info.accused);
    const sponsor = accusedPassport?.sponsor ?? null;
    const signers = new Set([r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    const conflicted = [...signers].filter((x) => x === info.accused || x === sponsor || x === info.reporter || x === REGISTRAR_DID);
    if (conflicted.length) throw rule("abuse_panel_conflict", `${conflicted.join(", ")} is the accused, its sponsor, the reporter or the Registrar: the panel is jurors who are none of them`);
    const routes = await routesOrDefault(tx, now);
    const panel = await drawPanel(tx, { principal: sponsor ?? info.accused, performer: info.accused, seed: b.case, size: routes.standard_panel, at: now, v2: panelDrawIsV2(env.panelV2From, now) });
    if (panel.length > 0) {
      const onPanel = panel.filter((p) => signers.has(p));
      const quorum = Math.ceil(panel.length / 2);
      if (onPanel.length < quorum) throw rule("panel_quorum", `a ruling on an abuse case needs ${quorum} of the drawn panel (${panel.join(", ")}) to sign; only ${onPanel.length} did`);
      await noteJurorService(tx, onPanel, now);
    }
    // Restitution: the accused's free balance first, then its sponsor's (the sponsor answers for the agent). What is not there is not paid, and the shortfall is on the record. A transfer: supply does not change.
    const asked = b.restitution?.amount.value ?? 0;
    let paid = 0;
    const from: { account: string; amount: number }[] = [];
    for (const payer of [info.accused, sponsor]) {
      if (!payer || paid >= asked) continue;
      const acct = await tx.getAccount(payer);
      const take = Math.min(acct?.balance ?? 0, asked - paid);
      if (take > 0) { await tx.putAccount({ did: payer, balance: (acct?.balance ?? 0) - take }); from.push({ account: payer, amount: take }); paid += take; }
    }
    if (paid > 0) { const to = await tx.getAccount(info.reporter); await tx.putAccount({ did: info.reporter, balance: (to?.balance ?? 0) + paid }); for (const f of from) await noteFunder(tx, info.reporter, f.account, isReservedAccount); }
    await tx.putMarker(`abuse_case:${b.case}`, JSON.stringify({ ...info, state: b.finding }));
    await tx.putMarker(`abuse_outcome:${info.report}`, JSON.stringify({ case: b.case, ruling: r.id, finding: b.finding, requested: asked, paid, shortfall: asked - paid, from, ...(b.remedy ? { remedy: b.remedy } : {}), ...(b.bad_faith ? { bad_faith: true } : {}), at: now }));
    return;
  }

  // The contest of an adverse act (AG3, spec-delta S1552; owner answer 2026-11-21): the operator answers within 48 hours, then the Courts decide within 72 hours of the case. The log keeps the clocks and refuses an act out of order;
  // an answer or a ruling that comes after its clock is still recorded and is marked late, so a stalled contest is visible and never frozen.
  if (b.act === "contest") {
    const subject = await tx.getRecord(b.subject);
    const sb = subject?.record.body as Record<string, any> | undefined;
    let agents: string[] = [];
    if (subject?.record.type === "asp.action/v0.2" && ((sb?.blocked_attempts ?? []) as { count: number }[]).reduce((n, x) => n + x.count, 0) > 0) agents = [subject.record.issuer];
    else if (subject?.record.type === "asp.settlement/v0.2" && Number(sb?.bond_slashed?.value ?? 0) > 0) { const c = await tx.getRecord(sb!.contract); if (c) agents = [(c.record.body as { performer: string }).performer]; }
    else if (subject?.record.type === "asp.clinic_diagnosis/v0.2") agents = [sb!.agent];
    else if (subject?.record.type === "asp.quarantine/v0.2") agents = sb!.members as string[];
    else if (subject?.record.type === "asp.gateway_refusal/v0.2") agents = [sb!.agent];
    if (!agents.length) throw rule("contest_subject", `${b.subject} is not an adverse act against an agent (a strike, a slash, a Clinic diagnosis, a quarantine or a gateway refusal): there is nothing to contest`);
    let agent: string | undefined;
    for (const a of agents) { if (r.issuer === a || r.issuer === (await tx.getPassport(a))?.sponsor) agent = a; }
    if (!agent) throw rule("contest_not_the_agent", `only the agent the act was against, or its sponsor, contests it`);
    if (await tx.getMarker(`contest_for:${b.subject}`)) throw rule("contest_once", `${b.subject} already has a contest: one contest for each act`);
    await tx.putMarker(`contest:${r.id}`, JSON.stringify({ subject: b.subject, agent, by: r.issuer, at: now, state: "open" }));
    await tx.putMarker(`contest_for:${b.subject}`, r.id);
    return;
  }

  if (b.act === "contest_answer") {
    const raw = await tx.getMarker(`contest:${b.contest}`);
    if (!raw) throw rule("contest_unknown", `${b.contest} is not a contest in this log`);
    const info = JSON.parse(raw) as { subject: string; agent: string; by: string; at: string; state: string };
    if (r.issuer !== env.operator) throw rule("contest_answer_wrong_issuer", `${r.issuer} is not the operator: the operator answers a contest first`);
    if (info.state !== "open") throw rule("contest_not_open", `the contest ${b.contest} is ${info.state}: it was already answered or is with the Courts`);
    const late = Date.parse(now) - Date.parse(info.at) > CONTEST_OPERATOR_MS;
    await tx.putMarker(`contest:${b.contest}`, JSON.stringify({ ...info, state: b.answer, answered_at: now, answer: r.id, ...(late ? { answer_late: true } : {}) }));
    return;
  }

  if (b.act === "contest_case") {
    const raw = await tx.getMarker(`contest:${b.contest}`);
    if (!raw) throw rule("contest_unknown", `${b.contest} is not a contest in this log`);
    const info = JSON.parse(raw) as { subject: string; agent: string; by: string; at: string; state: string };
    if (r.issuer !== info.by && r.issuer !== info.agent && r.issuer !== (await tx.getPassport(info.agent))?.sponsor) throw rule("contest_case_not_the_contester", "only the agent, its sponsor or whoever opened the contest takes it to the Courts");
    const waited = Date.parse(now) - Date.parse(info.at) >= CONTEST_OPERATOR_MS;
    if (info.state === "withdrawn") throw rule("contest_withdrawn", "the operator withdrew the act: there is nothing left for the Courts");
    if (info.state === "in_courts" || info.state === "reversed" || info.state === "stands") throw rule("contest_case_once", `the contest ${b.contest} already went to the Courts`);
    if (info.state === "open" && !waited) throw rule("contest_operator_first", `the operator answers first, within 48 hours: until ${iso(Date.parse(info.at) + CONTEST_OPERATOR_MS)} the contest cannot go to the Courts unless the operator has answered`);
    await tx.putMarker(`contest:${b.contest}`, JSON.stringify({ ...info, state: "in_courts", case_at: now }));
    await tx.putMarker(`contest_case:${r.id}`, JSON.stringify({ contest: b.contest, agent: info.agent, at: now, state: "open" }));
    return;
  }

  if (b.act === "contest_ruling") {
    const raw = await tx.getMarker(`contest_case:${b.case}`);
    if (!raw) throw rule("contest_case_unknown", `${b.case} is not a contest case in this log`);
    const cinfo = JSON.parse(raw) as { contest: string; agent: string; at: string; state: string };
    if (cinfo.state !== "open") throw rule("contest_case_decided", `the case ${b.case} was already ruled on`);
    const sponsor = (await tx.getPassport(cinfo.agent))?.sponsor ?? null;
    const signers = new Set([r.sig.kid, ...(r.cosigs ?? []).map((c) => c.kid)].map(didOf));
    const conflicted = [...signers].filter((x) => x === cinfo.agent || x === sponsor || x === env.operator || x === REGISTRAR_DID);
    if (conflicted.length) throw rule("contest_panel_conflict", `${conflicted.join(", ")} is the agent, its sponsor, the operator or the Registrar: the panel is jurors who are none of them`);
    const routes = await routesOrDefault(tx, now);
    const panel = await drawPanel(tx, { principal: sponsor ?? cinfo.agent, performer: cinfo.agent, seed: b.case, size: routes.standard_panel, at: now, v2: panelDrawIsV2(env.panelV2From, now) });
    if (panel.length > 0) {
      const onPanel = panel.filter((p) => signers.has(p));
      const quorum = Math.ceil(panel.length / 2);
      if (onPanel.length < quorum) throw rule("panel_quorum", `a ruling on a contest needs ${quorum} of the drawn panel (${panel.join(", ")}) to sign; only ${onPanel.length} did`);
      await noteJurorService(tx, onPanel, now);
    }
    const late = Date.parse(now) - Date.parse(cinfo.at) > CONTEST_COURTS_MS;
    await tx.putMarker(`contest_case:${b.case}`, JSON.stringify({ ...cinfo, state: b.decision, ruled_at: now, ruling: r.id, ...(late ? { late: true } : {}) }));
    const craw = JSON.parse((await tx.getMarker(`contest:${cinfo.contest}`))!) as Record<string, unknown>;
    await tx.putMarker(`contest:${cinfo.contest}`, JSON.stringify({ ...craw, state: b.decision === "reversed" ? "reversed" : "stands", ruled_at: now, ruling: r.id, ...(late ? { ruling_late: true } : {}) }));
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
    // v3 (DK122, S1611): the appellant's own record no longer seeds the panel; the first records of three other controllers after the appeal do.
    const v3 = panelDrawIsV3(env.panelV3From, now);
    const seed = v3 ? await disputeSeedV3(tx, info.contract, b.appeal, [cb.principal, cb.performer, info.appellant]) : b.appeal;
    if (v3 && !seed && (await tx.activeJurors()).length > 0) throw rule("panel_not_drawn", "the panel of this appeal is not drawn yet: its seed is made from the records of three other controllers that follow the appeal, and fewer than three have recorded anything");
    const panel = await drawPanel(tx, { principal: cb.principal, performer: cb.performer, seed: seed ?? b.appeal, size: routes.appeal_panel, exclude: firstSigners, at: now, v2: v3 || panelDrawIsV2(env.panelV2From, now), v3 });
    if (panel.length > 0) {
      const onPanel = panel.filter((p) => signers.has(p));
      const quorum = Math.ceil(panel.length / 2);
      if (onPanel.length < quorum) throw rule("panel_quorum", `an appeal ruling needs ${quorum} of the drawn appeal panel (${panel.join(", ")}) to sign; only ${onPanel.length} did`);
      await noteJurorService(tx, onPanel, now);
    }
    await tx.putMarker(`appeal:${b.appeal}`, JSON.stringify({ ...info, state: b.outcome, decided: r.id, ...(b.fault ? { fault: b.fault } : {}) }));
    await settleAppealMoney(tx, r, info, b.outcome, b.fault, cb, panel.length > 0 ? panel.filter((p) => signers.has(p)) : [...signers], firstSigners);
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

type AppealMarker = { ruling: string; appellant: string; contract: string; state: string; fee: string; fault?: Record<string, number>; decided?: string };

/** The fault map a ruling stands on: its own, or the corrected one when an appeal reversed or varied it (S1400). `undefined` for a record that is not a ruling. */
export async function effectiveFault(tx: Pick<LogTx, "getMarker" | "getRecord">, rulingId: string): Promise<Record<string, number> | undefined> {
  const ruling = await tx.getRecord(rulingId);
  const rb = ruling?.record.body as { kind?: string; fault?: Record<string, number> } | undefined;
  if (rb?.kind !== "ruling") return undefined;
  const appealId = await tx.getMarker(`appealed:${rulingId}`);
  const info = appealId ? (JSON.parse((await tx.getMarker(`appeal:${appealId}`)) ?? "null") as AppealMarker | null) : null;
  if (info && (info.state === "reversed" || info.state === "varied") && info.fault) return info.fault;
  return rb.fault ?? {};
}

/**
 * The hold on a ruling's settlement (S1400, DK121). Refused: a settlement inside the hold (the contract's `appeal_hold_seconds`, or 72 hours once a court charter is in force at the time of the ruling) unless both parties
 * cosign it as a waiver; and any settlement while an appeal of the ruling is open, until it is decided or has waited APPEAL_FREEZE_MAX_MS. Without a charter and without the field a log behaves as before.
 */
export async function checkSettlementHold(tx: LogTx, settlement: AspRecord, rulingId: string): Promise<void> {
  const ruling = await tx.getRecord(rulingId);
  if (!ruling) return;
  const sb = settlement.body as { contract: string };
  const contract = (await tx.getRecord(sb.contract))?.record.body as { principal: string; performer: string; appeal_hold_seconds?: number } | undefined;
  if (!contract) return;
  const cosigners = new Set((settlement.cosigs ?? []).map((c) => didOf(c.kid)));
  const waived = cosigners.has(contract.principal) && cosigners.has(contract.performer);
  const holdMs = contract.appeal_hold_seconds !== undefined ? contract.appeal_hold_seconds * 1000 : (await charterIn(tx, ruling.record.issued_at)) ? APPEAL_HOLD_MS : 0;
  const now = Date.parse(settlement.issued_at);
  if (holdMs > 0 && !waived && now < Date.parse(ruling.record.issued_at) + holdMs) {
    throw rule("settlement_in_appeal_hold", `a ruling's settlement is held ${holdMs / 3600_000} hours so that an appeal can change the money: not before ${iso(Date.parse(ruling.record.issued_at) + holdMs)}, unless the principal and the performer both cosign a waiver`);
  }
  const appealId = await tx.getMarker(`appealed:${rulingId}`);
  const info = appealId ? (JSON.parse((await tx.getMarker(`appeal:${appealId}`)) ?? "null") as AppealMarker | null) : null;
  if (appealId && info?.state === "open") {
    const filed = Date.parse((await tx.getRecord(appealId))!.record.issued_at);
    if (now < filed + APPEAL_FREEZE_MAX_MS) throw rule("settlement_appeal_pending", `the ruling is under appeal (${appealId}): the settlement waits for the appeal ruling, or until ${iso(filed + APPEAL_FREEZE_MAX_MS)} if it is not decided`);
  }
}

/**
 * What an appeal ruling does to money (S1400, DK121), derived and never declared. The jurors who sign it are paid the appeal fee by the loser of the appeal: when the ruling is affirmed the appellant lost and the Courts pay the
 * jurors from the fee it paid; when it is reversed or varied the party with the larger share of the corrected fault lost and pays the same amount from its free balance, then its sponsor's (what is not there is not paid; the
 * shortfall is on the record), and the appellant's fee is refundable as before. A reversal also costs each first-panel juror JUROR_PENALTY_PERMILLE of its stake, paid to the Treasury (a variation costs nothing).
 * Credits only move; supply does not change.
 */
async function settleAppealMoney(tx: LogTx, r: AspRecord, info: AppealMarker, outcome: string, fault: Record<string, number> | undefined, parties: { principal: string; performer: string }, panelSigners: string[], firstSigners: string[]): Promise<void> {
  const fee = (await tx.getRecord(info.fee))!;
  const pb = fee.record.body as { amount: { value: number }; price_list: string; service: string };
  const list = await tx.getRecord(pb.price_list);
  const item = (list?.record.body as { items?: { service: string; split: Parameters<typeof splitParts>[1] }[] } | undefined)?.items?.find((i) => i.service === pb.service);
  const total = item ? splitParts(pb.amount.value, item.split).payees.filter((p) => p.account === COURTS_DID).reduce((n, p) => n + p.amount, 0) : 0;
  const jurors = [...new Set(panelSigners)];
  const paidBy: { account: string; amount: number }[] = [];
  let paid = 0;
  if (jurors.length > 0 && total > 0) {
    if (outcome === "affirmed") {
      const courts = await tx.getAccount(COURTS_DID);
      const take = Math.min(courts?.balance ?? 0, total);
      if (take > 0) { await tx.putAccount({ did: COURTS_DID, balance: (courts?.balance ?? 0) - take }); paidBy.push({ account: COURTS_DID, amount: take }); paid = take; }
    } else {
      const loser = (fault?.[parties.performer] ?? 0) >= (fault?.[parties.principal] ?? 0) ? parties.performer : parties.principal;
      const sponsor = (await tx.getPassport(loser))?.sponsor ?? null;
      for (const payer of [loser, sponsor]) {
        if (!payer || paid >= total) continue;
        const acct = await tx.getAccount(payer);
        const take = Math.min(acct?.balance ?? 0, total - paid);
        if (take > 0) { await tx.putAccount({ did: payer, balance: (acct?.balance ?? 0) - take }); paidBy.push({ account: payer, amount: take }); paid += take; }
      }
    }
    if (paid > 0) {
      const each = Math.floor(paid / jurors.length);
      for (const [i, d] of jurors.entries()) { const a = await tx.getAccount(d); await tx.putAccount({ did: d, balance: (a?.balance ?? 0) + each + (i === 0 ? paid - each * jurors.length : 0) }); }
      for (const f of paidBy) for (const d of jurors) await noteFunder(tx, d, f.account, isReservedAccount);
    }
  }
  const penalised: { juror: string; amount: number }[] = [];
  if (outcome === "reversed") {
    for (const d of new Set(firstSigners)) {
      const row = await tx.getJuror(d);
      if (!row || row.staked <= 0) continue;
      const amount = Math.min(row.staked, Math.max(1, Math.ceil((row.staked * JUROR_PENALTY_PERMILLE) / 1000)));
      await tx.putJuror({ ...row, staked: row.staked - amount });
      const treasury = await tx.getAccount(TREASURY_DID);
      await tx.putAccount({ did: TREASURY_DID, balance: (treasury?.balance ?? 0) + amount });
      penalised.push({ juror: d, amount });
    }
  }
  await tx.putMarker(`appeal_money:${r.id}`, JSON.stringify({ fee: info.fee, owed: total, paid, shortfall: total - paid, from: paidBy, jurors, penalised }));
}
