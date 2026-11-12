/**
 * The log's rules for the Registry's records (registry.md 3 and 5; DK10; spec-delta S231): names (syntax, reserved, taken, confusable, limits, paid),
 * impersonation reports and the Registrar's takedown of a NAME (never the identity), renewal, the Registrar's interim suspension (7 days at most) and retirement.
 * State lives in markers written inside the append, so a refused record leaves none.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { institutionDid, REGISTRAR_DID } from "./economy.ts";
import { APPEAL_WINDOW_MS, HEARING_MS, INTERIM_MAX_MS, LAPSE_AFTER_MS, MAX_NAMES_PER_AGENT, MAX_NAMES_PER_SPONSOR, MAX_OPEN_REPORTS, NAME_GRACE_MS, NAME_SERVICE_CLAIM, NAME_TERM_MS, RENEWAL_TERM_MS, RENEWAL_WINDOW_MS, isReservedName, nameProblem, skeleton } from "./registry.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const list = async (tx: LogTx, key: string): Promise<string[]> => ((await tx.getMarker(key)) ?? "").split(",").filter(Boolean);
const push = async (tx: LogTx, key: string, v: string) => { const l = await list(tx, key); if (!l.includes(v)) await tx.putMarker(key, [...l, v].join(",")); };
const drop = async (tx: LogTx, key: string, v: string) => tx.putMarker(key, (await list(tx, key)).filter((x) => x !== v).join(","));

interface Held { holder: string; until: string; claim: string; state: "live" | "released" | "removed" }
const readHeld = async (tx: LogTx, name: string): Promise<Held | null> => { const raw = await tx.getMarker(`name:${name}`); return raw ? (JSON.parse(raw) as Held) : null; };
/** A name blocks others while live, and for 60 days after it lapses it is held for its holder. */
const blocking = (h: Held, now: string): boolean => h.state === "live" && Date.parse(h.until) + NAME_GRACE_MS > Date.parse(now);
const liveNow = (h: Held, now: string): boolean => h.state === "live" && Date.parse(h.until) > Date.parse(now);

export interface RegistryEnv { operator?: string; reputation(rd: LogTx, did: string): Promise<{ tier: number } | null> }

interface ReportInfo { reporter: string; target: string; genuine: string; grounds: string; at: string; holder: string | null; replied: boolean; state: "open" | "takedown" | "dismissed" }

