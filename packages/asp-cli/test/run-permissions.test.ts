import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const brief = fileURLToPath(new URL("./fake-claude-brief.mjs", import.meta.url));

// Gap BM17: a session with no task is sized by a choice made once per project and kept.
test("an interactive session asks once per project which permissions to use, keeps the answer, and --permissions changes it", { timeout: 120_000 }, async () => {
  const upstream = createHttp(async (req, res) => { for await (const _ of req) { /* not inspected */ } res.writeHead(200); res.end("{}"); });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  try {
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true });
    mkdirSync(f.aspHome, { recursive: true });
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: brief, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl };
    const asked: string[] = [];
    const run = async (args: string[], answer?: string) => {
      const out: string[] = [], err: string[] = [];
      const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env, cwd: f.aspHome, raw: (b: Buffer) => out.push(b.toString("utf8").trimEnd()),
        ...(answer !== undefined ? { ask: async (q: string) => { asked.push(q); return answer; } } : {}) } as Io;
      const code = await main(["run", "claude-code", "--local", "--project", project, ...args], io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    const saved = () => JSON.parse(readFileSync(join(f.aspHome, "local", "project-permissions.json"), "utf8"));

    // First time: asked, and answered "1" (review).
    const first = await run([], "1");
    assert.equal(asked.length, 1);
    assert.match(asked[0], /1\) review.*2\) develop.*3\) full/s);
    assert.match(first.err, /may read files; no network/, first.err);
    assert.match(first.err, /scope\s+your choice for this project \(review\)/);
    assert.deepEqual(Object.values(saved()), ["review"]);

    // Second time: not asked again, the same choice.
    const second = await run([], "3");
    assert.equal(asked.length, 1, "not asked again");
    assert.match(second.err, /your choice for this project \(review\)/);

    // --permissions develop changes it, and --allow adds to one run only.
    const dev = await run(["--permissions", "develop"], "3");
    assert.match(dev.err, /may read and write files, run tests; no network/, dev.err);
    assert.deepEqual(Object.values(saved()), ["develop"]);
    const plus = await run(["--allow", "commands"], "3");
    assert.match(plus.err, /run commands/);
    assert.deepEqual(Object.values(saved()), ["develop"], "--allow does not change the saved choice");

    // full is the usual set; --permissions ask asks again.
    assert.match((await run(["--permissions", "full"], "3")).err, /read and write files, run commands; no network/);
    const again = await run(["--permissions", "ask"], "2");
    assert.equal(asked.length, 2, "asked again on request");
    assert.deepEqual(Object.values(saved()), ["develop"]);

    // No way to ask (no terminal, no front end): the usual set, nothing saved over the choice.
    const quiet = await run(["--permissions", "ask"]);
    assert.match(quiet.err, /read and write files, run commands/, quiet.err);

    // A bad value is refused.
    const bad = await run(["--permissions", "everything"], "3");
    assert.notEqual(bad.code, 0);
    assert.match(bad.err, /--permissions review\|develop\|full/);
    void again;
  } finally { upstream.close(); }
});
