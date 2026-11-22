// ENG50: sponsored agents (each with a sponsor identity of its own) and key-only agents (which name themselves as their own sponsor) in ONE local society, and a report that splits every figure by kind: who stayed, who wrote,
// credits at the start and earned, calls refused and by which rule, and the messages, comments and votes that went between kinds, with whether either kind was refused more. Scripted agents on the engine path against a
// stand-in provider; the signed trace and `asp society cohort verify` as before; the key in no file. Fake key; credits are accounting entries.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { kindsReport, parseKinds, renderKinds } from "../src/cohort/kinds.ts";

const SECRET = "sk-ant-api03-FAKE-kinds-9876543210abcdef";
const P = "mcp__society__";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const filesUnder = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
const use = (name: string, input: Record<string, unknown> = {}, id = "t") => [{ type: "tool_use", id, name: P + name, input }];
type Req = { system: string; last: string };
async function provider(script: (r: Req) => unknown[]) {
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const msgs = body.messages ?? [];
      const lm = msgs[msgs.length - 1];
      const last = typeof lm?.content === "string" ? lm.content : JSON.stringify(lm?.content ?? "");
      const system = Array.isArray(body.system) ? body.system.map((b: { text?: string }) => b.text ?? "").join("") : String(body.system ?? "");
      const content = script({ system, last });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 700, output_tokens: 50 }, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
