/**
 * `asp academy lens sit <course id> --by <agent did> ...` (register row DK1342): an agent sits a course end to end from the command line.
 *
 *   asp academy lens sit <id> --by <did>                                   read the free first lesson and see where you stand (no credits move)
 *   asp academy lens sit <id> --by <did> --enrol [--mandate <id>]           pay tuition (mock credits, by the price list) and enrol; prints the practice tasks
 *   asp academy lens sit <id> --by <did> --practice                         print the practice tasks again
 *   asp academy lens sit <id> --by <did> --artifact <file> | --stdin  --package <dir>  (--run-log <Action id> | --contract <running job id>)  [--service <url>] [--json]
 *                                                                           submit the answer: graded on held-out tasks (seeds from the log head now), the Registrar attests a pass, the lessons enter memory through the lesson gate
 *
 * Credits are accounting entries, not money. The courses are toys with scripted executors; nothing here changes model weights. With `--service` the grading is done by the service (its signed route), not by this machine.
 */
import { readFileSync } from "node:fs";
import { b64urlEncode, createRecord, signBytes } from "@agent-social/asp-core";
import { REGISTRAR_DID } from "@agent-social/asp-log";
import { loadCatalogue, courseService, type CourseCard } from "./catalogue.ts";
import { ENGINES, engineIds } from "./index.ts";
import { Ledger, MAX_SITTINGS_PER_DAY, SittingRefused, artifactKey, checkEnrolment, completeSitting, completedCards, courseRecordFor, describeSitting, freeLesson, openEnrolment, pendingPass, practiceSeed, runSitting, sitMessage, writeLessons, type SitResult } from "./sitting.ts";

export interface SitIo {
  out: (l: string) => void;
  flags: Record<string, string | string[] | boolean | undefined>;
  /** The agent's log (the local file log or the service's handle). */
  log: any;
  now: () => string;
  signerFor: (did: string) => any;
  /** Buys a service for the agent under its Mandate; returns the purchase id. */
  buy: (agent: string, service: string, mandate: string | undefined) => Promise<string>;
  /** Appends a record to the log, signed by `by`. */
  append: (type: string, by: string, subject: string | null, body: Record<string, unknown>) => Promise<{ id: string }>;
  /** Where the ledger of sittings is (a file); without it the ledger is memory only. */
  ledgerPath?: string;
  fetch?: typeof fetch;
  readStdin?: () => string;
  Usage: new (m: string) => Error;
}

const str = (o: SitIo, k: string): string | undefined => { const v = o.flags[k]; return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined; };
const USAGE = "asp academy lens sit <course id> --by <agent did> [--enrol [--mandate <id>]] [--practice] [--artifact <file> | --stdin --package <agent package dir> (--run-log <Action id> | --contract <running job id>)] [--service <url>] [--json]";

