// ENG72: the same cohort setup run at least twice, and a report with each headline figure in each run and the spread between runs, the rule that a difference smaller than the spread is not called a difference, and the cost
// of the repeat as a cap. Stand-in providers: one that behaves the same in every run (the spreads of the counts and the cost are zero) and one that varies on purpose (the spread shows it). Fake key.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { FIGURES, headlineOf, readDifference, renderComparison, renderRepeat, repeatReport, spreadOf } from "../src/cohort/repeat.ts";

const SECRET = "sk-ant-api03-FAKE-repeat-9876543210abcdef";
const P = "mcp__society__";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const filesUnder = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
const use = (name: string, input: Record<string, unknown> = {}, id = "t") => [{ type: "tool_use", id, name: P + name, input }];

/** `postsInRun(runIndex)`: how many posts each agent makes in that run (the opening message marks a new agent; two agents make a run). */
async function provider(postsInRun: (run: number) => number) {
  let openings = 0; const per: Record<string, { run: number; n: number }> = {};
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const msgs = body.messages ?? [];
      const first = msgs.length === 1 && /You are here now/.test(typeof msgs[0].content === "string" ? msgs[0].content : "");
      const system = Array.isArray(body.system) ? body.system.map((b: { text?: string }) => b.text ?? "").join("") : String(body.system ?? "");
      const who = /PERSON-([AB])/.exec(system)![1]!;
      if (first) { openings++; per[who + Math.ceil(openings / 2)] = { run: Math.ceil(openings / 2), n: 0 }; }
      const st = per[who + Math.ceil(openings / 2)]!;
      st.n++;
      const posts = postsInRun(st.run);
      const content = st.n <= posts ? use("forum_post", { title: `Hello ${who} ${st.n}`, text: `A short note number ${st.n} from ${who} about the plaza and the board.` }) : use("leave", { reason: "done" });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 700, output_tokens: 50 }, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
async function asp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-rep-home-"));
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, REP_KEY: SECRET }, cwd: home } as Io);
  return { code, out: out.join("\n"), err: err.join("\n"), home };
}
const personas = () => { const d = mkdtempSync(join(tmpdir(), "asp-rep-pers-")); const f = join(d, "p.txt"); writeFileSync(f, "You are PERSON-A.\n\nYou are PERSON-B.\n"); return f; };
const repeat = async (url: string, out: string, extra: string[] = []) => asp(["society", "cohort", "repeat", "--runs", "2", "--local", "--agents", "2", "--model", "claude-haiku-5-5", "--api-key-env", "REP_KEY", "--budget-usd", "0.40", "--total-usd", "1", "--provider-url", url, "--out", out, "--sim-speed", "100000", "--persona-file", personas(), "--seed", "3", ...extra]);
const folderOf = (out: string) => join(out, readdirSync(out).find((d) => d.startsWith("repeat-"))!);

test("a setup that behaves the same in every run: the repeat report has each figure in each run, the counts and the cost agree exactly (spread 0), the cost of the repeat is a cap, every run verifies and the key is in no file", { timeout: 300_000 }, async () => {
  const url = await provider(() => 2);
  const out = mkdtempSync(join(tmpdir(), "asp-rep-out-"));
  const r = await repeat(url, out);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /repeat: the same setup 2 times, one after the other, in .*; each run is capped at \$1\.00 and the repeat at \$2\.00 in all \(a cap, never a price\)/);
  assert.match(r.out, /--- run 1 of 2 ---/); assert.match(r.out, /--- run 2 of 2 ---/);
  const dir = folderOf(out);
  const rep = JSON.parse(readFileSync(join(dir, "repeat-report.json"), "utf8")) as ReturnType<typeof repeatReport> & { runFolders: string[] };
  assert.equal(rep.runs, 2); assert.equal(rep.runFolders.length, 2);
  assert.deepEqual(rep.figures.posts!.values, [4, 4], "two agents, two posts each, in both runs");
  assert.equal(rep.figures.posts!.spread!.range, 0); assert.equal(rep.figures.messages!.spread!.range, 0); assert.equal(rep.figures.usd!.spread!.range, 0, "the same tokens, the same cost");
  for (const k of ["posts", "messages", "comments", "jobsDelivered", "usd"]) assert.ok(rep.agreed.includes(rep.figures[k]!.label), `${k} agreed`);
  assert.equal(rep.capUsdAll, 2); assert.equal(rep.capUsdPerRun, 1);
  const md = readFileSync(join(dir, "repeat-report.md"), "utf8");
  assert.match(md, /# The same setup, 2 times: how much does it vary\?/);
  assert.match(md, /\| Posts \| 4 \| 4 \| 4 \| 0 \| 0 \|/);
  assert.match(md, /that is smaller than the spread between repeat runs of the same setup is not called a difference/);
  assert.match(md, /The runs agreed exactly on: .*Posts/);
  assert.match(md, /\*\*Cost of the repeat:\*\* at most \$2\.00 in all \(2 runs, each capped at \$1\.00\): a cap, never a price\./);
  assert.match(md, /depend on how fast the machine and the provider were/);
  for (const f of rep.runFolders) assert.equal((await asp(["society", "cohort", "verify", f])).code, 0, `${f} verifies`);
  for (const f of [...filesUnder(out), ...filesUnder(r.home)]) assert.ok(!readFileSync(f).includes(SECRET), `${f} holds the key`);
});

