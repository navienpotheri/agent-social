// ENG78: refusals written back into the agent's memory. After a refusal the engine appends ONE labelled line to the notebook of the agents in the writeback arm (a random half, from a seed; the rest are the control on the
// same society), with no model call. Stand-in agents: one that obeys the line (the repeat share falls in its arm), one that ignores it (no change), the split reproducible from the seed, the line holding only the society's
// words (no key, no quoted text), and the notebook cap. Fake key; credits are accounting entries.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Life, SimClock, adviceFor, applyRefusalLine, assignArms, cleanReason, refusalLine, SOCIETY_TAG, MAX_SOCIETY_LINES } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { renderWriteback, writebackReport } from "../src/cohort/writeback-report.ts";

const SECRET = "sk-ant-api03-FAKE-writeback-9876543210abcdef";
const P = "mcp__society__";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const filesUnder = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
const use = (name: string, input: Record<string, unknown> = {}, id = "t") => [{ type: "tool_use", id, name: P + name, input }];
type Req = { system: string; last: string; n: number };
async function provider(script: (r: Req) => unknown[]) {
  const counts: Record<string, number> = {};
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const msgs = body.messages ?? [];
      const lm = msgs[msgs.length - 1];
      const last = typeof lm?.content === "string" ? lm.content : JSON.stringify(lm?.content ?? "");
      const system = Array.isArray(body.system) ? body.system.map((b: { text?: string }) => b.text ?? "").join("") : String(body.system ?? "");
      const who = /PERSON-([ABCD])/.exec(system)?.[1] ?? "?";
      counts[who] = (counts[who] ?? 0) + 1;
      const content = script({ system, last, n: counts[who]! });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 700, output_tokens: 50 }, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
async function asp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-wb-home-"));
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, WB_KEY: SECRET }, cwd: home } as Io);
  return { code, out: out.join("\n"), err: err.join("\n"), home };
}
const personas = () => { const d = mkdtempSync(join(tmpdir(), "asp-wb-pers-")); const f = join(d, "p.txt"); writeFileSync(f, "You are PERSON-A.\n\nYou are PERSON-B.\n\nYou are PERSON-C.\n\nYou are PERSON-D.\n"); return f; };
const run = async (url: string, extra: string[]) => {
  const out = mkdtempSync(join(tmpdir(), "asp-wb-out-"));
  const r = await asp(["society", "cohort", "--local", "--agents", "4", "--model", "claude-haiku-5-5", "--api-key-env", "WB_KEY", "--budget-usd", "0.40", "--provider-url", url, "--out", out, "--sim-speed", "100000", "--persona-file", personas(), "--seed", "7", ...extra]);
  const dir = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!);
  const events = readFileSync(join(dir, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) as any[];
  return { r, dir, out, events };
};
const TOO_LONG = "x".repeat(6000);