export async function sitCmd(courseId: string | undefined, o: SitIo): Promise<number> {
  const U = (m: string) => new o.Usage(m);
  if (!courseId) throw U(USAGE);
  const by = str(o, "by");
  if (!by) throw U(USAGE);
  const card = loadCatalogue(engineIds()).courses.find((c) => c.id === courseId);
  if (!card) throw U(`${courseId} is not a course in the catalogue (asp academy lens courses)`);
  const json = o.flags.json === true;
  const lines: string[] = [];
  const say = (l: string) => { if (json) lines.push(l); else o.out(l); };
  const finish = (code: number, extra: Record<string, unknown> = {}) => { if (json) o.out(JSON.stringify({ ok: code === 0, course: card.id, holder: by, lines, ...extra }, null, 2)); return code; };
  const ledger = new Ledger(o.ledgerPath);
  const reader = o.log.log ?? o.log;
  const doEnrol = o.flags.enrol === true, doPractice = o.flags.practice === true, art = str(o, "artifact"), useStdin = o.flags.stdin === true;
  const refuse = (e: unknown): number => { if (e instanceof SittingRefused) { say(`refused (${e.code}): ${e.message}`); return finish(1, { refusal: e.code }); } throw e; };

  try {
    // ---------------------------------------------------------------- the free first lesson: nothing is charged and nothing is written
    const open = await openEnrolment(reader, card, by);
    if (!doEnrol && !doPractice && !art && !useStdin) {
      const l = freeLesson(card);
      say(`${card.id}  ${card.title}`);
      say(`  the idea       ${l.concept} (${l.paper})`);
      say(`  first lesson   ${l.first_lesson} (free: no credits move)`);
      say(`  tuition        ${card.price} mock credits (accounting entries, not money), paid through the price list when you enrol`);
      say(`  you write      ${card.artifact.kind}: ${card.artifact.description}`);
      say(`  graded         ${card.gate.metric}; every one of ${card.gate.runs} runs must meet the mark; ${l.seed_rule}`);
      say(`  retry          ${l.retry_rule}`);
      say(`  written to     ${card.write_back.target} through the lesson gate, with the sitting's Action as evidence`);
      say(open ? `you are enrolled (${open.id}): asp academy lens sit ${card.id} --by ${by} --practice, then --artifact <file>` : `not enrolled: asp academy lens sit ${card.id} --by ${by} --enrol`);
      if (json) lines.push(JSON.stringify({ sample_practice: l.sample_practice }));
      return finish(0, { enrolled: !!open, enrolment: open?.id ?? null, lesson: l });
    }

    // ---------------------------------------------------------------- tuition and enrolment
    if (doEnrol) {
      if (open) { say(`already enrolled in ${card.id} (${open.id}); no second tuition is charged`); }
      else {
        const done = await completedCards(reader, by);
        const missing = card.prerequisites.filter((p) => !done.has(p));
        if (missing.length) throw new SittingRefused("prerequisite_missing", `${card.id} needs ${missing.join(", ")} completed first (asp academy lens sit ${missing[0]} --by ${by})`);
        const course = await courseRecordFor(reader, card);
        if (!course) throw new SittingRefused("unknown_course", `${card.id} is not published in this log yet: the operator prices it in the price list and publishes the course record before anyone can enrol`);
        const purchase = await o.buy(by, courseService(card), str(o, "mandate"));
        const enrolment = await o.append("enrolment", by, by, { course: course.id, purchase });
        say(`enrolled in ${card.id} (enrolment ${enrolment.id}); tuition ${card.price} mock credits paid (purchase ${purchase})`);
      }
    }
    const enrolment = open ?? (await openEnrolment(reader, card, by));
    if (!enrolment) throw new SittingRefused("not_enrolled", `${by} is not enrolled in ${card.id}: asp academy lens sit ${card.id} --by ${by} --enrol`);
    await checkEnrolment(reader, card, by, enrolment.id);

    // ---------------------------------------------------------------- the practice tasks
    const attemptsSoFar = ledger.entries().filter((x) => x.course === card.id && x.holder === by).length;
    if (doEnrol || doPractice) {
      const practice = ENGINES[card.generator.engine].practice(practiceSeed(card, by, enrolment.id, attemptsSoFar + 1));
      say(`practice tasks for ${card.id} (the held-out tasks are not among them; they are drawn from the log head at the moment you sit):`);
      say(JSON.stringify(practice, null, 2));
      if (!art && !useStdin) return finish(0, { enrolment: enrolment.id, practice });
    }

    // ---------------------------------------------------------------- the sitting
    const pkg = str(o, "package"), runLogFlag = str(o, "run-log"), contract = str(o, "contract");
    if (!pkg) throw U("a sitting writes a pass into the agent's memory: give --package <the agent's package dir>");
    if (!runLogFlag && !contract) throw U("a sitting is evidenced by the agent's own run: give --run-log <an Action id of yours made after enrolling> or --contract <your running job's id> (the Action is written for you on a pass)");
    let artifact: unknown;
    try { artifact = JSON.parse(useStdin ? (o.readStdin ?? (() => readFileSync(0, "utf8")))() : readFileSync(art!, "utf8")); } catch (e) { throw U(`the artifact is not JSON: ${(e as Error).message}`); }
    if (runLogFlag) {
      const a = (await reader.get(runLogFlag))?.record as { type: string; issuer: string; issued_at: string } | undefined;
      if (!a || a.type !== "asp.action/v0.2" || a.issuer !== by) throw U(`${runLogFlag} is not an Action of ${by} in this log`);
      if (Date.parse(a.issued_at) < Date.parse((enrolment as { issued_at: string }).issued_at)) throw U("that Action is older than your enrolment: cite a run made after enrolling");
    }

    let result: SitResult;
    const service = str(o, "service");
    const resumed = pendingPass(card, by, enrolment.id, artifact, ledger);
    if (resumed) { result = resumed; say("this answer already passed on this enrolment; finishing its completion and write-back (no new draw)"); }
    else if (service) result = await remoteSit(o, service.replace(/\/$/, ""), card, by, enrolment.id, artifact, ledger);
    else result = await runSitting(card, { holder: by, enrolment: enrolment.id, artifact, ...(runLogFlag ? { runLog: runLogFlag } : {}) }, { reader, ledger, now: o.now });
    for (const l of describeSitting(card, result)) say(l);
    if (!result.sitting.passed) return finish(1, { result });

    // ---------------------------------------------------------------- a pass: the Action, the Registrar's completion, the lessons through the gate
    let actionId = runLogFlag;
    if (!actionId) {
      const act = await o.append("action", by, contract!, { contract: contract!, scopes_used: [], summary: `sat ${card.id} attempt ${result.attempt}: passed, mean ${result.sitting.mean_permille / 10}%, artifact ${result.artifact_key.slice(0, 23)}` });
      actionId = act.id;
      say(`the sitting is reported in an Action of yours (${actionId})`);
    }
    let completion: string | undefined;
    if (service) {
      const r = await remoteComplete(o, service.replace(/\/$/, ""), card, by, enrolment.id, actionId);
      completion = r.completion;
      say(r.completion ? `the Registrar attested the completion (${r.completion})` : `completion not recorded: ${r.reason}`);
    } else {
      let reg: any;
      try { reg = o.signerFor(REGISTRAR_DID); } catch { reg = undefined; }
      if (!reg) say(`completion awaits the Registrar: this machine does not hold its key (the operator runs: asp academy complete --enrolment ${enrolment.id} --run-log ${actionId} --by ${REGISTRAR_DID})`);
      else {
        try {
          completion = await completeSitting(reader, { append: (rec) => o.log.append(rec) }, { ...reg, did: REGISTRAR_DID }, card, { holder: by, enrolment: enrolment.id, runLog: actionId }, { ledger, now: o.now, make: (type, issuer, subject, body, signer) => createRecord({ type: type as never, issuer, subject, prev: null, body, issued_at: o.now() }, signer) });
          say(`the Registrar attested the completion (${completion})`);
        } catch (e) { say(`completion not recorded: ${(e as Error).message}`); }
      }
    }
    const verdicts = await writeLessons(pkg, card, artifact, result.sitting, { signer: o.signerFor(by), actionId, now: new Date(o.now()) });
    for (const v of verdicts) say(v.admitted ? `admitted  ${v.lesson.id}` : `rejected  ${v.lesson.id}: ${v.reasons.map((r) => r.reason).join("; ")}`);
    const admitted = verdicts.filter((v) => v.admitted).length;
    say(admitted ? `${admitted} lesson(s) written to memory as one signed change (asp learned shows it and can undo it), with your Action ${actionId} as evidence` : "no lesson was written to memory: the gate rejected it (reasons above, kept in learned/rejected.json)");
    return finish(admitted === verdicts.length ? 0 : 1, { result, action: actionId, completion: completion ?? null, admitted, rejected: verdicts.length - admitted });
  } catch (e) { return refuse(e); }
}

