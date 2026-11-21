/**
 * Presets by kind of work (register row US7): `--permissions research|writing|coding` for a person who does not think in scopes. Each is a named bundle of the permission presets with a plain sentence of what it allows and never
 * allows, shown before the run; the same refusals apply (no network, no push, no protected files). Fake keys only; the agent is a stand-in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRESETS, WORK_PRESETS, isPreset, presetOf, presetScopes } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const brief = fileURLToPath(new URL("./fake-claude-brief.mjs", import.meta.url));
const FULL = ["repo.read", "repo.write", "tests.run", "shell.exec", "repo.write.protected"];

test("US7: each kind of work is one permission preset, and the bundles are the safe ones: research reads only, writing writes but runs nothing, coding also runs tests, none gets a command or protected files", () => {
  assert.deepEqual(Object.keys(WORK_PRESETS), ["research", "writing", "translation", "learning", "coding"]);
  assert.deepEqual(["research", "writing", "translation", "learning", "coding"].map((w) => presetOf(w)), ["review", "write", "write", "review", "develop"]);
  assert.equal(presetOf("full"), "full");
  assert.equal(presetOf("bogus"), undefined);
  assert.equal(presetOf(undefined), undefined);
  assert.ok(PRESETS.includes("write") && isPreset("write"));
  assert.deepEqual(presetScopes(presetOf("research")!, FULL).scopes, ["repo.read"]);
  assert.deepEqual(presetScopes(presetOf("writing")!, FULL).scopes, ["repo.read", "repo.write"]);
  assert.deepEqual(presetScopes(presetOf("coding")!, FULL).scopes, ["repo.read", "repo.write", "tests.run"]);
  for (const w of ["research", "writing", "translation", "learning", "coding"] as const) {
    const s = presetScopes(presetOf(w)!, FULL).scopes;
    assert.ok(!s.includes("shell.exec") && !s.includes("repo.write.protected"), `${w}: no command, no protected file`);
    assert.match(WORK_PRESETS[w].allows, /read/);
    assert.match(WORK_PRESETS[w].never, /network/);
  }
});

test("US7: asp run --permissions research|writing|coding says in plain words what the agent may and may not do, and keeps the choice for the project", { timeout: 120_000 }, async () => {
  const upstream = createHttp(async (req, res) => { for await (const _ of req) { /* not inspected */ } res.writeHead(200); res.end("{}"); });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  try {
    const f = makeFixture();
    const project = join(f.root, "project"); mkdirSync(project, { recursive: true }); mkdirSync(f.aspHome, { recursive: true });
    const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: brief, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl };
    const run = async (args: string[]) => {
      const out: string[] = [], err: string[] = [];
      const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env, cwd: f.aspHome, raw: (b: Buffer) => out.push(b.toString("utf8").trimEnd()) } as Io;
      const code = await main(["run", "claude-code", "--local", "--project", project, ...args], io);
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    const saved = () => JSON.parse(readFileSync(join(f.aspHome, "local", "project-permissions.json"), "utf8"));
    const research = await run(["--permissions", "research"]);
    assert.match(research.err, /preset\s+research: the agent may read the files in the project; it may not change a file, run a command or reach the network/, research.err);
    assert.match(research.err, /may read files; no network/);
    assert.deepEqual(Object.values(saved()), ["review"]);
    const writing = await run(["--permissions", "writing"]);
    assert.match(writing.err, /preset\s+writing: the agent may read and write the files in the project; it may not run a command/);
    assert.match(writing.err, /may read and write files; no network/, writing.err);
    assert.deepEqual(Object.values(saved()), ["write"]);
    const coding = await run(["--permissions", "coding"]);
    assert.match(coding.err, /preset\s+coding: the agent may read and write the files in the project and run its tests/);
    assert.match(coding.err, /may read and write files, run tests; no network/);
    assert.deepEqual(Object.values(saved()), ["develop"]);
    const tr = await run(["--permissions", "translation"]);
    assert.match(tr.err, /preset\s+translation: the agent may read the files in the project and write the translated files; it may not run a command/);
    assert.deepEqual(Object.values(saved()), ["write"]);
    const lr = await run(["--permissions", "learning"]);
    assert.match(lr.err, /preset\s+learning: the agent may read the files in the project so it can explain them and teach from them; it may not change a file/);
    assert.deepEqual(Object.values(saved()), ["review"]);
    const bad = await run(["--permissions", "gardening"]);
    assert.notEqual(bad.code, 0);
    assert.match(bad.err, /--permissions research\|writing\|translation\|learning\|coding/);
  } finally { upstream.close(); }
});
