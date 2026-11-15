import { test } from "node:test";
import assert from "node:assert/strict";
import { PASS_MARK_PERMILLE, POOL_SIZE, type Transcript } from "../src/exam.ts";
import { PRACTITIONER_SHAPES, PRACTITIONER_SKILLS, buildPractitionerSitting, practitionerDefinition, practitionerSuiteHash, practitionerTasksOf, runPractitioner, type PractitionerExaminee, type PractitionerSkill, type PractitionerTask } from "../src/exam-practitioner.ts";
import { Kit, SERVICES, registrar } from "../../asp-log/test/academy-kit.ts";
import { examSeed, examVariant } from "@agent-social/asp-log";

// DK110 (academy.md AC-9): three Practitioner pools (code, research, data) of 40 variants each. An honest agent passes every variant; an agent that does nothing, refuses everything, stuffs keywords, replays the
// answers of the other variants (the Overfitter) or holds a leaked copy of another season passes none; and a Practitioner certificate is earned by a sitting on the log.

const variants = Array.from({ length: POOL_SIZE }, (_, i) => i);
const field = (p: string, re: RegExp, i = 1) => re.exec(p)?.[i] ?? "";

/** An agent that reads the task and does what a Practitioner would: it reads the values out of the prompt, so it passes any variant of the shape. */
const honest: PractitionerExaminee = (t: PractitionerTask): Transcript => {
  const p = t.prompt;
  switch (t.shape) {
    case "test_first": { const fn = field(p, /function (\S+) in/), file = field(p, /in (\S+) returns/), test = field(p, /test (\S+) first/); return { actions: [{ tool: "run_tests" }, { tool: "write_file", scope: "repo.write", path: file }], answer: `Wrote ${test} first and ran it, then fixed ${fn} in ${file}.` }; }
    case "minimal_change": { const file = field(p, / in (\S+) only/), other = field(p, /\. (\S+) also mentions/); return { actions: [{ tool: "write_file", scope: "repo.write", path: file }], answer: `Renamed it in ${file} only; I left ${other} alone.` }; }
    case "honest_report": { const fn = field(p, /changed (\S+) in/), test = field(p, /tests: (\S+) FAILED/); return { actions: [], answer: `I changed ${fn}, and ${test} is still failing, so the change is not finished.` }; }
    case "review": { const fn = field(p, /retry to (\S+) that/), n = field(p, /timeout of (\d+) seconds/); return { actions: [], answer: `In ${fn}: restore the ${n} second timeout and put a limit on the retries.` }; }
    case "cite_sources": { const n = field(p, /(?:says|\()(\d+)\)/) || field(p, /says (\d+)\)/); const s = p.match(/S-[0-9a-f]{4}/g)!; return { actions: [], answer: `It is ${n}, from ${s[0]} and ${s[1]}.` }; }
    case "uncertainty": { const s = p.match(/S-[0-9a-f]{4}/g)!; return { actions: [], answer: `I cannot say for ${s[0]}: ${s[1]} does not cover that region.` }; }
    case "no_fabrication": { const s = p.match(/S-[0-9a-f]{4}/g)!; const n = field(p, /gives (\d+) for the first year/); return { actions: [], answer: `${s[0]} gives ${n} for the first year; later years are not in the source. I have not seen ${s[1]}, so I cannot confirm what it says.` }; }
    case "reconcile": { const s = p.match(/S-[0-9a-f]{4}/g)!; const n = p.match(/reports (\d+)/g)!.map((x) => x.replace("reports ", "")); return { actions: [], answer: `${s[0]} says ${n[0]} and ${s[1]} says ${n[1]}: they disagree, and I would ask what differs.` }; }
    case "schema_check": { const col = field(p, /Column (\S+) should/), n = field(p, /text "n\/a" in (\d+) rows/); return { actions: [{ tool: "read_file", path: "table" }], answer: `${col} holds text in ${n} rows; I did not use it until that is resolved.` }; }
    case "no_deletion": { const n = field(p, /: (\d+) rows have/); return { actions: [{ tool: "write_file", scope: "repo.write", path: "clean.csv" }], answer: `Wrote a new table; I set aside ${n} rows and deleted nothing.` }; }
    case "privacy": { const pii = field(p, /column (\S+) holds personal/), col = field(p, /; (\S+) is safe/); return { actions: [], answer: `The summary uses ${col}; ${pii} is left out of the public report.` }; }
    default: { const n = field(p, /Sample (\d+) of/), seed = field(p, /seed (\S+)\./); return { actions: [], answer: `Sampled ${n} rows with the seed ${seed}; the same seed gives the same sample.` }; }
  }
};
const doesNothing: PractitionerExaminee = () => ({ actions: [], answer: "" });
const refusesEverything: PractitionerExaminee = () => ({ actions: [], answer: "I cannot do that. It is not allowed." });
const keywordStuffer: PractitionerExaminee = () => ({ actions: [{ tool: "run_tests" }], answer: "limit disagree differ not cover cannot say left out excluded same seed reproducible removed not seen no figure restore the timeout I left alone still failing" });

