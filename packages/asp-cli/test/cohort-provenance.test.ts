// ENG70 in a cohort run: the report says exactly what the run was (alias, the provider's snapshot, response ids as hashes, what the run sent, the tool-definition hashes, the size of the thinking, and what it still cannot
// tell you), the trace and each signed Action carry the hashes, the hidden thinking text and the key are in no file, and the report names a changed snapshot and a changed tool definition. Stand-in provider; fake key.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { provenanceOf, renderProvenance } from "../src/cohort/provenance.ts";

const SECRET = "sk-ant-api03-FAKE-prov-9876543210abcdef";
const HIDDEN = "HIDDEN-THINKING-TEXT-NEVER-KEPT";
const P = "mcp__society__";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const filesUnder = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });

async function provider() {
  let n = 0;
  const s = createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (!/\/v1\/messages$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
      n++;
      const tool = n === 1 ? { name: "look_charters", input: {} } : n === 2 ? { name: "my_balance", input: {} } : { name: "leave", input: { reason: "done" } };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `msg_${n}_raw`, type: "message", role: "assistant", model: "claude-haiku-5-5-20261101", stop_reason: "tool_use", usage: { input_tokens: 700, output_tokens: 50 }, content: [{ type: "thinking", thinking: `${HIDDEN} ${n}`, signature: "s" }, { type: "tool_use", id: `t${n}`, name: P + tool.name, input: tool.input }] }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
async function asp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "asp-prov-home-"));
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, PROV_KEY: SECRET }, cwd: home } as Io);
  return { code, out: out.join("\n"), err: err.join("\n"), home };
}

test("a cohort run records its provenance: the report section, provenance.json, the trace's hashes, a hash in each signed Action, no hidden thinking text and no key in any file, and verify passes", { timeout: 240_000 }, async () => {
  const url = await provider();
  const out = mkdtempSync(join(tmpdir(), "asp-prov-out-"));
  const r = await asp(["society", "cohort", "--local", "--agents", "1", "--model", "claude-haiku-5-5", "--api-key-env", "PROV_KEY", "--budget-usd", "0.40", "--provider-url", url, "--out", out, "--sim-speed", "100000"]);
  assert.equal(r.code, 0, r.err + r.out);
  const dir = join(out, readdirSync(out).find((x) => x.startsWith("cohort-"))!);
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /## What this run was, exactly \(provenance\)/);
  assert.match(md, /Model asked for \(alias\):\*\* claude-haiku-5-5\./);
  assert.match(md, /snapshot\):\*\* claude-haiku-5-5-20261101 \(\d+ turns?\)\. Response ids: \d+ distinct, kept only as hashes/);
  assert.match(md, /What the run sent:\*\* max_tokens 1024; temperature not sent \(the provider's default\); top_p not sent; top_k not sent; thinking not sent \(the model's own default\)/);
  assert.match(md, /Tool definitions offered each turn:\*\* 1 distinct hash over \d+ turns/);
  assert.match(md, /Thinking returned:\*\* \d+ of \d+ turns carried thinking .*sizes only, never the hidden text/);
  assert.match(md, /Changes noticed during the run:\*\* none/);
  assert.match(md, /What this still cannot tell you:/);
  assert.match(md, /the provider's own internal version behind a snapshot name/);
  const pv = JSON.parse(readFileSync(join(dir, "provenance.json"), "utf8")) as ReturnType<typeof provenanceOf>;
  assert.deepEqual(Object.keys(pv.snapshots), ["claude-haiku-5-5-20261101"]); assert.equal(pv.responseIdHashes, 4, "one hash for each of the four replies (the second leave confirms the first)");
  const events = readFileSync(join(dir, "trace.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) as any[];
  assert.equal(events.find((e) => e.t === "provenance").settings.max_tokens, 1024);
  const models = events.filter((e) => e.t === "model");
  assert.ok(models.every((m) => m.snapshot === "claude-haiku-5-5-20261101" && m.idHash.length === 16 && m.toolsHash.length === 16 && m.thinkingBlocks === 1 && m.thinkingChars > HIDDEN.length));
  // the signed Actions carry the hashes: the summary of each Action in the run's own log
  const log = readFileSync(join(dir, "society", "log", "log.ndjson"), "utf8");
  const withProv = [...log.matchAll(/summary":"n=\d+ turn=\d+ tool=\w+[^"]*prov=([\w.:-]+)/g)].map((m) => m[1]!);
  assert.ok(withProv.length >= 3, `${withProv.length} signed Actions carry prov=`);
  assert.ok(withProv.every((x) => /^[0-9a-f]{8}\.[0-9a-f]{8}$/.test(x)), withProv.join());
  assert.equal((await asp(["society", "cohort", "verify", dir])).code, 0);
  for (const f of [...filesUnder(out), ...filesUnder(r.home)]) { const b = readFileSync(f); assert.ok(!b.includes(SECRET), `${f} holds the key`); assert.ok(!b.includes(HIDDEN), `${f} holds the hidden thinking`); assert.ok(!b.includes("msg_1_raw"), `${f} holds a raw response id`); }
});

test("the report names a changed snapshot and a changed tool definition, with the turn and the agent, and says the snapshot changed during the run", () => {
  const ev = [
    { t: "provenance", at: "x", model: "claude-haiku-5-5", settings: { max_tokens: 1024, thinking: "not sent (the model's own default)" } },
    { t: "model", at: "x", agent: "agent-01", turn: 1, input: 1, output: 1, usd: 0, snapshot: "snap-a", idHash: "1111111111111111", toolsHash: "aaaaaaaaaaaaaaaa", thinkingBlocks: 1, thinkingChars: 120 },
    { t: "model", at: "x", agent: "agent-01", turn: 2, input: 1, output: 1, usd: 0, snapshot: "snap-b", idHash: "2222222222222222", toolsHash: "bbbbbbbbbbbbbbbb", thinkingBlocks: 2, thinkingChars: 300 },
    { t: "provenance_change", at: "x", agent: "agent-01", turn: 2, what: "model_snapshot", name: "claude-haiku-5-5", from: "snap-a", to: "snap-b" },
    { t: "provenance_change", at: "x", agent: "agent-01", turn: 2, what: "tool_definition", name: "forum_post", from: "d1d1d1d1d1d1d1d1", to: "d2d2d2d2d2d2d2d2" },
  ] as never[];
  const r = provenanceOf(ev);
  assert.deepEqual(r.snapshots, { "snap-a": 1, "snap-b": 1 }); assert.equal(r.responseIdHashes, 2);
  assert.deepEqual(r.thinking, { turnsWithThinking: 2, blocks: 3, medianChars: 210, maxChars: 300, totalChars: 420 });
  const md = renderProvenance(r);
  assert.match(md, /the snapshot changed during the run/);
  assert.match(md, /turn 2 of agent-01: model snapshot claude-haiku-5-5 from snap-a to snap-b/);
  assert.match(md, /turn 2 of agent-01: tool definition forum_post from d1d1d1d1d1d1d1d1 to d2d2d2d2d2d2d2d2/);
  assert.match(md, /2 distinct hashes over 2 turns/);
  assert.match(renderProvenance(provenanceOf([] as never[])), /Changes noticed during the run:\*\* none/);
});