test("a setup that varies on purpose (two posts each in the first run, six in the second): the spread shows it, the figure is listed as varying, and the reading rule gives a smaller difference no weight", { timeout: 300_000 }, async () => {
  const url = await provider((run) => (run === 1 ? 1 : 3));
  const out = mkdtempSync(join(tmpdir(), "asp-rep-out-"));
  const r = await repeat(url, out);
  assert.equal(r.code, 0, r.err + r.out);
  const dir = folderOf(out);
  const rep = JSON.parse(readFileSync(join(dir, "repeat-report.json"), "utf8")) as ReturnType<typeof repeatReport>;
  assert.deepEqual(rep.figures.posts!.values, [2, 6]);
  assert.deepEqual([rep.figures.posts!.spread!.range, rep.figures.posts!.spread!.mean], [4, 4]);
  assert.ok(rep.varied.includes(rep.figures.posts!.label) && !rep.agreed.includes(rep.figures.posts!.label));
  assert.ok(rep.figures.usd!.spread!.range > 0, "more posts, more calls, another cost");
  assert.match(readFileSync(join(dir, "repeat-report.md"), "utf8"), /They varied on: .*Posts/);
  // read a difference against that spread: a later round of the same size, one smaller than the spread and one larger
  const near = repeatReport([{ ...headlineOf([]), posts: 3 }, { ...headlineOf([]), posts: 3 }]);
  const far = repeatReport([{ ...headlineOf([]), posts: 12 }, { ...headlineOf([]), posts: 12 }]);
  writeFileSync(join(dir, "near.json"), JSON.stringify(near)); writeFileSync(join(dir, "far.json"), JSON.stringify(far));
  const c1 = await asp(["society", "cohort", "compare", join(dir, "repeat-report.json"), join(dir, "near.json")]);
  assert.equal(c1.code, 0, c1.err); assert.match(c1.out, /\| Posts \| 4 \| 3 \| 1 \| 4 \| not a difference \|/);
  const c2 = await asp(["society", "cohort", "compare", join(dir, "repeat-report.json"), join(dir, "far.json")]);
  assert.match(c2.out, /\| Posts \| 4 \| 12 \| 8 \| 4 \| larger than the spread \|/);
  assert.match(c2.out, /a difference larger than it is a reason to look again, not a result/);
});

test("--runs is from 2 to 10 and a repeat does not take a founding snapshot; compare needs two reports that exist", async () => {
  const common = ["society", "cohort", "repeat", "--local", "--agents", "1", "--model", "claude-haiku-5-5", "--api-key-env", "REP_KEY", "--budget-usd", "0.4"];
  const one = await asp([...common, "--runs", "1"]); assert.equal(one.code, 2); assert.match(one.err, /--runs is a whole number from 2 to 10: a spread needs at least two runs/);
  const eleven = await asp([...common, "--runs", "11"]); assert.equal(eleven.code, 2);
  const snap = await asp([...common, "--snapshot-out", "x.json"]); assert.equal(snap.code, 2); assert.match(snap.err, /does not write or read a founding snapshot/);
  const none = await asp(["society", "cohort", "compare", "a.json"]); assert.equal(none.code, 2);
  const missing = await asp(["society", "cohort", "compare", "nope-a.json", "nope-b.json"]); assert.equal(missing.code, 2); assert.match(missing.err, /is not there/);
});

