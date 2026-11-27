import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttp } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, ownPort } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));

// UC-225, gap T13: a person comes back after the standing job has run out. The clock is not moved; the job's recorded expiry is rewritten to the past, which is what the check reads.
test("coming back after the standing job ran out: asp run makes a new job, says so and why, and the next session reuses it", { timeout: 120_000 }, async () => {
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: "Done." }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-returning-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "rt", role: "tenant", tokenSha256: hashToken("tok-rt") }]));
  const port = await ownPort();
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--did-domain", `127.0.0.1:${port}`, "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const me = `did:web:127.0.0.1%3A${port}:u:rt`, agent = `did:web:127.0.0.1%3A${port}:a:rt:my-agent`, bank = `did:web:127.0.0.1%3A${port}:u:rt:bank`;
    writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: `http://127.0.0.1:${port}`, token: "tok-rt", tenant: "rt", joinedAt: "2026-10-11T00:00:00Z", identities: { me, agent, bank } }));
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ASP_GATEWAY_POLL_MS: "300" };
    const call = async (args: string[]) => {
      const out: string[] = [], err: string[] = [];
      const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env, cwd: f.root, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    for (const a of [["identity", "new", "--kind", "human", "--me", "--no-recovery"], ["identity", "new", "--kind", "agent", "--name", "my-agent", "--sponsor", me, "--purpose", "Test"], ["identity", "new", "--kind", "human", "--name", "bank", "--no-recovery"]]) assert.equal((await call(a)).code, 0);
    const session = () => call(["run", "claude-code", "--prompt", "Do it", "--allow", "all", "--project", project]);
    const standingFile = join(f.aspHome, "standing.json");
    const jobs = () => Object.values(JSON.parse(readFileSync(standingFile, "utf8")) as Record<string, { contract: string; expiresAt: string; createdAt: string }>);

    // Day one: a new job, nothing about an earlier one.
    const first = await session();
    assert.equal(first.code, 0, first.err);
    assert.match(first.err, /new standing job \(7 days\)/);
    assert.doesNotMatch(first.err, /ran out|had ended/);
    const [one] = jobs();

    // Day two: the job is still running, so it is reused.
    const second = await session();
    assert.equal(second.code, 0, second.err);
    assert.match(second.err, /standing job, session 2/);
    assert.equal(jobs()[0].contract, one.contract);

    // A week later: the recorded expiry is in the past.
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const all = JSON.parse(readFileSync(standingFile, "utf8")) as Record<string, { expiresAt: string }>;
    for (const k of Object.keys(all)) all[k].expiresAt = past;
    writeFileSync(standingFile, JSON.stringify(all));
    const back = await session();
    assert.equal(back.code, 0, back.err);
    assert.match(back.err, /new standing job \(7 days\); the standing job from \d{4}-\d{2}-\d{2} ran out on \d{4}-\d{2}-\d{2}, so this one was made, and your earlier records are unchanged/);
    const [two] = jobs();
    assert.notEqual(two.contract, one.contract, "a new job, not the old one");
    assert.ok(Date.parse(two.expiresAt) > Date.now() + 6 * 86_400_000, "with a fresh week");
    // The old job was settled, not left running.
    assert.match((await call(["market", "show", one.contract])).out, /state (Settled|Closed|Ended|Expired|Revoked)/i);

    // And the session after that reuses the new one, with no renewal note.
    const next = await session();
    assert.doesNotMatch(next.err, /ran out|had ended/);
    assert.match(next.err, /standing job, session 2/);
    assert.equal(jobs()[0].contract, two.contract);
  } finally {
    server.kill(); upstream.close();
  }
});
