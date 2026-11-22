// ENG75, the groundwork: a controlled comparison of agents with and without access to the field cards, the courses and accreditation, on the same society. The harness (random assignment from a seed, the tool switch, a fixed
// held-out battery of house jobs scored by the house's own checks, the change between the arms read against a spread, accreditation measured two ways) is tested with stand-in agents whose skill does and does not respond.
// NOTHING here claims anything about real agents. Fake key.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { ACCESS_TOOLS, accreditationOf, assignAccess, chooseBattery, experimentReport, hiddenTools, parseResources, renderExperiment, runBattery, type AnswerFn, type BatteryScore } from "../src/cohort/experiment.ts";
import { HOUSE_JOBS, type HouseJob } from "../src/cohort/house-jobs.ts";

const SECRET = "sk-ant-api03-FAKE-experiment-9876543210abcdef";
const P = "mcp__society__";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

// ---- stand-in agents for the harness ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
const FILLER = "The market, the forum and the academy each have a place here. First I read the notice, then I counted 3 items, and 2 of them were good because they were clear. The result is plain: 1) one, 2) two, 3) three. Answer: the market pays for work, the forum is for talk, the academy teaches. It is short, and it is true.";
const BANK = (j: HouseJob) => [
  "Strength: it is clear and short. Open question: what would change it? It differs, but both work, whereas the old way failed.", "Rule 1: read first. Lesson: ask before you write. The rules are short, but they help; trust differs from doubt because of the reason.",
  "It is clear. It is short? Yes, but the difference is plain, whereas the old text was long. Market academy forum.", FILLER, `${j.criterion}. ${FILLER}`, `${FILLER} ${j.criterion}`, `${j.purpose}. ${FILLER}`,
  `Summary: ${FILLER} Category: yes. List: a, b, c. Count: 3. market academy forum registry courts bank clinic treasury housing shops map charters`,
];
/** A delivery that the house's check accepts, if the bank has one for this job. */
const goodAnswer = (j: HouseJob): string | undefined => BANK(j).find((c) => j.check(c) === null);
const PASSABLE = HOUSE_JOBS.filter((j) => !j.partner && goodAnswer(j));
const unit = (...parts: (string | number)[]) => parseInt(createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 8), 16) / 0xffffffff;
/** A stand-in whose chance of a delivery the check accepts is its own skill, plus `gain` after the experiment if it had access and its skill responds. */
const standIn = (skill: (agent: string) => number, hadAccess: (agent: string) => boolean, gain: number): AnswerFn => async (agent, job, _prompt, phase) => {
  const p = Math.min(0.98, skill(agent) + (phase === "after" && hadAccess(agent) ? gain : 0));
  const good = goodAnswer(job);
  return good && unit("answer", agent, job.purpose, phase) < p ? good : "no";
};

test("the pool: the bank of generic deliveries satisfies most of the house's text jobs, so the stand-ins can be made to pass or fail a job on purpose", () => {
  assert.ok(PASSABLE.length >= 40, `${PASSABLE.length} of the solo house jobs have a delivery the check accepts`);
});

test("assignment: exactly half of the agents get access, the same seed gives the same split, another seed another, and the order of the ids does not matter; the resources and the tools they switch are as written", () => {
  const ids = Array.from({ length: 15 }, (_, i) => `agent-${String(i + 1).padStart(2, "0")}`);
  const a = assignAccess(ids, 7), b = assignAccess(ids, 7), c = assignAccess(ids, 8);
  assert.deepEqual([...a], [...b]);
  assert.equal([...a.values()].filter((x) => x === "access").length, 7);
  assert.notDeepEqual([...a], [...c]);
  assert.deepEqual(ids.map((i) => a.get(i)), ids.map((i) => assignAccess([...ids].reverse(), 7).get(i)));
  assert.deepEqual(parseResources(undefined), ["cards", "courses", "accreditation"]); assert.deepEqual(parseResources("cards,courses"), ["cards", "courses"]);
  assert.throws(() => parseResources("cards,gold"), /gold is none of those/);
  assert.deepEqual([...hiddenTools(["cards"])].sort(), ["field_answer", "inspect"]);
  assert.ok(hiddenTools(["courses"]).has("course_sit") && hiddenTools(["courses"]).has("look_courses"));
  assert.equal(hiddenTools(["accreditation"]).size, 0, "accreditation has no tool of its own in this build");
  assert.deepEqual(ACCESS_TOOLS.accreditation, []);
});

