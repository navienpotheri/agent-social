// ENG57: a model mix in one cohort (for example claude-haiku-5-5 for most agents and one of another model) under the same caps, and a report that splits every figure by model: who stayed, what each wrote and in how many
// words, and what it cost as an estimate against the cap. Scripted agents on the engine path against a stand-in provider that records the model of each request; the caps hold; the key is in no file; verify passes.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { modelsReport, parseModels, renderModels } from "../src/cohort/models.ts";

const SECRET = "sk-ant-api03-FAKE-models-9876543210abcdef";
const P = "mcp__society__";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const filesUnder = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
const use = (name: string, input: Record<string, unknown> = {}, id = "t") => [{ type: "tool_use", id, name: P + name, input }];

async function provider(script: (r: { system: string; model: string; n: number }) => unknown[]) {
  const seen: { model: string; persona: string }[] = []; const counts: Record<string, number> = {};
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      const system = Array.isArray(body.system) ? body.system.map((b: { text?: string }) => b.text ?? "").join("") : String(body.system ?? "");
      const persona = /PERSON-([ABC])/.exec(system)![1]!;
      seen.push({ model: body.model, persona }); counts[persona] = (counts[persona] ?? 0) + 1;
      const content = script({ system, model: body.model, n: counts[persona]! });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 100 }, content }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
}
async function asp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-models-home-"));
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, MODELS_KEY: SECRET }, cwd: home } as Io);
  return { code, out: out.join("\n"), err: err.join("\n"), home };
}
const personas = () => { const d = mkdtempSync(join(tmpdir(), "asp-models-pers-")); const f = join(d, "p.txt"); writeFileSync(f, "You are PERSON-A.\n\nYou are PERSON-B.\n\nYou are PERSON-C.\n"); return f; };

test("two agents on claude-haiku-5-5 and one on claude-sonnet-5-5 in one society: each request carries its agent's model, the report splits every figure by model with the words said and the cost against the cap, and the caps, the key and verify hold", { timeout: 240_000 }, async () => {
  const p = await provider((r) => {
    const who = /PERSON-([ABC])/.exec(r.system)![1]!;
    if (r.n === 1) return use("forum_post", { title: `Hello from ${who}`, text: who === "C" ? "I would like to say something about what I found here today." : `Hi all, ${who} here.` });
    return use("leave", { reason: "done for now" });
  });
  const out = mkdtempSync(join(tmpdir(), "asp-models-out-"));
  const r = await asp(["society", "cohort", "--local", "--models", "claude-haiku-5-5:2,claude-sonnet-5-5:1", "--api-key-env", "MODELS_KEY", "--budget-usd", "0.40", "--total-usd", "1", "--provider-url", p.url, "--out", out, "--sim-speed", "100000", "--persona-file", personas()]);
  assert.equal(r.code, 0, r.err + r.out);
  const byPersona = (x: string) => [...new Set(p.seen.filter((s) => s.persona === x).map((s) => s.model))];
  assert.deepEqual(byPersona("A"), ["claude-haiku-5-5"]); assert.deepEqual(byPersona("B"), ["claude-haiku-5-5"]); assert.deepEqual(byPersona("C"), ["claude-sonnet-5-5"]);
  const dir = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!);
  const events = readFileSync(join(dir, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) as any[];
  assert.deepEqual(events.filter((e) => e.t === "agent").map((e) => [e.agent, e.model]), [["agent-01", "claude-haiku-5-5"], ["agent-02", "claude-haiku-5-5"], ["agent-03", "claude-sonnet-5-5"]]);
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /## One society, more than one model/);
  assert.match(md, /Each agent had one model for its whole life, under the same dollar cap\. A split of a few agents is a descriptive comparison of one run, not a result\. The cost is the estimate against the cap each agent was given, never a price\./);
  const m = JSON.parse(readFileSync(join(dir, "models.json"), "utf8")) as ReturnType<typeof modelsReport>;
  assert.equal(m.models["claude-haiku-5-5"]!.agents, 2); assert.equal(m.models["claude-sonnet-5-5"]!.agents, 1);
  assert.ok(m.models["claude-sonnet-5-5"]!.wordsPerWrite > m.models["claude-haiku-5-5"]!.wordsPerWrite * 2, "the words differ: " + JSON.stringify(events.filter((e) => e.t === "tool" && e.tool === "forum_post").map((e) => [e.agent, e.ok, e.refused])) + JSON.stringify([m.models["claude-sonnet-5-5"]!.words, m.models["claude-sonnet-5-5"]!.wordsPerWrite, m.models["claude-haiku-5-5"]!.words, m.models["claude-haiku-5-5"]!.wordsPerWrite]));
  assert.equal(m.models["claude-haiku-5-5"]!.capUsd, 0.8); assert.equal(m.models["claude-sonnet-5-5"]!.capUsd, 0.4, "the same cap for each agent");
  assert.ok(m.models["claude-haiku-5-5"]!.usd > 0 && m.models["claude-sonnet-5-5"]!.usd > 0);
  assert.ok(m.models["claude-sonnet-5-5"]!.usd / 1 > m.models["claude-haiku-5-5"]!.usd / 2, "one sonnet call costs more than one haiku call (the price table)");
  const eng = JSON.parse(readFileSync(join(dir, "engagement.json"), "utf8")) as { byModel: Record<string, { agents: number }> };
  assert.equal(eng.byModel["claude-haiku-5-5"]!.agents, 2);
  const eco = JSON.parse(readFileSync(join(dir, "economy.json"), "utf8")) as { byModel: Record<string, { calls: number }> };
  assert.ok(eco.byModel["claude-sonnet-5-5"]!.calls > 0);
  assert.equal((await asp(["society", "cohort", "verify", dir])).code, 0);
  for (const f of [...filesUnder(out), ...filesUnder(r.home)]) assert.ok(!readFileSync(f).includes(SECRET), `${f} holds the key`);
});

test("--models: the models make the agents, a disagreeing --agents or --kinds, a malformed list and a model the price table does not know are refused, and a mix works together with --kinds", async () => {
  assert.deepEqual(parseModels("claude-haiku-5-5:2,claude-sonnet-5-5:1"), ["claude-haiku-5-5", "claude-haiku-5-5", "claude-sonnet-5-5"]);
  assert.throws(() => parseModels("a:1,a:2"), /twice/);
  assert.throws(() => parseModels("claude-haiku-5-5"), /--models is a list/);
  assert.throws(() => parseModels("claude-haiku-5-5:0"), /at least one agent/);
  const common = ["society", "cohort", "--local", "--api-key-env", "MODELS_KEY", "--budget-usd", "0.4"];
  const a = await asp([...common, "--models", "claude-haiku-5-5:2", "--agents", "3"]);
  assert.equal(a.code, 2); assert.match(a.err, /--agents 3 and --models .* disagree/);
  const k = await asp([...common, "--models", "claude-haiku-5-5:2", "--kinds", "sponsored:3"]);
  assert.equal(k.code, 2); assert.match(k.err, /--kinds makes 3 agents and --models 2/);
  const u = await asp([...common, "--models", "claude-haiku-5-5:1,brand-new-model:1"]);
  assert.equal(u.code, 2); assert.match(u.err, /brand-new-model is not in the price table/);
  assert.equal(modelsReport([{ t: "agent", at: "x", agent: "a", did: "d", handle: "a" }] as never[], 0.4).models && Object.keys(modelsReport([{ t: "agent", at: "x", agent: "a", did: "d", handle: "a" }] as never[], 0.4).models).length, 0, "no models without the mix");
  assert.match(renderModels({ models: {}, note: "n" }), /One society, more than one model/);
});