test("the spread and the reading rule: range, mean and SD of the values, a difference of means against the larger spread, and a headline read from a trace", () => {
  const s = spreadOf([2, 6]);
  assert.deepEqual([s.min, s.max, s.range, s.mean], [2, 6, 4, 4]); assert.ok(Math.abs(s.sd - 2.8284) < 1e-3);
  assert.deepEqual(spreadOf([5, 5]), { values: [5, 5], min: 5, max: 5, range: 0, mean: 5, sd: 0 });
  assert.deepEqual(readDifference(spreadOf([4, 6]), spreadOf([5, 6])), { difference: 0.5, spread: 2, reading: "not a difference" });
  assert.equal(readDifference(spreadOf([4, 6]), spreadOf([10, 10])).reading, "larger than the spread");
  assert.equal(readDifference(spreadOf([4, 4]), spreadOf([4, 4])).reading, "not a difference", "equal means are never a difference");
  const ev = [
    { t: "agent", at: "x", agent: "a", did: "d", handle: "a" }, { t: "agent", at: "x", agent: "b", did: "e", handle: "b" },
    { t: "credits", at: "x", agent: "a", when: "start", balance: 100 }, { t: "credits", at: "x", agent: "a", when: "end", balance: 108 }, { t: "credits", at: "x", agent: "b", when: "start", balance: 100 }, { t: "credits", at: "x", agent: "b", when: "end", balance: 100 },
    { t: "arrival", at: "x", agent: "a", simMs: 0 }, { t: "arrival", at: "x", agent: "b", simMs: 600_000 }, { t: "wake", at: "x", agent: "a", simMs: 3_600_000, because: "x", kinds: [], events: 0, delayedSimMs: 0 },
    { t: "leave", at: "x", agent: "b", simMs: 660_000, sinceArrivalMs: 60_000, pending: 0, afterCheck: true, reason: "x" },
    { t: "tool", at: "x", agent: "a", turn: 1, tool: "forum_post", input: { text: "alpha beta gamma" }, ok: true, chars: 1, institution: "forum", scope: "s", writes: true, ms: 1 },
    { t: "tool", at: "x", agent: "a", turn: 2, tool: "send_message", input: { text: "delta epsilon zeta" }, ok: true, chars: 1, institution: "messages", scope: "s", writes: true, ms: 1 },
    { t: "tool", at: "x", agent: "b", turn: 1, tool: "deliver_job", input: {}, ok: true, chars: 1, institution: "market", scope: "s", writes: true, ms: 1 },
    { t: "model", at: "x", agent: "a", turn: 1, input: 1, output: 1, usd: 0.03 },
  ] as never[];
  const h = headlineOf(ev, 30);
  assert.deepEqual([h.posts, h.messages, h.comments, h.jobsDelivered, h.creditsEarnedMean, h.usefulActions, h.usd, h.costPerUsefulAction], [1, 1, 0, 1, 4, 3, 0.03, 0.01]);
  assert.equal(h.minutesStayed, (60 + 1) / 2, "a stayed 60 simulated minutes, b stayed 1");
  assert.equal(h.prematureLeaveRate, 0.5, "b left after one minute with nothing waiting: one of two agents");
  assert.equal(h.diversity, 1, "no two of the texts share a word");
  assert.equal(FIGURES.length, 10);
  const md = renderRepeat(repeatReport([h, { ...h, posts: 3 }], { capUsdPerRun: 6 }));
  assert.match(md, /\| Posts \| 1 \| 3 \| 2 \| 2 \| 1\.4142 \|/);
  assert.match(md, /at most \$12\.00 in all/);
  assert.match(renderComparison(repeatReport([h, h]), repeatReport([h, h])), /not a difference/);
  // the document gives the owner's command and it is a real one: the same flags as a cohort run, with the repeat
  const doc = readFileSync(new URL("../../../docs/society-repeat-run.md", import.meta.url), "utf8");
  assert.ok(doc.includes("npm run asp -- society cohort repeat --runs 2 --local --agents 15 --model claude-haiku-5-5 --api-key-env ANTHROPIC_API_KEY --budget-usd 0.40 --total-usd 6 --minutes 60 --arrivals staggered:5@30 --seed 1"));
  assert.ok(doc.includes("capped at USD 6 and the repeat at USD 12"));
});