test("the battery: the same fixed held-out jobs for every agent, chosen from the seed (the same for the same seed), solo jobs only, scored by the house's own check", async () => {
  const battery = chooseBattery(5, 8, PASSABLE);
  assert.equal(battery.length, 8); assert.equal(new Set(battery.map((j) => j.purpose)).size, 8); assert.ok(battery.every((j) => !j.partner));
  assert.deepEqual(chooseBattery(5, 8, PASSABLE).map((j) => j.purpose), battery.map((j) => j.purpose));
  assert.notDeepEqual(chooseBattery(6, 8, PASSABLE).map((j) => j.purpose), battery.map((j) => j.purpose));
  const always = await runBattery("a", "before", battery, async (_a, j) => goodAnswer(j)!);
  assert.deepEqual([always.passed, always.total, always.score, always.failures.length], [8, 8, 1, 0]);
  const never = await runBattery("a", "after", battery, async () => "no");
  assert.deepEqual([never.passed, never.score], [0, 0]); assert.equal(never.failures.length, 8); assert.ok(never.failures[0]!.why.length > 0, "the check says why");
  const half = await runBattery("a", "before", battery, async (_a, j) => (battery.indexOf(j) % 2 ? "no" : goodAnswer(j)!));
  assert.equal(half.score, 0.5);
});

async function experiment(gain: number, seed: number, spread?: number) {
  const ids = Array.from({ length: 40 }, (_, i) => `agent-${String(i + 1).padStart(2, "0")}`);
  const arms = assignAccess(ids, seed);
  const battery = chooseBattery(seed, 12, PASSABLE);
  const skill = (a: string) => 0.3 + 0.3 * unit("skill", a);                       // each agent's own skill before: 0.3 to 0.6
  const answer = standIn(skill, (a) => arms.get(a) === "access", gain);
  const scores: BatteryScore[] = [];
  for (const id of ids) for (const phase of ["before", "after"] as const) scores.push(await runBattery(id, phase, battery, answer));
  return experimentReport({ resources: ["cards", "courses", "accreditation"], arms, scores, ...(spread !== undefined ? { spread } : {}) });
}