async function asp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-kinds-home-"));
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, KINDS_KEY: SECRET }, cwd: home } as Io);
  return { code, out: out.join("\n"), err: err.join("\n"), home };
}
const personas = () => { const d = mkdtempSync(join(tmpdir(), "asp-kinds-pers-")); const f = join(d, "p.txt"); writeFileSync(f, "You are PERSON-A.\n\nYou are PERSON-B.\n\nYou are PERSON-C.\n\nYou are PERSON-D.\n"); return f; };
const idOf = (text: string, title: string) => { const t = text.replace(/\\"/g, '"'); const m = new RegExp(`"id":"([^"]+)"[^{}]*?"title":"${title}"|"title":"${title}"[^{}]*?"id":"([^"]+)"`).exec(t); return m?.[1] ?? m?.[2]; };

test("two sponsored and two key-only agents in one society: sponsor identities of their own against self-sponsors, the report split by kind with the messages and comments between kinds and the refusals by rule, the split in the json files, and the run verifies with the key in no file", { timeout: 240_000 }, async () => {
  const calls: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  const url = await provider((r) => {
    const w = /PERSON-([ABCD])/.exec(r.system)![1]!;
    const n = ++calls[w]!;
    const wake = /You waited/.test(r.last);
    if (w === "A") {                                           // sponsored: posts, waits, comments on C's post, writes to C, leaves
      if (n === 1) return use("forum_post", { title: "From A", text: "I am A, sponsored." });
      if (n === 2) return use("rest", { until: "3h" });
      if (n === 3) return use("forum_read", { sort: "new" });
      if (n === 4) return use("forum_comment", { post: idOf(r.last, "From C") ?? "missing", text: "Hello C, from A." });
      if (n === 5) return use("send_message", { to: "agent-03", kind: "reply", text: "Hello C: A here." });
    }
    if (w === "B") {                                           // sponsored: comments on D's post
      if (n === 1) return use("rest", { until: "3h" });
      if (n === 2) return use("forum_read", { sort: "new" });
      if (n === 3) return use("forum_comment", { post: idOf(r.last, "From D") ?? "missing", text: "Hello D, from B." });
    }
    if (w === "C") {                                           // key-only: posts, comments on A's post, writes to A
      if (n === 1) return use("forum_post", { title: "From C", text: "I am C, key-only." });
      if (n === 2) return use("rest", { until: "3h" });
      if (n === 3) return use("forum_read", { sort: "new" });
      if (n === 4) return use("forum_comment", { post: idOf(r.last, "From A") ?? "missing", text: "Hello A, from C." });
      if (n === 5) return use("send_message", { to: "agent-01", kind: "note", text: "Hello A: C here." });
    }
    if (w === "D") {                                           // key-only: posts, is refused once for a text that is too long
      if (n === 1) return use("forum_post", { title: "From D", text: "x".repeat(6000) });
      if (n === 2) return use("forum_post", { title: "From D", text: "I am D, key-only." });
    }
    if (wake) return use("do_nothing");
    return use("leave", { reason: "I have seen enough for now" });
  });
  const out = mkdtempSync(join(tmpdir(), "asp-kinds-out-"));
  const r = await asp(["society", "cohort", "--local", "--kinds", "sponsored:2,key-only:2", "--model", "claude-haiku-5-5", "--api-key-env", "KINDS_KEY", "--budget-usd", "0.40", "--provider-url", url, "--out", out, "--sim-speed", "100000", "--persona-file", personas(), "--engaged-minutes", "10000"]);
  assert.equal(r.code, 0, r.err + r.out);
  const dir = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!);
  const events = readFileSync(join(dir, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) as any[];
  const agentEv = events.filter((e) => e.t === "agent");
  assert.deepEqual(agentEv.map((e) => [e.agent, e.kind]), [["agent-01", "sponsored"], ["agent-02", "sponsored"], ["agent-03", "key-only"], ["agent-04", "key-only"]]);

  // the signed trace: a sponsor of its own for each sponsored agent, the agent itself for a key-only one
  const st = JSON.parse(readFileSync(join(dir, "signed-trace.json"), "utf8")) as { sponsors: string[]; agents: { agent: string; did: string; sponsor: string }[] };
  assert.equal(st.sponsors.length, 4, "an identity of its own for every agent's contract and Mandate");
  for (const a of st.agents.filter((x) => ["agent-01", "agent-02"].includes(x.agent))) assert.notEqual(a.sponsor, a.did, `${a.agent} has a sponsor of its own`);
  assert.equal(new Set(st.agents.filter((x) => ["agent-01", "agent-02"].includes(x.agent)).map((a) => a.sponsor)).size, 2, "the two sponsored agents have different sponsors");

  // the report, split by kind
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /## Sponsored and key-only agents side by side/);
  assert.match(md, /A split of this size is a descriptive comparison of one run, not a result\./);
  assert.match(md, /\| Agents \| 2 \| 2 \|/);
  assert.match(md, /Messages between kinds:\*\* .*sponsored -> key-only 1.*|Messages between kinds:\*\* .*key-only -> sponsored 1/);
  const k = JSON.parse(readFileSync(join(dir, "kinds.json"), "utf8")) as ReturnType<typeof kindsReport>;
  assert.equal(k.between.messages["sponsored -> key-only"], 1); assert.equal(k.between.messages["key-only -> sponsored"], 1);
  assert.equal(k.between.comments["sponsored -> key-only"], 2, "A commented on C's post and B on D's"); assert.equal(k.between.comments["key-only -> sponsored"], 1, "C commented on A's post");
  assert.equal(k.between.comments["sponsored -> sponsored"] ?? 0, 0);
  assert.equal(k.kinds["key-only"]!.refused, 1, "D was refused once");
  assert.deepEqual(k.kinds["key-only"]!.refusedByRule, { bad_input: 1 });
  assert.equal(k.kinds.sponsored!.refused, 0);
  assert.match(k.fairness, /Neither kind was clearly refused more/);
  assert.ok(k.kinds.sponsored!.startCredits.length === 2 && k.kinds["key-only"]!.startCredits.length === 2, "the credits each kind started with are recorded");
  assert.match(md, /Credits at the start \(each agent\) \| \d+ \| \d+ \|/);
  const eng = JSON.parse(readFileSync(join(dir, "engagement.json"), "utf8")) as { byKind: Record<string, { agents: number }>; agents: number };
  assert.equal(eng.agents, 4); assert.equal(eng.byKind.sponsored!.agents, 2); assert.equal(eng.byKind["key-only"]!.agents, 2);
  const eco = JSON.parse(readFileSync(join(dir, "economy.json"), "utf8")) as { byKind: Record<string, { calls: number }> };
  assert.ok(eco.byKind.sponsored!.calls > 0 && eco.byKind["key-only"]!.calls > 0);
  // verify, and the key
  const v = await asp(["society", "cohort", "verify", dir]);
  assert.equal(v.code, 0, v.out + v.err);
  for (const f of [...filesUnder(out), ...filesUnder(r.home)]) assert.ok(!readFileSync(f).includes(SECRET), `${f} holds the key`);
});

test("--kinds: the kinds make the agents (the sponsored first), a disagreeing --agents or a malformed list is refused, and a run without --kinds has no split", async () => {
  assert.deepEqual(parseKinds("key-only:2,sponsored:3"), ["sponsored", "sponsored", "sponsored", "key-only", "key-only"]);
  assert.throws(() => parseKinds("sponsored:2,sponsored:3"), /twice/);
  assert.throws(() => parseKinds("sponsored"), /--kinds is a list/);
  assert.throws(() => parseKinds("sponsored:0"), /at least one agent/);
  assert.throws(() => parseKinds("sponsored:40,key-only:20"), /at most 50/);
  const disagree = await asp(["society", "cohort", "--local", "--kinds", "sponsored:2,key-only:1", "--agents", "5", "--model", "claude-haiku-5-5", "--api-key-env", "KINDS_KEY", "--budget-usd", "0.4"]);
  assert.equal(disagree.code, 2); assert.match(disagree.err, /--agents 5 and --kinds .* disagree/);
  const bad = await asp(["society", "cohort", "--local", "--kinds", "sponsored", "--model", "claude-haiku-5-5", "--api-key-env", "KINDS_KEY", "--budget-usd", "0.4"]);
  assert.equal(bad.code, 2);
  assert.equal(kindsReport([{ t: "agent", at: "x", agent: "a", did: "d", handle: "a" }] as never[]).fairness, "Only one kind was in this run: there is nothing to compare.");
});

test("fairness: a kind refused clearly more is named with the rules that made the difference; similar shares are not called a difference", () => {
  const ag = (a: string, kind: string) => ({ t: "agent", at: "x", agent: a, did: `did:${a}`, handle: a, kind });
  const call = (a: string, ok: boolean, rule?: string) => ({ t: "tool", at: "x", agent: a, turn: 1, tool: "forum_post", input: {}, ok, ...(rule ? { refused: rule } : {}), chars: 1, institution: "forum", scope: "s", writes: true, ms: 1 });
  const base = [ag("s1", "sponsored"), ag("k1", "key-only")];
  const similar = [...base, ...Array.from({ length: 20 }, () => call("s1", true)), ...Array.from({ length: 3 }, () => call("s1", false, "bad_input")), ...Array.from({ length: 20 }, () => call("k1", true)), ...Array.from({ length: 3 }, () => call("k1", false, "bad_input"))] as never[];
  assert.match(kindsReport(similar).fairness, /Neither kind was clearly refused more/);
  const unequal = [...base, ...Array.from({ length: 20 }, () => call("s1", true)), ...Array.from({ length: 10 }, () => call("k1", true)), ...Array.from({ length: 8 }, () => call("k1", false, "newcomer_bond")), call("s1", false, "bad_input")] as never[];
  const r = kindsReport(unequal);
  assert.match(r.fairness, /The key-only agents were refused more often than the sponsored agents/);
  assert.match(r.fairness, /newcomer_bond \(8 against 0\)/);
  assert.match(renderKinds(r), /Was either kind treated worse\?\*\* The key-only agents were refused more often/);
});

test("the commands of docs/society-kinds-run.md run (against a stand-in provider, with a fast simulated clock and a short turn limit) and write the reports the document says they write", { timeout: 240_000 }, async () => {
  const doc = readFileSync(new URL("../../../docs/society-kinds-run.md", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
  const blocks = doc.split("```powershell" + String.fromCharCode(10)).slice(1).map((b) => b.split("```")[0]!);
  const lines = blocks.flatMap((b) => b.split(String.fromCharCode(10))).filter((l) => l.startsWith("npm run asp -- society cohort "));
  const real = lines.filter((l) => !/ cohort (plan|verify) /.test(l));
  assert.equal(real.length, 2, "the ten and five run and the model mix");
  assert.ok(real[0]!.includes("--kinds sponsored:10,key-only:5") && real[0]!.includes("--budget-usd 0.40 --total-usd 6"), "the owner's run: 10 sponsored, 5 key-only, the caps");
  assert.ok(real[1]!.includes("--models claude-haiku-5-5:13,claude-sonnet-5-5:2"));
  const url = await provider(() => use("look_charters"));
  const words = (l: string) => l.slice("npm run asp -- ".length).split(" ").filter(Boolean).map((w) => (w === "ANTHROPIC_API_KEY" ? "KINDS_KEY" : w));
  const plan = await asp(words(lines.find((l) => l.includes(" cohort plan "))!));
  assert.equal(plan.code, 0, plan.err);
  assert.match(plan.out, /15 agents: expected about .*worst case [$]6[.]00/);
  for (const [i, cmd] of real.entries()) {
    const out = mkdtempSync(join(tmpdir(), "asp-kinds-doc-"));
    const r = await asp([...words(cmd), "--out", out, "--provider-url", url, "--sim-speed", "100000", "--max-turns", "3"]);
    assert.equal(r.code, 0, `${cmd}: ${r.err}${r.out}`);
    const dir = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    assert.ok(i === 0 ? md.includes("## Sponsored and key-only agents side by side") && md.includes("| Agents | 10 | 5 |") : md.includes("## One society, more than one model") && md.includes("| Agents | 13 | 2 |"));
    assert.equal((await asp(["society", "cohort", "verify", dir])).code, 0);
  }
});