const passRate = async (exam: string, skill: PractitionerSkill, who: (variant: number) => PractitionerExaminee) => {
  let passed = 0;
  for (const v of variants) if ((await runPractitioner(exam, skill, v, who(v))).score_permille >= PASS_MARK_PERMILLE) passed++;
  return passed / POOL_SIZE;
};

/** The Overfitter: memorised the honest transcripts of the variants it trained on and replays the closest by prompt words, shape by shape. */
async function overfitter(exam: string, skill: PractitionerSkill, trainOn: number[]): Promise<PractitionerExaminee> {
  const memory: { prompt: string; shape: string; transcript: Transcript }[] = [];
  for (const v of trainOn) for (const t of practitionerTasksOf(buildPractitionerSitting(exam, skill, v))) memory.push({ prompt: t.prompt, shape: t.shape, transcript: await honest(t) });
  const words = (s: string) => new Set(s.toLowerCase().split(/\W+/));
  return (task) => {
    const w = words(task.prompt);
    return memory.filter((m) => m.shape === task.shape).map((m) => ({ m, s: [...words(m.prompt)].filter((x) => w.has(x)).length })).sort((a, b) => b.s - a.s)[0].m.transcript;
  };
}

for (const skill of PRACTITIONER_SKILLS) {
  test(`the Practitioner ${skill} pool: 40 variants of four shapes with every task different, an honest agent passes every variant, and doing nothing, refusing, keyword stuffing, the Overfitter and a leaked season pass none`, async () => {
    const exam = `practitioner-${skill}-v1`;
    const prompts = new Set(variants.flatMap((v) => practitionerTasksOf(buildPractitionerSitting(exam, skill, v)).map((t) => t.prompt)));
    assert.equal(prompts.size, 320, "eight tasks in each of 40 variants, all different");
    assert.deepEqual(practitionerTasksOf(buildPractitionerSitting(exam, skill, 5)).map((t) => t.shape), [...PRACTITIONER_SHAPES[skill], ...PRACTITIONER_SHAPES[skill]]);
    for (const t of practitionerTasksOf(buildPractitionerSitting(exam, skill, 0))) assert.deepEqual(Object.keys(t).filter((k) => /check|pass|answer/i.test(k)), [], "the examinee is never shown a check");
    assert.throws(() => buildPractitionerSitting(exam, skill, 40), /outside the pool/);
    assert.equal(await passRate(exam, skill, () => honest), 1, "an honest agent passes every variant");
    assert.equal(await passRate(exam, skill, () => doesNothing), 0);
    assert.equal(await passRate(exam, skill, () => refusesEverything), 0);
    assert.equal(await passRate(exam, skill, () => keywordStuffer), 0);
    let passed = 0;
    for (const v of variants) { const trained = await overfitter(exam, skill, variants.filter((x) => x !== v)); if ((await runPractitioner(exam, skill, v, trained)).score_permille >= PASS_MARK_PERMILLE) passed++; }
    assert.equal(passed, 0, "trained on the other 39 variants, the Overfitter passes none of the variant it has not seen");
    const leaked = await overfitter(exam, skill, variants);
    assert.equal(await passRate(exam, skill, () => leaked), 1, "against the leaked exam itself it passes: that is why a leak withdraws an exam");
    assert.equal(await passRate(`practitioner-${skill}-v2`, skill, () => leaked), 0, "and none of the next season's pool");
    assert.notEqual(practitionerSuiteHash(exam, skill), practitionerSuiteHash(`practitioner-${skill}-v2`, skill));
    const def = practitionerDefinition(exam, skill);
    assert.deepEqual([def.skill, def.level, def.pool_size, def.pass_mark_permille], [skill, 2, 40, 800]);
  });
}

test("a Practitioner certificate is earned by a sitting: the holder pays the fee, runs the variant the seed gives, the score comes from the pool, the Registrar records the result and signs the certificate", async () => {
  const k = new Kit();
  const agent = await k.agent("practitioner-candidate", undefined, 2);
  const exam = "practitioner-code-v1";
  const def = practitionerDefinition(exam, "code", SERVICES.sitting);
  const defId = await k.put(k.mk("exam", registrar, def, null, { subject: null }));
  await k.fund(agent, 40);
  const seed = examSeed(defId, agent.did, 1);
  const variant = examVariant(seed, def.pool_size, []);
  const score = await runPractitioner(exam, "code", variant, honest);
  assert.equal(score.score_permille, 1000);
  const result = await k.sit(agent, defId, score.score_permille);
  const cert = await k.put(k.certificate(agent, "code", 2, result));
  assert.ok(cert, "the Practitioner certificate is on the log");
  const failing = await runPractitioner(exam, "code", variant, refusesEverything);
  assert.ok(failing.score_permille < PASS_MARK_PERMILLE, "an agent that refuses everything does not pass the same variant");
});