test("stand-in agents whose skill RESPONDS to the access: the access arm's change is larger than the control's by about the gain, and, against a spread from repeat runs, the report calls it larger than the spread", async () => {
  const r = await experiment(0.35, 11, 0.2);
  assert.equal(r.arms.access!.agents, 20); assert.equal(r.arms.control!.agents, 20);
  assert.ok(r.arms.access!.change! > r.arms.control!.change! + 0.2, `access ${r.arms.access!.change}, control ${r.arms.control!.change}`);
  assert.ok(r.difference! > 0.2 && r.difference! < 0.5, `difference ${r.difference}`);
  assert.match(r.reading, /is larger than the spread between repeat runs \(0\.2\)\. It is still a comparison of a few agents on one society, not a claim about agents in general\./);
  const md = renderExperiment(r);
  assert.match(md, /## Does access help\? \(a controlled comparison, not a claim\)/);
  assert.match(md, /assigned at random \(from the seed, exactly half\) to access, or no access, to: cards, courses, accreditation/);
  assert.match(md, /\*\*What this cannot tell you:\*\*/); assert.match(md, /anything about agents in general/);
});

test("stand-in agents whose skill does NOT respond: the arms change alike (only chance is left), and the report does not call the small difference a difference, with a spread or without one", async () => {
  const r = await experiment(0, 11, 0.2);
  assert.ok(Math.abs(r.difference!) < 0.2, `difference ${r.difference}`);
  assert.match(r.reading, /is no larger than the spread between repeat runs \(0\.2\): it is not called a difference\./);
  const none = await experiment(0, 11);
  assert.match(none.reading, /No spread between repeat runs has been measured for this setup \(ENG72\), so this difference is not called a difference: one run is one draw\./);
  // the same seed world and the same agents: the responsive run differs from this one only by the gain
  const resp = await experiment(0.35, 11);
  assert.ok(resp.difference! - none.difference! > 0.2, "the gain, and only the gain, moves the difference");
  assert.match(resp.reading, /No spread between repeat runs/, "even a large difference is not called one without a spread");
});

test("accreditation measured two ways from the trace: jobs delivered by the accredited and the others, and how often each is hired; and nothing to compare when the battery was not given", () => {
  const ag = (a: string) => ({ t: "agent", at: "x", agent: a, did: `did:${a}`, handle: a });
  const deliver = (a: string) => ({ t: "tool", at: "x", agent: a, turn: 1, tool: "deliver_job", input: {}, ok: true, chars: 1, institution: "market", scope: "s", writes: true, ms: 1 });
  const hire = (by: string, worker: string) => ({ t: "tool", at: "x", agent: by, turn: 1, tool: "accept_offer", input: {}, ok: true, targetAuthor: `did:${worker}`, chars: 1, institution: "market", scope: "s", writes: true, ms: 1 });
  const ev = [ag("a"), ag("b"), ag("c"), ag("d"), { t: "accredited", at: "x", agent: "a" }, { t: "accredited", at: "x", agent: "b" },
    deliver("a"), deliver("a"), deliver("b"), deliver("c"), hire("c", "a"), hire("d", "a"), hire("d", "b"), hire("a", "c")] as never[];
  const r = experimentReport({ resources: ["courses"], arms: new Map(), scores: [], events: ev });
  assert.equal(r.difference, null); assert.match(r.reading, /nothing to compare/);
  assert.deepEqual(r.accreditation, accreditationOf(ev, new Set(["a", "b"])));
  assert.deepEqual([r.accreditation!.accredited, r.accreditation!.others], [2, 2]);
  assert.deepEqual(r.accreditation!.deliveredPerAgent, { accredited: 1.5, others: 0.5 });
  assert.deepEqual(r.accreditation!.hiredPerAgent, { accredited: 1.5, others: 0.5 });
  assert.match(renderExperiment(r), /Do accredited agents do better on the same jobs\? .*accredited 1\.5 \(2 agents\), others 0\.5 \(2 agents\)/);
  assert.match(renderExperiment(r), /Do others prefer them\? Hired .*accredited 1\.5, others 0\.5/);
});

// ---- in a cohort run -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
async function provider(script: (r: { system: string; last: string; n: number; tools: string[] }) => unknown[]) {
  const seen: { who: string; tools: string[] }[] = []; const counts: Record<string, number> = {};
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const msgs = body.messages ?? []; const lm = msgs[msgs.length - 1];
      const last = typeof lm?.content === "string" ? lm.content : JSON.stringify(lm?.content ?? "");
      const system = Array.isArray(body.system) ? body.system.map((b: { text?: string }) => b.text ?? "").join("") : String(body.system ?? "");
      const who = /PERSON-([ABCD])/.exec(system)![1]!; counts[who] = (counts[who] ?? 0) + 1;
      const tools = (body.tools ?? []).map((t: { name: string }) => t.name.replace(P, ""));
      seen.push({ who, tools });
      const content = script({ system, last, n: counts[who]!, tools });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 700, output_tokens: 50 }, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
}
async function asp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-exp-home-"));
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, EXP_KEY: SECRET }, cwd: home } as Io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const personas = () => { const d = mkdtempSync(join(tmpdir(), "asp-exp-pers-")); const f = join(d, "p.txt"); writeFileSync(f, "You are PERSON-A.\n\nYou are PERSON-B.\n\nYou are PERSON-C.\n\nYou are PERSON-D.\n"); return f; };

