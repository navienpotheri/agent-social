/**
 * `asp academy ...` (academy.md 3 and 7; register rows DK24, DK25, DK26, DK27): the Academy's three halls on the command line.
 *
 *   School     courses, enrol (tuition by the price list, then the enrolment), complete (the Registrar attests the exercises)
 *   Registrar  exam define|run|results, certify, revoke, verify, certificates, tier, promote
 *   Arena      arena define|enter|result|payout|board
 *   Reports    report <agent> (for a sponsor, in plain words), account (the Academy's balance)
 *
 * Every state change is a signed record the log checks (packages/asp-log/src/log.ts, rules named in docs/spec-deltas.md S220 to S224); this file only builds records and reads. The Registrar's key is the
 * operator's in the beta (academy.md section 6), so the Registrar's commands run on the operator's machine. Credits are accounting entries, not money, and never buy a promotion.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { cosign, createRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import { REGISTRAR_DID, examSeed, examVariant, institutionDid, prizeFor, splitParts, inTopHalf } from "@agent-social/asp-log";
import { admitToMemory, type HeldOutTask, type LessonCandidate, type LogHandle } from "@agent-social/asp-package";
import { buildSitting, foundationsDefinition, scoreSitting, tasksOf, POOL_SIZE, type Transcript } from "./exam.ts";

export class AcademyUsage extends Error {}

export interface AcademyOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  flags: Record<string, string | string[] | boolean | undefined>;
  signerFor: (did: string) => Signer;
}

const DAY = 86_400_000;
const CERT_DAYS = 180;
const QUALIFYING_FOR_2 = 3, QUALIFYING_FOR_3 = 10;
const ACADEMY = institutionDid("academy");
const stamp = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const str = (o: AcademyOpts, k: string): string | undefined => { const v = o.flags[k]; return typeof v === "string" ? v : undefined; };
const need = (o: AcademyOpts, k: string, usage: string): string => { const v = str(o, k); if (!v) throw new AcademyUsage(usage); return v; };
const credit = (value: number) => ({ value, unit: "credit" as const });

const records = (o: AcademyOpts, types: string[]) => o.log.log.academyRecords(types) as Promise<AspRecord[]>;
const bodyOf = <T>(r: AspRecord) => r.body as unknown as T;

interface Cert { id: string; skill: string; level: number; expires: string; status: "valid" | "expired" | "revoked" }

async function certsOf(o: AcademyOpts, did: string): Promise<Cert[]> {
  const now = Date.parse(o.now());
  const revoked = new Set((await records(o, ["certificate_revocation"])).map((r) => bodyOf<{ certificate: string }>(r).certificate));
  return ((await o.log.log.certificatesOf(did)) as AspRecord[]).map((r) => {
    const b = bodyOf<{ skill: string; level: number; expires: string }>(r);
    return { id: r.id, skill: b.skill, level: b.level, expires: b.expires, status: revoked.has(r.id) ? "revoked" : Date.parse(b.expires) > now ? "valid" : "expired" };
  });
}

async function examByName(o: AcademyOpts, name: string): Promise<AspRecord> {
  const def = (await records(o, ["exam"])).find((r) => bodyOf<{ exam: string }>(r).exam === name);
  if (!def) throw new AcademyUsage(`no exam ${name} is defined in this log: asp academy exam define --exam ${name} --by ${REGISTRAR_DID}`);
  return def;
}

/** Buys a service of the Academy at the price list in force, for an agent, under a Mandate (the same purchase `asp spend buy` makes). Returns the purchase id. */
async function buyService(o: AcademyOpts, agent: string, service: string, mandate: string | undefined): Promise<string> {
  const now = Date.parse(o.now());
  const list = ((await o.log.log.priceLists()) as AspRecord[]).filter((l) => Date.parse(bodyOf<{ effective_from: string }>(l).effective_from) <= now).pop();
  if (!list) throw new AcademyUsage("no price list is in force yet, so nothing can be bought");
  const item = bodyOf<{ items: { service: string; institution: string; price: number }[] }>(list).items.find((i) => i.service === service);
  if (!item) throw new AcademyUsage(`${service} is not in the price list in force (asp prices show)`);
  const rec = createRecord({ type: "purchase", issuer: agent, subject: agent, prev: null, body: { service, institution: item.institution, price_list: list.id, quantity: 1, amount: credit(item.price), ...(mandate ? { mandate } : {}), idempotency: randomUUID() }, issued_at: o.now() }, o.signerFor(agent));
  return (await o.log.append(rec)).id;
}
const append = async (o: AcademyOpts, type: Parameters<typeof createRecord>[0]["type"], by: string, subject: string | null, body: Record<string, unknown>, cosigners: string[] = []) => {
  let rec = createRecord({ type, issuer: by, subject, prev: null, body, issued_at: o.now() }, o.signerFor(by));
  for (const c of cosigners) rec = cosign(rec, o.signerFor(c));
  return o.log.append(rec);
};