test("agents that obey the line: the half that got it do not repeat the refusal, the control does, and the report shows the arms; the line is in the notebook with the society's words and its own count", { timeout: 240_000 }, async () => {
  const url = await provider((r) => {
    if (r.n === 1) return use("forum_post", { title: "Hello", text: TOO_LONG });            // refused: bad_input
    if (r.n === 2) return use("notebook_read");
    if (r.n === 3) return /From the society/.test(r.last) ? use("forum_post", { title: `Hello ${/PERSON-(\w)/.exec(r.system)![1]}`, text: "A short hello." }) : use("forum_post", { title: "Hello", text: TOO_LONG });   // obeys if it sees the line
    return use("leave", { reason: "done for now" });
  });
  const { r, dir, out, events } = await run(url, ["--writeback=half"]);
  assert.equal(r.code, 0, r.err + r.out);
  const armOf = new Map(events.filter((e) => e.t === "agent").map((e) => [e.agent, e.arm]));
  assert.equal([...armOf.values()].filter((a) => a === "writeback").length, 2, "exactly half got the line");
  assert.equal([...armOf.values()].filter((a) => a === "control").length, 2);
  const wr = JSON.parse(readFileSync(join(dir, "writeback.json"), "utf8")) as ReturnType<typeof writebackReport>;
  assert.equal(wr.arms.writeback!.agents, 2); assert.equal(wr.arms.control!.agents, 2);
  assert.equal(wr.arms.writeback!.refusals, 2, "one refusal each, then they obeyed"); assert.equal(wr.arms.writeback!.repeats, 0); assert.equal(wr.arms.writeback!.repeatShare, 0);
  assert.equal(wr.arms.control!.refusals, 4, "the control met the rule twice"); assert.equal(wr.arms.control!.repeats, 2); assert.equal(wr.arms.control!.repeatShare, 0.5);
  assert.equal(wr.arms.control!.agentsWithRepeat, 2); assert.equal(wr.arms.writeback!.agentsWithRepeat, 0);
  assert.ok(wr.arms.writeback!.addedTokensPerAgent > 0 && wr.arms.control!.addedTokensPerAgent === 0, "the lines cost the tokens they were shown for; the control none");
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /## Refusals written back to memory/);
  assert.match(md, /One run is one draw.*spread between repeat runs \(ENG72\) is not a difference/);
  assert.match(md, /Refusals that repeat a rule the same agent already met \| 0 \(0%\) \| 2 \(50%\)/);
  // the notebooks: the line in the arm that got it, none in the control; the line says it can be deleted, names the rule and what to do instead, and holds no text of anyone's
  for (const id of ["agent-01", "agent-02", "agent-03", "agent-04"]) {
    const nb = (() => { try { return readFileSync(join(dir, "notebooks", `${id}.md`), "utf8"); } catch { return ""; } })();
    if (armOf.get(id) === "writeback") {
      assert.match(nb, /^From the society \(you can keep or delete this line\): forum_post was refused \(bad_input\): .* Instead: check the arguments against the tool's description/m, id);
      assert.ok(!nb.includes("xxxxxxxx") && !nb.includes(SECRET), "no agent text and no key in the line");
      assert.ok(nb.split("\n").every((l) => l.length <= 520));
    } else assert.ok(!/From the society/.test(nb), `${id} is in the control: no line`);
  }
  const wbEvents = events.filter((e) => e.t === "writeback");
  assert.equal(wbEvents.length, 2); assert.ok(wbEvents.every((e) => e.rule === "bad_input" && e.action === "added" && armOf.get(e.agent) === "writeback"));
  assert.equal((await asp(["society", "cohort", "verify", dir])).code, 0);
  for (const f of [...filesUnder(out), ...filesUnder(r.home)]) assert.ok(!readFileSync(f).includes(SECRET), `${f} holds the key`);
});

test("agents that ignore the line: both arms repeat alike (no change), the line's count goes up in the arm that got it, and the report does not call a difference where there is none", { timeout: 240_000 }, async () => {
  const url = await provider((r) => {
    if (r.n <= 3) return use("forum_post", { title: "Hello", text: TOO_LONG });             // refused three times whatever the notebook says
    return use("leave", { reason: "done for now" });
  });
  const { r, dir, events } = await run(url, ["--writeback=half"]);
  assert.equal(r.code, 0, r.err + r.out);
  const wr = JSON.parse(readFileSync(join(dir, "writeback.json"), "utf8")) as ReturnType<typeof writebackReport>;
  assert.equal(wr.arms.writeback!.repeatShare, wr.arms.control!.repeatShare, "the same share in both arms");
  assert.equal(wr.arms.writeback!.repeats, 4); assert.equal(wr.arms.control!.repeats, 4);
  assert.match(wr.difference, /The repeat share was 67% \(4 of 6\) in the arm that got the lines and 67% \(4 of 6\) in the control/);
  const armOf = new Map(events.filter((e) => e.t === "agent").map((e) => [e.agent, e.arm]));
  const treated = [...armOf].find(([, a]) => a === "writeback")![0];
  const nb = readFileSync(join(dir, "notebooks", `${treated}.md`), "utf8");
  assert.equal(nb.split("\n").filter((l) => l.startsWith(SOCIETY_TAG)).length, 1, "one line for the rule, with a count");
  assert.match(nb, /forum_post was refused \(bad_input\), 3 times now:/);
  assert.deepEqual(events.filter((e) => e.t === "writeback" && e.agent === treated).map((e) => e.action), ["added", "updated", "updated"]);
});

test("--writeback on its own gives every agent the line, no control; a bad value, or a run without ticks, is refused", async () => {
  const url = await provider((r) => (r.n === 1 ? use("forum_post", { title: "Hello", text: TOO_LONG }) : use("leave", { reason: "done" })));
  const { r, events } = await run(url, ["--writeback"]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.ok(events.filter((e) => e.t === "agent").every((e) => e.arm === "writeback"));
  const bad = await asp(["society", "cohort", "--local", "--agents", "2", "--model", "claude-haiku-5-5", "--api-key-env", "WB_KEY", "--budget-usd", "0.4", "--writeback=third"]);
  assert.equal(bad.code, 2); assert.match(bad.err, /--writeback is on its own/);
  const stand = await asp(["society", "cohort", "--local", "--provider", "stand-in", "--agents", "2", "--budget-usd", "1", "--writeback"]);
  assert.equal(stand.code, 2); assert.match(stand.err, /needs a real-model run/);
});

test("the arm split is reproducible from the seed: exactly half, the same for the same seed, different for another, and the same whatever the order the ids come in", () => {
  const ids = Array.from({ length: 15 }, (_, i) => `agent-${String(i + 1).padStart(2, "0")}`);
  const a = assignArms(ids, 7, "half"), b = assignArms(ids, 7, "half"), c = assignArms(ids, 8, "half");
  assert.deepEqual([...a], [...b]);
  assert.equal([...a.values()].filter((x) => x === "writeback").length, 7, "floor of half of 15");
  assert.notDeepEqual([...a], [...c], "another seed, another split");
  const shuffled = assignArms([...ids].reverse(), 7, "half");
  assert.deepEqual(ids.map((i) => a.get(i)), ids.map((i) => shuffled.get(i)), "the split of an agent does not depend on the order");
  assert.equal([...assignArms(ids, 1, "all").values()].every((x) => x === "writeback"), true);
});

test("the line holds only the society's words: the rule's prefix, anything quoted, anything in backticks and a key-shaped string are taken out, and it is cut to about 200 characters; one line for each rule with a count", () => {
  const reason = `Refused (forum_DUPLICATE): the forum refused it: you already wrote "hello from agent-02, my secret plan" and \`some code\` with ${SECRET} in it. ${"More words about it. ".repeat(30)}`;
  const line = refusalLine({ tool: "forum_post", rule: "forum_DUPLICATE", reason, count: 2 });
  assert.ok(!line.includes(SECRET) && !line.includes("hello from agent-02") && !line.includes("some code") && !line.includes("Refused ("), line);
  assert.match(line, /^From the society \(you can keep or delete this line\): forum_post was refused \(forum_DUPLICATE\), 2 times now: the forum refused it/);
  assert.match(line, /Instead: write something new, shorter or after reading first/);
  assert.ok(cleanReason(reason).length <= 203, "about 200 characters");
  assert.equal(cleanReason("Refused (x): \"all quoted\""), "the society did not allow it");
  assert.match(adviceFor("something_new"), /resting is always allowed/);
});

test("the notebook cap holds: the society's lines are few (the oldest go first), the agent's own notes are never cut, a line that cannot fit is skipped, and a deleted line comes back with the count when the rule is met again", () => {
  const own = "my own notes: " + "n".repeat(300);
  let nb = own;
  for (let i = 0; i < 9; i++) nb = applyRefusalLine(nb, `rule_${i}`, refusalLine({ tool: "t", rule: `rule_${i}`, reason: "no", count: 1 }), 4000)!;
  const lines = nb.split("\n");
  assert.equal(lines.filter((l) => l.startsWith(SOCIETY_TAG)).length, MAX_SOCIETY_LINES, "at most six lines");
  assert.ok(lines[0] === own, "the agent's own note is untouched");
  assert.ok(!nb.includes("rule_0") && nb.includes("rule_8"), "the oldest went, the newest stayed");
  // a cap that the agent's own notes nearly fill
  const tight = applyRefusalLine("o".repeat(3900), "r", refusalLine({ tool: "t", rule: "r", reason: "a reason of some length for the line", count: 1 }), 4000);
  assert.equal(tight, undefined, "no room: skipped, the notes are not cut");
  // through the engine: a deleted line comes back with the count
  let real = 0;
  const clock = new SimClock({ speed: 1000, now: () => real });
  const life = new Life({ clock, notebookDir: mkdtempSync(join(tmpdir(), "asp-wb-nb-")), sleep: async (ms) => { real += ms; } });
  const a = life.agent("a");
  const ctx = { agent: "a", turn: 1, now: () => "t", signal: new AbortController().signal };
  assert.equal(a.writeback({ tool: "forum_post", rule: "bad_input", reason: "text is too long" }), "added");
  a.tools().find((t) => t.name === "notebook_write")!.run({ text: "I deleted it", mode: "replace" }, ctx);
  assert.equal(a.writeback({ tool: "forum_post", rule: "bad_input", reason: "text is too long" }), "added", "the agent deleted the line: it is added again");
  assert.match(a.notebookText(), /I deleted it\nFrom the society .*\(bad_input\), 2 times now/s);
  assert.deepEqual(a.writebackStats().rules, { bad_input: 2 });
});

test("the writeback report: the repeat share is the share of refusals that repeat a rule the same agent already met, counted for each arm; one arm alone says there is nothing to compare", () => {
  const ag = (a: string, arm: string) => ({ t: "agent", at: "2026-11-22T10:00:00Z", agent: a, did: `d${a}`, handle: a, arm });
  const ref = (a: string, rule: string) => ({ t: "tool", at: "2026-11-22T10:30:00Z", agent: a, turn: 1, tool: "forum_post", input: {}, ok: false, refused: rule, chars: 1, institution: "forum", scope: "s", writes: true, ms: 1 });
  const ev = [ag("a", "writeback"), ag("b", "control"), ref("a", "bad_input"), ref("a", "market_refused"), ref("b", "bad_input"), ref("b", "bad_input"), ref("b", "bad_input"), ref("b", "market_refused")] as never[];
  const r = writebackReport(ev);
  assert.deepEqual([r.arms.writeback!.refusals, r.arms.writeback!.repeats], [2, 0]);
  assert.deepEqual([r.arms.control!.refusals, r.arms.control!.repeats, r.arms.control!.repeatShare], [4, 2, 0.5]);
  assert.match(renderWriteback(r), /Refusals that repeat a rule the same agent already met \| 0 \(0%\) \| 2 \(50%\)/);
  assert.equal(writebackReport([ag("a", "writeback")] as never[]).difference, "Only one arm was in this run: there is nothing to compare.");
});

test("the command of docs/society-writeback-run.md runs (against a stand-in provider, a fast simulated clock and a short turn limit), splits the 15 agents 7 and 8, and verifies", { timeout: 240_000 }, async () => {
  const doc = readFileSync(new URL("../../../docs/society-writeback-run.md", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
  const lines = doc.split("```powershell" + String.fromCharCode(10)).slice(1).flatMap((b) => b.split("```")[0]!.split(String.fromCharCode(10))).filter((l) => l.startsWith("npm run asp -- society cohort --local"));
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes("--writeback=half --seed 1") && lines[0]!.includes("--budget-usd 0.40 --total-usd 6") && lines[0]!.includes("--agents 15"));
  const url = await provider(() => use("look_charters"));
  const out = mkdtempSync(join(tmpdir(), "asp-wb-doc-"));
  const r = await asp([...lines[0]!.slice("npm run asp -- ".length).split(" ").filter(Boolean).map((w) => (w === "ANTHROPIC_API_KEY" ? "WB_KEY" : w)), "--out", out, "--provider-url", url, "--sim-speed", "100000", "--max-turns", "3"]);
  assert.equal(r.code, 0, r.err + r.out);
  const dir = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!);
  const wr = JSON.parse(readFileSync(join(dir, "writeback.json"), "utf8")) as ReturnType<typeof writebackReport>;
  assert.deepEqual([wr.arms.writeback!.agents, wr.arms.control!.agents], [7, 8]);
  assert.equal((await asp(["society", "cohort", "verify", dir])).code, 0);
});