export async function projectRegistryAct(tx: LogTx, r: AspRecord, env: RegistryEnv): Promise<void> {
  const b = r.body as Record<string, any>;
  if (r.prev !== null) throw rule("registry_act_not_chained", "a registry act starts its own chain (prev is null)");
  const now = r.issued_at;
  const registrar = r.issuer === REGISTRAR_DID;
  const needRegistrar = (what: string) => { if (!registrar) throw rule("registry_wrong_issuer", `${r.issuer} is not the Registrar (${REGISTRAR_DID}): only the Registrar ${what}`); };

  if (b.act === "name_claim") {
    if (r.issuer !== b.holder && !registrar) throw rule("name_not_holders", "a name is claimed by its holder");
    const passport = await tx.getPassport(b.holder);
    if (!passport) throw rule("name_no_passport", `${b.holder} has no passport in this log: an identity is registered before it claims a name`);
    const syntax = nameProblem(b.name);
    if (syntax) throw rule("name_syntax", `${syntax}: choose another name`);
    if (isReservedName(b.name) && !registrar) throw rule("name_reserved", `${b.name} is on the reserved list: only the Registrar claims it, for an institution`);
    if (Date.parse(b.valid_until) !== Date.parse(now) + NAME_TERM_MS) throw rule("name_term", `a name is held for exactly 365 days: valid_until is ${iso(Date.parse(now) + NAME_TERM_MS)}`);
    const held = await readHeld(tx, b.name);
    if (held && blocking(held, now) && held.holder !== b.holder) throw rule("name_taken", `${b.name} is held by ${held.holder} until ${held.until}: choose another name`);
    const skel = skeleton(b.name);
    const same = await tx.getMarker(`skel:${skel}`);
    if (same && same !== b.name) {
      const other = await readHeld(tx, same);
      if (other && blocking(other, now) && other.holder !== b.holder) throw rule("name_confusable", `${b.name} looks like ${same}, which ${other.holder} holds: choose another, or report ${same} if it copies you (asp registry report)`);
    }
    // Limits: one live name per agent, five per sponsor (a person is their own sponsor).
    const sponsor = passport.sponsor ?? b.holder;
    if (!registrar) {
      const liveNames: { n: string; h: Held }[] = [];
      for (const n of await list(tx, `names_of:${sponsor}`)) { const h = await readHeld(tx, n); if (h && liveNow(h, now) && n !== b.name) liveNames.push({ n, h }); }
      const own = liveNames.filter((x) => x.h.holder === b.holder);
      const mine = liveNames;
      if (passport.sponsor && own.length >= MAX_NAMES_PER_AGENT) throw rule("name_limit", `an agent holds ${MAX_NAMES_PER_AGENT} live name; it already holds ${own[0].n} (release it first: asp registry release)`);
      if (mine.length >= MAX_NAMES_PER_SPONSOR) throw rule("name_limit", `a sponsor holds at most ${MAX_NAMES_PER_SPONSOR} live names; ${mine.length} are held`);
      // Payment: a purchase of the claim, by the holder, used once.
      if (!b.paid) throw rule("name_unpaid", `a name costs a purchase of ${NAME_SERVICE_CLAIM}: asp spend buy ${NAME_SERVICE_CLAIM}, then claim with --paid <purchase id>`);
      const p = await tx.getRecord(b.paid);
      const pb = p?.record.body as { service?: string; institution?: string } | undefined;
      if (!p || p.record.type !== "asp.purchase/v0.2" || p.record.issuer !== b.holder || pb?.service !== NAME_SERVICE_CLAIM || pb.institution !== institutionDid("registry")) throw rule("name_unpaid", `${b.paid} is not the holder's purchase of ${NAME_SERVICE_CLAIM}`);
      if (await tx.getMarker(`paid_used:${b.paid}`)) throw rule("name_paid_used", "this purchase already paid for another name");
      await tx.putMarker(`paid_used:${b.paid}`, r.id);
    }
    await tx.putMarker(`name:${b.name}`, JSON.stringify({ holder: b.holder, until: b.valid_until, claim: r.id, state: "live" } satisfies Held));
    await tx.putMarker(`skel:${skel}`, b.name);
    await push(tx, `names_of:${sponsor}`, b.name);
    return;
  }

  if (b.act === "name_release") {
    const held = await readHeld(tx, b.name);
    if (!held || held.claim !== b.claim || held.state !== "live") throw rule("name_release_unknown", `${b.name} is not a live claim ${b.claim}`);
    if (held.holder !== r.issuer) throw rule("name_release_not_holders", "only the holder releases a name");
    await tx.putMarker(`name:${b.name}`, JSON.stringify({ ...held, state: "released" }));
    return;
  }

  if (b.act === "impersonation_report") {
    if (!(await tx.getPassport(r.issuer))) throw rule("report_no_passport", "a reporter has a passport");
    if (!(await tx.getPassport(b.genuine))) throw rule("report_genuine_unknown", `${b.genuine} has no passport in this log`);
    const byName = b.target.startsWith("did:") ? null : await readHeld(tx, b.target);
    let holder: string | null = null;
    if (b.target.startsWith("did:")) { if (!(await tx.getPassport(b.target))) throw rule("report_target_unknown", `${b.target} has no passport in this log`); holder = b.target; }
    else { if (!byName || !liveNow(byName, now)) throw rule("report_target_unknown", `${b.target} is not a live name`); holder = byName.holder; }
    if (holder === r.issuer) throw rule("report_own_name", "a holder does not report its own name");
    if (holder === b.genuine) throw rule("report_same_holder", "the genuine agent and the look-alike are the same identity");
    if (b.grounds === "name_confusable") {
      const genuineNames: string[] = [];
      for (const n of await list(tx, `names_of:${(await tx.getPassport(b.genuine))?.sponsor ?? b.genuine}`)) { const h = await readHeld(tx, n); if (h && h.holder === b.genuine && liveNow(h, now)) genuineNames.push(n); }
      if (b.target.startsWith("did:") || !genuineNames.some((n) => skeleton(b.target).includes(skeleton(n)) && n !== b.target)) throw rule("report_not_confusable", "name_confusable needs a live name of the genuine agent that the reported name contains or looks like (equal skeleton, or its skeleton inside the reported name's); otherwise report on the ground claims_to_be or copied_profile with evidence");
    } else if (!b.evidence.length) throw rule("report_needs_evidence", `${b.grounds} needs evidence: name the artifacts that show it`);
    const open = await list(tx, `open_reports:${r.issuer}`);
    if (open.length >= MAX_OPEN_REPORTS) throw rule("report_cap", `a reporter has at most ${MAX_OPEN_REPORTS} open reports; ${open.length} are open`);
    await tx.putMarker(`report:${r.id}`, JSON.stringify({ reporter: r.issuer, target: b.target, genuine: b.genuine, grounds: b.grounds, at: now, holder, replied: false, state: "open" } satisfies ReportInfo));
    await push(tx, `open_reports:${r.issuer}`, r.id);
    return;
  }

  if (b.act === "name_reply" || b.act === "name_takedown" || b.act === "takedown_dismissal") {
    const raw = await tx.getMarker(`report:${b.report}`);
    if (!raw) throw rule("report_unknown", `${b.report} is not an impersonation report in this log`);
    const info = JSON.parse(raw) as ReportInfo;
    if (info.state !== "open") throw rule("report_closed", `the report ${b.report} is already ${info.state}`);
    if (b.act === "name_reply") {
      if (r.issuer !== info.holder) throw rule("reply_not_holders", "only the holder of the reported name replies");
      await tx.putMarker(`report:${b.report}`, JSON.stringify({ ...info, replied: true }));
      return;
    }
    needRegistrar(b.act === "name_takedown" ? "removes a name" : "dismisses a report");
    if (b.act === "name_takedown") {
      if (info.holder !== b.holder || info.target !== b.name) throw rule("takedown_wrong_name", `the report is about ${info.target} held by ${info.holder}`);
      if (!info.replied && Date.parse(now) < Date.parse(info.at) + HEARING_MS) throw rule("takedown_not_heard", `the holder is heard first: it has until ${iso(Date.parse(info.at) + HEARING_MS)} to reply, or the Registrar waits until then`);
      if (Date.parse(b.appealable_until) !== Date.parse(now) + APPEAL_WINDOW_MS) throw rule("takedown_appeal_window", `the holder may appeal for 14 days: appealable_until is ${iso(Date.parse(now) + APPEAL_WINDOW_MS)}`);
      const sponsor = (await tx.getPassport(b.holder))?.sponsor;
      if (env.operator && sponsor === env.operator) throw rule("takedown_conflict", "the operator does not take down the name of an agent it sponsors without a Court record");
      const held = await readHeld(tx, b.name);
      if (!held || !liveNow(held, now)) throw rule("takedown_not_a_live_name", `${b.name} is not a live name`);
      await tx.putMarker(`name:${b.name}`, JSON.stringify({ ...held, state: "removed" }));
    }
    await tx.putMarker(`report:${b.report}`, JSON.stringify({ ...info, state: b.act === "name_takedown" ? "takedown" : "dismissed" }));
    await drop(tx, `open_reports:${info.reporter}`, b.report);
    return;
  }

  if (b.act === "identity_renewal") {
    const p = await tx.getRecord(b.passport);
    if (!p || p.record.type !== "asp.passport/v0.2") throw rule("renewal_passport_unknown", `${b.passport} is not a passport in this log`);
    const did = (p.record.body as { did: string }).did;
    const row = await tx.getPassport(did);
    if (!row || row.head !== b.passport) throw rule("renewal_stale_passport", "the renewal names the passport's current version");
    if (r.issuer !== did) throw rule("renewal_not_holders", "the holder renews its own identity");
    if (row.sponsor) {
      let cosigned = false;
      for (const c of r.cosigs ?? []) if ((await tx.getKey(c.kid))?.did === row.sponsor) cosigned = true;
      if (!cosigned) throw rule("renewal_needs_sponsor", "an agent's renewal is cosigned by its sponsor");
    }
    const live = (await tx.keysForDid(did)).filter((k) => !k.revokedAt).map((k) => k.kid).sort();
    if (JSON.stringify([...b.keys_confirmed].sort()) !== JSON.stringify(live)) throw rule("renewal_keys_mismatch", `the unrevoked keys are ${live.join(", ")}: confirm exactly those`);
    const root = await tx.getChain((await tx.getRecord(b.passport))!.chain);
    const first = root ? (await tx.getRecord(root.root))!.record.issued_at : p.record.issued_at;
    const last = (await tx.getMarker(`renewed:${did}`)) ?? first;
    const due = Date.parse(last) + RENEWAL_TERM_MS;
    if (Date.parse(now) < due - RENEWAL_WINDOW_MS) throw rule("renewal_too_early", `renewal opens 60 days before it is due: due ${iso(due)}, opens ${iso(due - RENEWAL_WINDOW_MS)}`);
    await tx.putMarker(`renewed:${did}`, now);
    return;
  }

  if (b.act === "identity_suspension") {
    needRegistrar("suspends an identity (a Court's order, which can extend it, is a later build)");
    if (!(await tx.getPassport(b.holder))) throw rule("suspension_no_passport", `${b.holder} has no passport in this log`);
    if (Date.parse(b.until) > Date.parse(now) + INTERIM_MAX_MS) throw rule("interim_too_long", `an interim suspension lasts 7 days at most (Code 3.5): until ${iso(Date.parse(now) + INTERIM_MAX_MS)} at the latest; only a Court extends it`);
    if (Date.parse(b.until) <= Date.parse(now)) throw rule("suspension_until_past", "a suspension ends in the future");
    await tx.putMarker(`suspended:${b.holder}`, JSON.stringify({ id: r.id, until: b.until }));
    await tx.putMarker(`suspension:${r.id}`, b.holder);
    return;
  }

  if (b.act === "suspension_lift") {
    needRegistrar("lifts a suspension");
    const holder = await tx.getMarker(`suspension:${b.suspension}`);
    if (!holder) throw rule("suspension_unknown", `${b.suspension} is not a suspension in this log`);
    const cur = JSON.parse((await tx.getMarker(`suspended:${holder}`)) ?? "null") as { id: string } | null;
    if (cur?.id === b.suspension) await tx.putMarker(`suspended:${holder}`, "");
    return;
  }

  if (b.act === "identity_retirement") {
    if (r.issuer !== b.holder) throw rule("retirement_not_holders", "only the holder retires an identity (a Court's order is a later build)");
    if (!(await tx.getPassport(b.holder))) throw rule("retirement_no_passport", `${b.holder} has no passport in this log`);
    await tx.putMarker(`retired:${b.holder}`, r.id);
  }
}