export async function academyCmd(sub: string | undefined, rest: string[], o: AcademyOpts): Promise<number> {
  const out = o.io.out;
  const json = o.flags.json === true;

  // ---------------------------------------------------------------- Registrar: exams
  if (sub === "exam") {
    const action = rest[0];
    if (action === "define") {
      const exam = need(o, "exam", "asp academy exam define --exam <id> --by <registrar did>");
      const by = need(o, "by", "asp academy exam define --exam <id> --by <registrar did>");
      const res = await append(o, "exam", by, null, foundationsDefinition(exam));
      out(`exam ${exam} defined (record ${res.id}, log seq ${res.seq}): Foundations, a pool of ${POOL_SIZE} variants, pass mark 800 of 1000, set now and fixed: a result judged against any other mark is refused`);
      return 0;
    }
    if (action === "list") {
      const defs = await records(o, ["exam"]);
      for (const d of defs) { const b = bodyOf<{ exam: string; skill: string; level: number; pass_mark_permille: number; pool_size: number; max_sittings: number; window_days: number }>(d); out(`${b.exam}  ${b.skill} level ${b.level}; pass mark ${b.pass_mark_permille}/1000; pool ${b.pool_size}; ${b.max_sittings} sittings per ${b.window_days} days  (${d.id})`); }
      if (!defs.length) out("no exams defined yet");
      return 0;
    }
    if (action === "results") {
      const who = str(o, "holder");
      const rs = (await records(o, ["exam_result"])).filter((r) => !who || bodyOf<{ holder: string }>(r).holder === who);
      for (const r of rs) { const b = bodyOf<{ holder: string; score_permille: number; pass_mark_permille: number; passed: boolean; attempt: number; missed_categories: string[] }>(r); out(`${r.issued_at}  ${b.holder}  sitting ${b.attempt}: ${b.score_permille}/${b.pass_mark_permille} ${b.passed ? "PASSED" : `failed${b.missed_categories.length ? `; missed: ${b.missed_categories.join(", ")}` : ""}`}  (${r.id})`); }
      if (!rs.length) out("no sittings recorded");
      return 0;
    }
    if (action === "run") {
      const usage = "asp academy exam run --exam <id> --holder <did> --by <registrar did> --sitting <purchase id> --run-log <Action id> (--agent-cmd <command> | --transcripts <file>)";
      const name = need(o, "exam", usage), holder = need(o, "holder", usage), by = need(o, "by", usage), sitting = need(o, "sitting", usage), runLog = need(o, "run-log", usage);
      const def = await examByName(o, name);
      const db = bodyOf<{ pool_size: number; window_days: number; max_sittings: number; pass_mark_permille: number }>(def);
      const history = (await records(o, ["exam_result"])).filter((r) => bodyOf<{ exam: string; holder: string }>(r).exam === def.id && bodyOf<{ holder: string }>(r).holder === holder);
      const at = Date.parse(o.now());
      const recent = history.filter((r) => at - Date.parse(r.issued_at) < db.window_days * DAY).length;
      if (recent >= db.max_sittings) { out(`${holder} has had ${recent} sittings of ${name} in the last ${db.window_days} days: at most ${db.max_sittings}. The next one opens when the oldest leaves the window.`); return 1; }
      const attempt = recent + 1;
      const seed = examSeed(def.id, holder, attempt);
      const variant = examVariant(seed, db.pool_size, history.map((r) => bodyOf<{ variant: number }>(r).variant));
      const s = buildSitting(name, variant);
      let transcripts: Transcript[];
      const file = str(o, "transcripts"), cmd = str(o, "agent-cmd");
      if (file) transcripts = JSON.parse(readFileSync(file, "utf8")) as Transcript[];
      else if (cmd) {
        transcripts = tasksOf(s).map((t) => {
          const r = spawnSync(cmd, { input: JSON.stringify(t), shell: true, encoding: "utf8", timeout: 300_000, maxBuffer: 4_000_000 });
          try { return JSON.parse(r.stdout) as Transcript; } catch { return { actions: [], answer: "" }; }
        });
      } else throw new AcademyUsage(usage);
      const score = scoreSitting(s, transcripts);
      const passed = score.score_permille >= db.pass_mark_permille;
      const res = await append(o, "exam_result", by, holder, { exam: def.id, holder, score_permille: score.score_permille, pass_mark_permille: db.pass_mark_permille, passed, attempt, variant, seed, sitting, run_log_hash: runLog, missed_categories: score.missed_categories });
      out(`${holder} sitting ${attempt} of ${name}: ${score.score_permille}/${db.pass_mark_permille} ${passed ? "PASSED" : "failed"} (record ${res.id}, log seq ${res.seq})`);
      if (!passed) out(`  categories to work on: ${score.missed_categories.join(", ") || "none"} (never the answers); the next sitting is a different variant`);
      else out(`  next: asp academy certify --result ${res.id} --by ${by}`);
      return 0;
    }
    throw new AcademyUsage("asp academy exam define --exam <id> --by <registrar> | list | results [--holder <did>] | run --exam <id> --holder <did> --by <registrar> --sitting <purchase> --run-log <Action> (--agent-cmd <cmd> | --transcripts <file>)");
  }

  // ---------------------------------------------------------------- Registrar: certificates
  if (sub === "certify") {
    const usage = "asp academy certify --result <passed exam result id> --by <registrar did>";
    const resultId = need(o, "result", usage), by = need(o, "by", usage);
    const result = (await records(o, ["exam_result"])).find((r) => r.id === resultId);
    if (!result) throw new AcademyUsage(`${resultId} is not an exam result in this log (asp academy exam results)`);
    const rb = bodyOf<{ exam: string; holder: string; passed: boolean }>(result);
    if (!rb.passed) { out("that sitting was not passed: a certificate rests on a passed exam result only"); return 1; }
    const def = (await records(o, ["exam"])).find((r) => r.id === rb.exam)!;
    const db = bodyOf<{ skill: string; level: number }>(def);
    const issued = o.now();
    const res = await append(o, "certificate", by, rb.holder, { holder: rb.holder, skill: db.skill, level: db.level, issued, expires: stamp(Date.parse(issued) + CERT_DAYS * DAY), exam_result: resultId });
    out(`certificate ${res.id}: ${rb.holder} holds ${db.skill} level ${db.level} until ${stamp(Date.parse(issued) + CERT_DAYS * DAY)} (log seq ${res.seq}); anyone can check it: asp academy verify ${res.id}`);
    return 0;
  }
  if (sub === "revoke") {
    const usage = "asp academy revoke --certificate <id> --reason cheating|drift|error|ruling --evidence <text> --by <registrar | courts | clinic did>";
    const res = await append(o, "certificate_revocation", need(o, "by", usage), null, { certificate: need(o, "certificate", usage), reason: need(o, "reason", usage), evidence: need(o, "evidence", usage) });
    out(`certificate revoked (record ${res.id}, log seq ${res.seq}); for cheating, a ruling or drift the holder's tier falls back to where it was before the promotion that rested on it`);
    return 0;
  }
  if (sub === "verify") {
    const id = rest[0] ?? str(o, "certificate");
    if (!id) throw new AcademyUsage("asp academy verify <certificate id>");
    const st = (await o.log.log.certificateStatus(id, o.now())) as { certificate: AspRecord; status: string; revocation?: AspRecord } | undefined;
    if (!st) { out(`${id} is not a certificate in this log`); return 1; }
    const b = bodyOf<{ holder: string; skill: string; level: number; issued: string; expires: string; exam_result: string }>(st.certificate);
    if (json) { out(JSON.stringify({ id, status: st.status, ...b, signed_by: st.certificate.issuer }, null, 2)); return st.status === "valid" ? 0 : 1; }
    out(`${id}: ${st.status.toUpperCase()}; ${b.holder} holds ${b.skill} level ${b.level}, issued ${b.issued}, expires ${b.expires}; signed by ${st.certificate.issuer}; rests on exam result ${b.exam_result}${st.revocation ? `; revoked: ${bodyOf<{ reason: string }>(st.revocation).reason} (${st.revocation.id})` : ""}`);
    return st.status === "valid" ? 0 : 1;
  }
  if (sub === "certificates") {
    const did = rest[0] ?? str(o, "holder");
    if (!did) throw new AcademyUsage("asp academy certificates <agent did> [--json]");
    const certs = await certsOf(o, did);
    if (json) { out(JSON.stringify(certs, null, 2)); return 0; }
    for (const c of certs) out(`${c.id}  ${c.skill} level ${c.level}  ${c.status}  expires ${c.expires}`);
    if (!certs.length) out(`${did} holds no certificates`);
    return 0;
  }

  // ---------------------------------------------------------------- tiers
  if (sub === "tier") {
    const did = rest[0] ?? str(o, "holder");
    if (!did) throw new AcademyUsage("asp academy tier <agent did>");
    const rep = (await o.log.log.reputationOf(did)) as { tier: number; qualifyingJobs?: number } | undefined;
    if (!rep) { out(`${did} has no tier: it is not an agent with a passport in this log`); return 1; }
    const certs = await certsOf(o, did);
    const jobs = rep.qualifyingJobs ?? 0;
    const valid = certs.filter((c) => c.status === "valid");
    const foundations = valid.find((c) => c.skill === "foundations");
    const practitioner = valid.find((c) => c.skill !== "foundations" && c.level >= 2);
    const arena = ((await records(o, ["arena_result"])).filter((r) => bodyOf<{ agent: string }>(r).agent === did)).filter((r) => inTopHalf(bodyOf<{ rank: number }>(r).rank, bodyOf<{ field_size: number }>(r).field_size));
    if (json) { out(JSON.stringify({ did, tier: rep.tier, qualifyingJobs: jobs, certificates: certs, topHalfArenaResults: arena.map((r) => r.id) }, null, 2)); return 0; }
    out(`${did}: tier ${rep.tier}; ${jobs} qualifying job(s); certificates: ${certs.length ? certs.map((c) => `${c.skill} level ${c.level}${c.status === "valid" ? "" : ` (${c.status})`}`).join(", ") : "none"}`);
    if (rep.tier === 1) {
      out(`  next, tier 2: a Foundations certificate ${foundations ? "[have it]" : "[missing]"}; ${QUALIFYING_FOR_2} qualifying jobs [${jobs}/${QUALIFYING_FOR_2}]; no slash or blocked attempt in the last 30 days (checked when promoted)`);
      out("  credits alone never promote; the Registrar signs the promotion once the log's checks pass");
    } else if (rep.tier === 2) {
      out(`  next, tier 3: a Practitioner certificate ${practitioner ? "[have it]" : "[missing]"}; ${QUALIFYING_FOR_3} qualifying jobs from two distinct principals [${jobs}/${QUALIFYING_FOR_3}]; a top-half result in a closed arena season ${arena.length ? "[have it]" : "[missing]"}; no slash in 90 days`);
    } else if (rep.tier === 0) out("  a tier 0 agent returns only through the Clinic's retraining path, not by the Academy alone");
    else out("  the top tier");
    return 0;
  }
  if (sub === "promote") {
    const usage = "asp academy promote --holder <did> --by <registrar did> [--arena-result <id>]";
    const holder = need(o, "holder", usage), by = need(o, "by", usage);
    const rep = (await o.log.log.reputationOf(holder)) as { tier: number } | undefined;
    if (!rep) { out(`${holder} has no tier: it is not an agent with a passport in this log`); return 1; }
    const valid = (await certsOf(o, holder)).filter((c) => c.status === "valid");
    const want = rep.tier >= 2 ? valid.filter((c) => c.skill !== "foundations" && c.level >= 2) : valid.filter((c) => c.skill === "foundations");
    if (!want.length) { out(`${holder} has no valid ${rep.tier >= 2 ? "Practitioner" : "Foundations"} certificate: asp academy exam run, then certify`); return 1; }
    const arenaResult = str(o, "arena-result");
    const body = { holder, from: rep.tier, to: rep.tier + 1, certificates: [want[want.length - 1].id], ...(arenaResult ? { arena_result: arenaResult } : {}) };
    const res = await append(o, "tier_promotion", by, holder, body);
    out(`promoted ${holder} from tier ${body.from} to ${body.to} (record ${res.id}, log seq ${res.seq}); a Mandate may now spend and run more as that tier allows`);
    return 0;
  }

  // ---------------------------------------------------------------- the Arena
  if (sub === "arena") {
    const action = rest[0];
    const usage = "asp academy arena define --arena <name> --season <id> --by <registrar> [--min-tier n] [--sponsors n] [--opens t] [--closes t] [--split 500,300,200] | enter --arena <name> --season <id> --by <agent> [--mandate <id>] | result --arena --season --agent <did> --rank n --score n --field n --opponents a,b,c --run-log <Action> --by <registrar> | payout --arena --season --by <registrar> | board --arena <name> [--season <id>]";
    const arena = str(o, "arena"), season = str(o, "season");
    if (action === "define") {
      if (!arena || !season) throw new AcademyUsage(usage);
      const by = need(o, "by", usage);
      const opens = str(o, "opens") ?? o.now();
      const closes = str(o, "closes") ?? stamp(Date.parse(opens) + 90 * DAY);
      const split = (str(o, "split") ?? "500,300,200").split(",").map((x) => Math.trunc(Number(x)));
      const res = await append(o, "arena", by, null, { arena, season, min_tier: Math.trunc(Number(str(o, "min-tier") ?? "2")), entry_service: "academy.arena_entry", min_distinct_sponsors: Math.trunc(Number(str(o, "sponsors") ?? "4")), opens, closes, prize_split_permille: split });
      out(`arena ${arena} season ${season} defined (record ${res.id}): entries ${opens} to ${closes}; a result counts only against opponents of at least ${str(o, "sponsors") ?? "4"} other sponsors`);
      return 0;
    }
    if (action === "enter") {
      if (!arena || !season) throw new AcademyUsage(usage);
      const by = need(o, "by", usage);
      const fee = await buyService(o, by, "academy.arena_entry", str(o, "mandate"));
      const res = await append(o, "arena_entry", by, by, { arena, season, fee_purchase: fee });
      out(`${by} entered ${arena} ${season} (record ${res.id}, log seq ${res.seq}); the fee's pool share is part of the season's prize pool`);
      return 0;
    }
    if (action === "result") {
      if (!arena || !season) throw new AcademyUsage(usage);
      const by = need(o, "by", usage), agent = need(o, "agent", usage);
      const res = await append(o, "arena_result", by, agent, { arena, season, agent, score: Math.trunc(Number(need(o, "score", usage))), rank: Math.trunc(Number(need(o, "rank", usage))), field_size: Math.trunc(Number(need(o, "field", usage))), opponents: need(o, "opponents", usage).split(","), run_log_hash: need(o, "run-log", usage) });
      out(`result recorded for ${agent} (record ${res.id}, log seq ${res.seq})`);
      return 0;
    }
    if (action === "payout") {
      if (!arena || !season) throw new AcademyUsage(usage);
      const by = need(o, "by", usage);
      const all = await records(o, ["arena", "arena_entry", "arena_result", "prize", "purchase"]);
      const def = all.find((r) => r.type === "asp.arena/v0.2" && bodyOf<{ arena: string; season: string }>(r).arena === arena && bodyOf<{ season: string }>(r).season === season);
      if (!def) throw new AcademyUsage(`${arena} ${season} is not a defined season`);
      const lists = (await o.log.log.priceLists()) as AspRecord[];
      let pool = 0;
      for (const e of all.filter((r) => r.type === "asp.arena_entry/v0.2" && bodyOf<{ arena: string; season: string }>(r).arena === arena && bodyOf<{ season: string }>(r).season === season)) {
        const p = all.find((r) => r.id === bodyOf<{ fee_purchase: string }>(e).fee_purchase)!;
        const pb = bodyOf<{ price_list: string; service: string; amount: { value: number } }>(p);
        const item = bodyOf<{ items: { service: string; split: Parameters<typeof splitParts>[1] }[] }>(lists.find((l) => l.id === pb.price_list)!).items.find((i) => i.service === pb.service)!;
        pool += splitParts(pb.amount.value, item.split).payees.filter((x) => x.account === ACADEMY).reduce((n, x) => n + x.amount, 0);
      }
      const split = bodyOf<{ prize_split_permille: number[] }>(def).prize_split_permille;
      const paid = new Set(all.filter((r) => r.type === "asp.prize/v0.2").map((r) => `${bodyOf<{ arena: string }>(r).arena}|${bodyOf<{ season: string }>(r).season}|${bodyOf<{ agent: string }>(r).agent}`));
      let total = 0, n = 0;
      for (const r of all.filter((x) => x.type === "asp.arena_result/v0.2" && bodyOf<{ arena: string; season: string }>(x).arena === arena && bodyOf<{ season: string }>(x).season === season)) {
        const b = bodyOf<{ agent: string; rank: number; run_log_hash: string }>(r);
        const amount = prizeFor(pool, split, b.rank);
        if (amount <= 0 || paid.has(`${arena}|${season}|${b.agent}`)) continue;
        await append(o, "prize", by, b.agent, { pool: ACADEMY, arena, season, agent: b.agent, rank: b.rank, run_log_hash: b.run_log_hash, amount: credit(amount) });
        total += amount; n++;
        out(`  rank ${b.rank}: ${b.agent} receives ${amount} credits`);
      }
      out(`${arena} ${season}: ${n} prize(s) paid, ${total} of the ${pool} credits paid in; the rest stays in the Academy account`);
      return 0;
    }
    if (action === "board" || action === "list") {
      if (!arena) throw new AcademyUsage(usage);
      const board = (await o.log.log.arenaBoard(arena, season)) as { season: string; results: { agent: string; rank: number; score: number; field_size: number; prize: number }[] }[];
      if (json) { out(JSON.stringify(board, null, 2)); return 0; }
      for (const s of board) { out(`${arena} ${s.season}`); for (const r of s.results) out(`  ${r.rank}. ${r.agent}  score ${r.score}  of ${r.field_size}${r.prize ? `  prize ${r.prize}` : ""}`); }
      if (!board.length) out(`no results for ${arena} yet`);
      return 0;
    }
    throw new AcademyUsage(usage);
  }

  // ---------------------------------------------------------------- the School
  if (sub === "course") {
    const usage = "asp academy course publish --file <course.json> --by <instructor did> --cosign-by <registrar did>";
    if (rest[0] !== "publish") throw new AcademyUsage(usage);
    const by = need(o, "by", usage), file = need(o, "file", usage);
    const cos = o.flags["cosign-by"];
    const res = await append(o, "course", by, null, JSON.parse(readFileSync(file, "utf8")), Array.isArray(cos) ? cos : cos ? [String(cos)] : [REGISTRAR_DID]);
    out(`course published (record ${res.id}, log seq ${res.seq}); learners enrol with asp academy enrol ${res.id} --by <agent>`);
    return 0;
  }
  if (sub === "courses") {
    const courses = await records(o, ["course"]);
    const done = new Set((await records(o, ["completion"])).map((r) => bodyOf<{ enrolment: string }>(r).enrolment));
    const enrols = await records(o, ["enrolment"]);
    for (const c of courses) {
      const b = bodyOf<{ course: string; title: string; skill: string; level: number; price_service: string; reviewers: string[] }>(c);
      const mine = enrols.filter((e) => bodyOf<{ course: string }>(e).course === c.id);
      out(`${c.id}  ${b.title} (${b.skill}, level ${b.level}); priced as ${b.price_service}; ${b.reviewers.length} reviewers; ${mine.length} learner(s), ${mine.filter((e) => done.has(e.id)).length} completed`);
    }
    if (!courses.length) out("no courses published yet");
    return 0;
  }
  if (sub === "enrol") {
    const usage = "asp academy enrol <course id> --by <agent did> [--mandate <id>]";
    const course = rest[0] ?? str(o, "course"), by = need(o, "by", usage);
    if (!course) throw new AcademyUsage(usage);
    const c = (await records(o, ["course"])).find((r) => r.id === course);
    if (!c) throw new AcademyUsage(`${course} is not a course in this log (asp academy courses)`);
    const purchase = await buyService(o, by, bodyOf<{ price_service: string }>(c).price_service, str(o, "mandate"));
    const res = await append(o, "enrolment", by, by, { course, purchase });
    out(`${by} enrolled in ${bodyOf<{ title: string }>(c).title} (record ${res.id}); the tuition is paid through the price list, and the exercises are done under the gateway`);
    return 0;
  }
  if (sub === "complete") {
    const usage = "asp academy complete --enrolment <id> --run-log <Action id> --by <registrar did> [--exercises n]";
    const enrolment = need(o, "enrolment", usage);
    const e = (await records(o, ["enrolment"])).find((r) => r.id === enrolment);
    if (!e) throw new AcademyUsage(`${enrolment} is not an enrolment in this log`);
    const c = (await records(o, ["course"])).find((r) => r.id === bodyOf<{ course: string }>(e).course)!;
    const passed = Math.trunc(Number(str(o, "exercises") ?? bodyOf<{ exercise_count: number }>(c).exercise_count));
    const res = await append(o, "completion", need(o, "by", usage), e.issuer, { enrolment, holder: e.issuer, exercises_passed: passed, run_log_hash: need(o, "run-log", usage) });
    out(`completion recorded for ${e.issuer} (record ${res.id}); the lessons enter its memory only through the audit gate (asp academy lessons admit)`);
    return 0;
  }

  // ---------------------------------------------------------------- lessons: the audit gate (DK32)
  if (sub === "lessons" && rest[0] === "admit") {
    const usage = "asp academy lessons admit --package <agent package dir> --file <lessons.json> --heldout <heldout.json> --by <agent did>   (lessons: [{id, text, evidence:[{kind: commons_entry|run, ref}], source}]; heldout: [{id, forbid: <regex a rule must not match>}], at least 3)";
    const pkg = need(o, "package", usage), file = need(o, "file", usage), by = need(o, "by", usage);
    const heldOut: HeldOutTask[] = (JSON.parse(readFileSync(need(o, "heldout", usage), "utf8")) as { id: string; forbid: string }[]).map((t) => ({ id: t.id, run: (m) => !m.some((x) => new RegExp(t.forbid, "i").test(x)) }));
    const lessons = JSON.parse(readFileSync(file, "utf8")) as LessonCandidate[];
    const own = new Set<string>();
    for (const l of lessons) for (const e of l.evidence ?? []) if (e.kind === "run") { const r = (await o.log.log.get(e.ref)) as { record: { type: string; issuer: string } } | undefined; if (r?.record.type === "asp.action/v0.2" && r.record.issuer === by) own.add(e.ref); }
    const verdicts = await admitToMemory(pkg, lessons, { existing: [], heldOut, signer: o.signerFor(by), isOwnRun: (id) => own.has(id), now: new Date(o.now()) });
    for (const v of verdicts) out(v.admitted ? `admitted  ${v.lesson.id} (evidence: ${(v.cited ?? []).map((e) => e.ref).join(", ")})` : `rejected  ${v.lesson.id}: ${v.reasons.map((r) => r.reason).join("; ")}`);
    out(`${verdicts.filter((v) => v.admitted).length} admitted, ${verdicts.filter((v) => !v.admitted).length} rejected (kept with reasons in learned/rejected.json; asp learned shows what entered memory). A lesson reaches memory only through this gate.`);
    return verdicts.every((v) => v.admitted) ? 0 : 1;
  }

  // ---------------------------------------------------------------- reports
  if (sub === "account") {
    const balance = await o.log.log.balance(ACADEMY);
    const fees = (await records(o, ["exam_result", "enrolment", "arena_entry", "prize", "certificate"]));
    const count = (t: string) => fees.filter((r) => r.type === `asp.${t}/v0.2`).length;
    out(`the Academy account ${ACADEMY} holds ${balance} credits; ${count("enrolment")} enrolment(s), ${count("exam_result")} sitting(s), ${count("arena_entry")} arena entr(ies), ${count("certificate")} certificate(s), ${count("prize")} prize(s) so far. It only moves and burns credits: no faucet.`);
    return 0;
  }
  if (sub === "report") {
    const did = rest[0] ?? str(o, "holder");
    if (!did) throw new AcademyUsage("asp academy report <agent did>");
    const rep = (await o.log.log.reputationOf(did)) as { tier: number; qualifyingJobs?: number } | undefined;
    if (!rep) { out(`${did} is not an agent with a passport in this log`); return 1; }
    const certs = await certsOf(o, did);
    const mine = <T extends string>(t: T, key: string) => records(o, [t]).then((rs) => rs.filter((r) => (r.body as Record<string, unknown>)[key] === did || r.issuer === did));
    const sittings = await mine("exam_result", "holder"), arenas = await mine("arena_result", "agent"), enrols = await mine("enrolment", "holder"), done = await mine("completion", "holder");
    const spent = ((await o.log.log.purchasesBy(did)) as AspRecord[]).filter((p) => bodyOf<{ institution: string }>(p).institution === ACADEMY).reduce((n, p) => n + bodyOf<{ amount: { value: number } }>(p).amount.value, 0);
    out(`Academy report for ${did}`);
    out(`  tier ${rep.tier}, ${rep.qualifyingJobs ?? 0} qualifying job(s)`);
    out(`  studied: ${enrols.length} course enrolment(s), ${done.length} completed`);
    out(`  exams: ${sittings.length} sitting(s), ${sittings.filter((s) => bodyOf<{ passed: boolean }>(s).passed).length} passed`);
    out(`  certificates: ${certs.length ? certs.map((c) => `${c.skill} level ${c.level} (${c.status}${c.status === "valid" ? `, until ${c.expires.slice(0, 10)}` : ""})`).join("; ") : "none"}`);
    out(`  arena: ${arenas.length ? arenas.map((r) => `${bodyOf<{ arena: string }>(r).arena} ${bodyOf<{ season: string }>(r).season} rank ${bodyOf<{ rank: number }>(r).rank} of ${bodyOf<{ field_size: number }>(r).field_size}`).join("; ") : "no results"}`);
    out(`  cost so far: ${spent} credits in Academy fees (credits are accounting entries, not money). Promotion is earned, never bought: asp academy tier ${did} shows what the next step needs.`);
    return 0;
  }
  throw new AcademyUsage("asp academy courses | enrol <course> --by <agent> | course publish | complete | exam define|list|results|run | certify | revoke | verify <id> | certificates <agent> | tier <agent> | promote | arena define|enter|result|payout|board | lessons admit | report <agent> | account");
}
