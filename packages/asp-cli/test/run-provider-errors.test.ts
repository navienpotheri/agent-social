import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, providerProblem, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));

async function asp(home: string, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ...env }, cwd: home, raw: (b) => out.push(b.toString("utf8").trimEnd()) } as Io;
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("provider errors in words: what each status means and what to do, never the provider's own text", () => {
  assert.match(providerProblem(401, "api.example.com"), /refused the API key \(HTTP 401\).*set the right one/);
  assert.match(providerProblem(403, "h"), /refused the API key/);
  assert.match(providerProblem(402, "h"), /out of credit/);
  assert.match(providerProblem(404, "h"), /model or address/);
  assert.match(providerProblem(429, "h"), /rate limiting this key \(HTTP 429\).*wait a minute/);
  assert.match(providerProblem(503, "h"), /error on its side \(HTTP 503\)/);
  assert.match(providerProblem(400, "h"), /rejected the request \(HTTP 400\).*run log/);
  assert.match(providerProblem(0, "h", "ECONNREFUSED"), /could not reach h \(it refused the connection\)/);
  assert.match(providerProblem(0, "h", "ENOTFOUND"), /address could not be found/);
});

// UC-18: a wrong key, a rate limit, an outage, or no network to the provider. Found when written: the person saw only the tool's own error, and the gateway passed the provider's body on without saying anything.
test("a model provider's refusal or outage is named plainly in the session summary, and a key the provider echoes is never printed", async () => {
  let status = 401;
  const upstream = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key sk-test-secret-1234" } }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  try {
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const env = { ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ASP_GATEWAY_KILL_GRACE_MS: "0" };
    const run = (prompt: string) => asp(f.aspHome, ["run", "claude-code", "--local", "--prompt", prompt, "--project", project], env);

    for (const [code, say] of [[401, /refused the API key \(HTTP 401\)/], [429, /rate limiting this key \(HTTP 429\)/], [503, /error on its side \(HTTP 503\)/], [402, /out of credit/]] as const) {
      status = code;
      const r = await run(`Status ${code}`);
      assert.match(r.out, say, `${code}: named in the summary\n${r.out}`);
      assert.match(r.out, /Session summary[\s\S]*\n {2}provider /, `${code}: under the session summary\n${r.out}`);
      assert.ok(!(r.err + r.out).includes("sk-test-secret-1234"), `${code}: the provider's own text, which can echo a key, is not printed`);
      assert.equal((r.out.match(/\n {2}provider /g) ?? []).length, 1, `${code}: said once`);
    }
    // A tool that keeps retrying a refused key is stopped after three refusals, not left to retry in silence for minutes (live: nine 401s in two minutes with a wrong key).
    status = 401;
    const loop = await asp(f.aspHome, ["run", "claude-code", "--local", "--prompt", "Retry", "--project", project], { ...env, ASP_CLAUDE_SCRIPT: fileURLToPath(new URL("./fake-claude-retrier.mjs", import.meta.url)) });
    assert.equal((loop.out.match(/attempt \d+: HTTP 401/g) ?? []).length <= 5, true, `stopped early\n${loop.out}`);
    assert.match(loop.out, /provider .*refused the API key/, loop.out);
    assert.match(loop.out, /stopped by you|failed|finished/, loop.out);
    assert.match(loop.out + loop.err, /refused the API key 3 times in a row/, loop.out + loop.err);
    // The provider is down altogether (nothing listening): named, with the host.
    upstream.close();
    const down = await run("Provider down");
    assert.match(down.out, /\n {2}provider could not reach 127\.0\.0\.1:\d+ \(it refused the connection\)/, down.out);
    // The job is fine afterwards: the next session is an ordinary one.
    assert.match((await asp(f.aspHome, ["runs"], env)).out, /claude-code/);
  } finally { upstream.close(); }
});