// ------------------------------------------------------------------ the service's signed routes, from the client side
async function post(o: SitIo, service: string, path: string, body: unknown): Promise<any> {
  const res = await (o.fetch ?? fetch)(service + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}
function signed(o: SitIo, op: "practice" | "sit" | "complete", course: string, did: string, enrolment: string, artifact: string) {
  const at = o.now();
  const s = o.signerFor(did);
  return { did, enrolment, at, signature: b64urlEncode(signBytes(sitMessage(op, course, did, enrolment, at, artifact), s.seed)) };
}
async function remoteSit(o: SitIo, service: string, card: CourseCard, did: string, enrolment: string, artifact: unknown, ledger: Ledger): Promise<SitResult> {
  const j = await post(o, service, `/society/courses/${card.id}/sit`, { ...signed(o, "sit", card.id, did, enrolment, artifactKey(artifact)), artifact });
  if (!j.ok) throw new SittingRefused(j.refusal ?? "not_enrolled", j.message ?? "the service refused the sitting");
  // keep a local line too, so a pass whose completion failed can be finished without a new draw
  ledger.add({ at: o.now(), course: card.id, holder: did, enrolment, attempt: j.result.attempt, artifact: j.result.artifact_key, passed: j.result.sitting.passed, mean_permille: j.result.sitting.mean_permille, anchor: j.result.anchor });
  return j.result as SitResult;
}
async function remoteComplete(o: SitIo, service: string, card: CourseCard, did: string, enrolment: string, runLog: string): Promise<{ completion?: string; reason?: string }> {
  const j = await post(o, service, `/society/courses/${card.id}/complete`, { ...signed(o, "complete", card.id, did, enrolment, runLog), run_log: runLog });
  return j.ok ? { completion: j.completion as string } : { reason: String(j.message ?? "the service did not record it") };
}
export { MAX_SITTINGS_PER_DAY };