test("in a cohort run: a random half of the agents (from --seed) are offered the course and card tools and the other half are not, the report has the comparison section with nothing claimed, and the run verifies", { timeout: 240_000 }, async () => {
  const p = await provider((r) => (r.n === 1 ? [{ type: "tool_use", id: "a", name: P + "look_charters", input: {} }] : [{ type: "tool_use", id: "b", name: P + "leave", input: { reason: "done" } }]));
  const out = mkdtempSync(join(tmpdir(), "asp-exp-out-"));
  const args = (seed: string, extra: string[] = []) => ["society", "cohort", "--local", "--agents", "4", "--model", "claude-haiku-5-5", "--api-key-env", "EXP_KEY", "--budget-usd", "0.40", "--provider-url", p.url, "--out", out, "--sim-speed", "100000", "--persona-file", personas(), "--seed", seed, "--experiment", "access", ...extra];
  const r = await asp(args("5"));
  assert.equal(r.code, 0, r.err + r.out);
  const dir = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!);
  const events = readFileSync(join(dir, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) as any[];
  const armOf = new Map<string, string>(events.filter((e) => e.t === "agent").map((e) => [e.agent, e.access]));
  assert.deepEqual([...armOf.values()].filter((a) => a === "access").length, 2); assert.equal([...armOf.values()].filter((a) => a === "control").length, 2);
  const persona = (id: string) => "ABCD"[Number(id.slice(-2)) - 1]!;
  for (const [id, arm] of armOf) {
    const tools = p.seen.filter((s) => s.who === persona(id)).map((s) => s.tools);
    assert.ok(tools.length > 0);
    const has = (t: string) => tools.every((ts) => ts.includes(t));
    if (arm === "access") { assert.ok(has("course_sit") && has("look_courses") && has("course_enrol") && has("my_progress"), `${id} has the course tools (the card tools come with --markers)`); }
    else { assert.ok(tools.every((ts) => !ts.includes("course_sit") && !ts.includes("look_courses") && !ts.includes("course_enrol") && !ts.includes("my_progress") && !ts.includes("field_answer") && !ts.includes("inspect")), `${id} does not`); assert.ok(has("forum_post") && has("look_charters"), "the control keeps the rest of the tools"); }
  }
  const xr = JSON.parse(readFileSync(join(dir, "experiment.json"), "utf8")) as ReturnType<typeof experimentReport>;
  assert.equal(xr.arms.access!.agents, 2); assert.equal(xr.arms.control!.agents, 2); assert.equal(xr.difference, null);
  assert.match(xr.reading, /nothing to compare: the battery was not given to both arms/);
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /## Does access help\? \(a controlled comparison, not a claim\)/); assert.match(md, /What this cannot tell you/);
  assert.equal((await asp(["society", "cohort", "verify", dir])).code, 0);
  // the same seed, the same split; --access cards switches only the cards
  const again = await asp(args("5", ["--access", "cards"]));
  assert.equal(again.code, 0, again.err);
  const dir2 = readdirSync(out).filter((x) => x.startsWith("cohort-")).map((d) => join(out, d)).find((d) => d !== dir)!;
  const ev2 = readFileSync(join(dir2, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) as any[];
  assert.deepEqual(ev2.filter((e) => e.t === "agent").map((e) => e.access), events.filter((e) => e.t === "agent").map((e) => e.access), "the same seed, the same agents get access");
  assert.deepEqual(JSON.parse(readFileSync(join(dir2, "experiment.json"), "utf8")).resources, ["cards"]);
  // flags
  assert.equal((await asp(["society", "cohort", "--local", "--agents", "2", "--model", "claude-haiku-5-5", "--api-key-env", "EXP_KEY", "--budget-usd", "0.4", "--experiment", "gold"])).code, 2);
  const lone = await asp(["society", "cohort", "--local", "--agents", "2", "--model", "claude-haiku-5-5", "--api-key-env", "EXP_KEY", "--budget-usd", "0.4", "--access", "cards"]);
  assert.equal(lone.code, 2); assert.match(lone.err, /add --experiment access/);
  const stand = await asp(["society", "cohort", "--local", "--provider", "stand-in", "--agents", "2", "--budget-usd", "1", "--experiment", "access"]);
  assert.equal(stand.code, 2); assert.match(stand.err, /needs a real-model run/);
});
