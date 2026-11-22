// Register row DK1800 (the written half): the tutorials of docs/tutorials. The command of each tutorial is run against a stand-in agent, with a folder of the test's own in place of the folder that the tutorial tells the reader
// to name, and the line that the tutorial says the tool prints before the run is the line that it prints. Every link exists, the flags are known, and the standing statements are kept. Fake agent; no provider; no service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORK_PRESETS } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const brief = fileURLToPath(new URL("./fake-claude-brief.mjs", import.meta.url));
const KINDS = ["coding", "writing", "translation", "learning"] as const;

test("each tutorial exists, is listed in the index, links to files that exist and keeps the standing statements", () => {
  const files = readdirSync(new URL("docs/tutorials/", root)).filter((f) => f.endsWith(".md") && f !== "README.md").map((f) => f.replace(/\.md$/, "")).sort();
  assert.deepEqual(files, [...KINDS].sort());
  const index = read("docs/tutorials/README.md");
  for (const k of KINDS) {
    assert.ok(index.includes(`[${k}.md](${k}.md)`), `${k} is in the index`);
    const t = read(`docs/tutorials/${k}.md`);
    for (const m of t.matchAll(/\]\(([^)#]+)\)/g)) assert.ok(existsSync(new URL(`docs/tutorials/${m[1]}`, root)), `${k}: ${m[1]} exists`);
    assert.match(t, /Credits are mock accounting entries, not money/);
    assert.match(t, /no outside security review/);
    assert.ok(t.includes("DK1800"), "the limits point to the row");
  }
});

test("the line that each tutorial says the tool prints is the line that the tool prints, when its command is run against a stand-in agent", { timeout: 240_000 }, async () => {
  const upstream = createHttp(async (req, res) => { for await (const _ of req) { /* not inspected */ } res.writeHead(200); res.end("{}"); });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  try {
    for (const k of KINDS) {
      const t = read(`docs/tutorials/${k}.md`);
      const line = /^> (preset .+)$/m.exec(t)?.[1];
      const w = WORK_PRESETS[k];
      assert.equal(line, `preset ${k}: the agent may ${w.allows}; it may not ${w.never}`, `${k}: the sentence in the tutorial is the code's own`);
      const cmd = /^npm run asp -- (run claude-code .+)$/m.exec(t)?.[1];
      assert.ok(cmd, `${k}: a run command`);
      const prompt = /--prompt "([^"]+)"/.exec(cmd!)?.[1];
      assert.ok(prompt && prompt.length > 20, `${k}: a prompt`);
      assert.ok(cmd!.includes(`--permissions ${k} `), `${k}: the preset is named`);
      assert.match(cmd!, /--local/);
      const f = makeFixture();
      const project = join(f.root, "project"); mkdirSync(project, { recursive: true }); mkdirSync(f.aspHome, { recursive: true });
      const env = { ASP_HOME: f.aspHome, ASP_CLAUDE_BIN: process.execPath, ASP_CLAUDE_SCRIPT: brief, ASP_RUN_ANTHROPIC_UPSTREAM: upUrl };
      const out: string[] = [], err: string[] = [];
      const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env, cwd: f.aspHome, raw: (b: Buffer) => out.push(b.toString("utf8").trimEnd()) } as Io;
      const code = await main(["run", "claude-code", "--local", "--project", project, "--permissions", k, "--prompt", prompt!], io);
      assert.equal(code, 0, `${k}: ${err.join("\n")}`);
      assert.ok(err.join("\n").replace(/\s+/g, " ").includes(line!.replace(/\s+/g, " ")), `${k}: the tool prints the sentence of the tutorial\n${err.join("\n")}`);
    }
  } finally { upstream.close(); }
});

test("every command of a tutorial is a documented command with flags that the CLI knows", async () => {
  const { main: m } = await import("../src/cli.ts");
  const out: string[] = [];
  await m(["help", "all"], { out: (l: string) => out.push(l), err() {}, env: {}, cwd: process.cwd() } as never);
  const help = out.join("\n") + "\n" + read("docs/commands.md");
  const src = read("packages/asp-cli/src/cli.ts");
  const problems: string[] = [];
  for (const k of KINDS) {
    for (const c of read(`docs/tutorials/${k}.md`).matchAll(/npm run asp -- ([^`\n]+)/g)) {
      const cmd = c[1]!;
      const first = cmd.split(" ")[0]!;
      if (!(help.includes(`asp ${first}`) || help.includes(`\`asp ${first}`))) problems.push(`${k}: asp ${first}`);
      for (const f of cmd.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)) {
        const name = f[1]!;
        const camel = name.replace(/-([a-z])/g, (_, x: string) => x.toUpperCase());
        if (!(src.includes(`"${name}": {`) || src.includes(`  ${name}: {`) || src.includes(`  ${camel}: {`))) problems.push(`${k}: --${name}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
