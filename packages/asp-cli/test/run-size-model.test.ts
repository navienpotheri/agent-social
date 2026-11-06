import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const fakeClaude = fileURLToPath(new URL("./fake-claude-gateway.mjs", import.meta.url));

// Gap BM17: --size-with-model has a model read the task; every failure falls back to the words.
test("--size-with-model: the model's answer sizes the session, a hint names what is never granted, and failures fall back to the words", { timeout: 120_000 }, async () => {
  let answer = "";
  const seen: { key?: string; task?: string }[] = [];
  const upstream: Server = createHttp(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    let body: any = {}; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not json */ }
    if (typeof body.system === "string" && /size the permissions/.test(body.system)) seen.push({ key: String(req.headers["x-api-key"]), task: body.messages?.[0]?.content });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: "text", text: answer }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  try {
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const run = async (args: string[], extraEnv: Record<string, string> = { ANTHROPIC_API_KEY: "test-key" }) => {
      const out: string[] = [], err: string[] = [];
      const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: fakeClaude, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl, ...extraEnv }, cwd: f.aspHome, raw: (b: Buffer) => out.push(b.toString("utf8").trimEnd()) } as Io;
      const code = await main(["run", "claude-code", "--local", "--project", project, ...args], io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };

    // The model says "read only" for a task whose words suggest writing: the model wins, and the key and the task reached it.
    answer = '{"scopes": [], "extras": [], "unsure": false, "note": "a review reads"}';
    const a = await run(["--prompt", "Fix the review comments by reading them first", "--size-with-model"]);
    assert.match(a.err, /may read files; no network/, a.err);
    assert.match(a.err, /sized by a model that read your task/);
    assert.equal(seen.at(-1)?.key, "test-key");
    assert.match(seen.at(-1)?.task ?? "", /^Task: Fix the review comments/);

    // The model says the task needs a push: told to the person, never granted.
    answer = '{"scopes": ["repo.write"], "extras": ["repo.push", "shell.network"], "unsure": false, "note": "push"}';
    const b = await run(["--prompt", "Commit and push the change", "--size-with-model"]);
    assert.match(b.err, /may read and write files; no network/);
    assert.match(b.err, /also needs a push .*network.*never granted automatically/);

    // An answer that is not JSON: the words decide, and the person is told.
    answer = "I am not sure.";
    const c = await run(["--prompt", "Explain the gateway", "--size-with-model"]);
    assert.match(c.err, /the model could not size this task; sizing it from its words/);
    assert.match(c.err, /sized to your task: read files/);

    // No key: the words decide, and the person is told which variable it wanted.
    const before = seen.length;
    const d = await run(["--prompt", "Explain the gateway", "--size-with-model"], {});
    assert.match(d.err, /needs your ANTHROPIC_API_KEY/);
    assert.equal(seen.length, before, "nothing was sent");

    // Without the flag the model is never asked.
    const e = await run(["--prompt", "Explain the gateway"]);
    assert.equal(seen.length, before);
    assert.doesNotMatch(e.err, /model/);
  } finally { upstream.close(); }
});