/** While an identity is suspended (the Registrar's interim, not yet past its end) the log refuses its Bond, Mandate, Proposal and purchase; once retired, any new Contract or purchase. */
export async function checkSuspended(tx: LogTx, r: AspRecord): Promise<void> {
  const type = r.type.replace(/^asp\./, "").replace(/\/v0\.2$/, "");
  const b = r.body as { backer?: string; principal?: string; performer?: string };
  const who = type === "bond" ? [b.backer!] : type === "mandate" ? [r.subject as string] : type === "proposal" || type === "purchase" ? [r.issuer] : type === "contract" ? [b.principal!, b.performer!] : [];
  for (const d of who) {
    const raw = d ? await tx.getMarker(`suspended:${d}`) : undefined;
    if (raw) { const s = JSON.parse(raw) as { id: string; until: string }; if (Date.parse(s.until) > Date.parse(r.issued_at)) throw rule("identity_suspended", `${d} is suspended until ${s.until} (record ${s.id}, Code 3.5): a hearing must be held within seven days or the suspension lapses`); }
    if (d && (type === "contract" || type === "purchase") && (await tx.getMarker(`retired:${d}`))) throw rule("identity_retired", `${d} is retired: it takes no new Contract or purchase; its records stay readable`);
  }
}
void LAPSE_AFTER_MS;
