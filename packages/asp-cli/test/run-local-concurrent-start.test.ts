// Gap T3, found in the owner's real run (2026-11-22): two `asp run claude-code --local` started within a second on a fresh ASP_HOME each made their own local identities, so each made its own standing job (two jobs, one
// session each) instead of one job with two sessions. The first start now makes the identities and the other waits for them; a sequential start after that adopts the same job.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp, type Server } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const fake = fileURLToPath(new URL("./fake-claude-rehearsal.mjs", import.meta.url));
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function upstream() {
  const s = createHttp((req, res) => { req.on("data", () => undefined); req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 7 }, content: [{ type: "text", text: "done" }] })); }); });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}

test("two first-time --local starts at once make ONE set of identities and share ONE standing job (two sessions); a later start is session 3 of the same job", { timeout: 180_000 }, async () => {
  const up = await upstream();
  const f = makeFixture();
  const project = join(f.root, "project"); mkdirSync(project, { recursive: true }); mkdirSync(f.aspHome, { recursive: true });
  const go = async () => {
    const out: string[] = [], err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fake, ASP_RUN_ANTHROPIC_UPSTREAM: up, REHEARSAL_N: "1" }, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io;
    const code = await main(["run", "claude-code", "--local", "--prompt", "Say done", "--project", project], io);
    return { code, text: out.join("\n") + "\n" + err.join("\n") };
  };
  const [a, b] = await Promise.all([go(), go()]);
  assert.equal(a.code, 0, a.text); assert.equal(b.code, 0, b.text);
  const job = (t: string) => /standing job (sha256:[0-9a-f]{6,})/.exec(t)?.[1];
  assert.ok(job(a.text) && job(b.text), a.text + b.text);
  assert.equal(job(a.text), job(b.text), "both sessions are on the same standing job");
  const ids = JSON.parse(readFileSync(join(f.aspHome, "local", "local-identities.json"), "utf8"));
  assert.ok(ids.agent);
  const sessions = [a.text, b.text].map((t) => Number(/(\d+) session\(s\) so far/.exec(t)?.[1])).sort();
  assert.deepEqual(sessions, [1, 2], "the count covers both");
  const c = await go();
  assert.match(c.text, /standing job, session 3/);
});
