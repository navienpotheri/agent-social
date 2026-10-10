// The after-run learning loop for an agent we have no adapter for: Claude Code saves a note through the gateway's MCP memory tools in one
// session; a fresh session, told not to read the project, answers from that note. Memory goes back into the package as a signed lineage update.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CLAUDE_MODEL, D, Eval, gateway, have, session, skip, workdir } from "./lib/common.mjs";

const NAME = "gateway-claude-memory";
if (!have("claude")) skip(NAME, "claude (Claude Code) is not on the PATH");
const ev = new Eval(NAME, "memory written in one Claude Code session is found by the next, through the gateway's MCP tools");
const dir = workdir(NAME);
const s = await session(dir);
const agent = D("agents:learner");
const { principal, bank } = await s.parties({ agents: [agent] });
for (const d of ["proj", "home"]) mkdirSync(`${dir}/${d}`, { recursive: true });
writeFileSync(`${dir}/proj/notes.txt`, "The magic word is pelican.\n");
writeFileSync(`${dir}/proj/CLAUDE.md`, "# Project\n\nBe brief.\n");
await s.must(["pack", "--runtime", "claude-code", "--agent", agent, "--project", `${dir}/proj`, "--user-home", `${dir}/home`, "--out", `${dir}/learner.aspkg`]);

// The command the gateway runs: Claude Code with the gateway's MCP config; its answer is kept in a file so it can be checked.
const launcher = (prompt, out) => ["node", "-e", `
  const { spawnSync } = require("node:child_process");
  const r = spawnSync("claude", ["-p", ${JSON.stringify(prompt)}, "--model", ${JSON.stringify(CLAUDE_MODEL)}, "--mcp-config", process.env.ASP_MCP_CONFIG,
    "--allowedTools", "Read,mcp__asp__asp_memory_list,mcp__asp__asp_memory_read,mcp__asp__asp_memory_write,mcp__asp__asp_memory_search", "--add-dir", ${JSON.stringify(dir + "/proj")}, "--output-format", "text"],
    { encoding: "utf8", cwd: ${JSON.stringify(dir + "/proj")} });
  require("node:fs").writeFileSync(${JSON.stringify(out)}, r.stdout || "");
  process.exit(r.status ?? 1);`];

const c1 = await s.job({ principal, bank, agent, scopes: ["repo.read"] });
const r1 = await gateway(s, { contract: c1, agent, flags: ["--anthropic-upstream", "https://api.anthropic.com", "--package", `${dir}/learner.aspkg`],
  command: launcher("Read notes.txt with the Read tool. Then save a note with the asp_memory_write tool named magic-word, describing it as 'the project magic word', whose content records what the magic word is. Finish with one short sentence.", `${dir}/run1.txt`) });
ev.check("run 1 finished", r1.code === 0);
const wrote = /memory updated during a gateway run/.test(r1.err);
if (!wrote) ev.inconclusive("Claude Code saved a note", "it did not call asp_memory_write");
else {
  ev.pass("the note was written back to the package as a signed lineage update");
  ev.check("the package still verifies", (await s.asp(["verify", `${dir}/learner.aspkg`])).code === 0);
  ev.check("the note is in the package's memory", /magic word/i.test(readFileSync(`${dir}/learner.aspkg/memory/auto/magic-word.md`, "utf8")));
  const c2 = await s.job({ principal, bank, agent, scopes: ["repo.read"] });
  const r2 = await gateway(s, { contract: c2, agent, flags: ["--anthropic-upstream", "https://api.anthropic.com", "--package", `${dir}/learner.aspkg`],
    command: launcher("What is the project magic word? Do not read any project files. Call asp_memory_list and read what you need from your memory, then answer in one short sentence.", `${dir}/run2.txt`) });
  ev.check("run 2 finished", r2.code === 0);
  const answer = readFileSync(`${dir}/run2.txt`, "utf8");
  ev.check("a fresh session answered from memory", /pelican/i.test(answer), answer.slice(0, 120));
  ev.check("it did not read the project file", !r2.allowed.some((l) => /Read ->/.test(l)));
}
ev.finish();
