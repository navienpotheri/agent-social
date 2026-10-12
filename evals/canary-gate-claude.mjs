// The canary as a gate on a real memory update (gaps register CM1), with real Claude Code. An agent package runs with `asp run`; what it saves to memory is
// tested before it is written back: the canary (two small tasks, through the gateway, on a copy of the package with the new memory) is compared with a baseline,
// recorded in the log as a certificate attestation about the new memory, and cited in the lineage edge.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_MODEL, D, Eval, ROOT, have, session, skip, workdir } from "./lib/common.mjs";

const NAME = "canary-gate-claude";
if (!have("claude")) skip(NAME, "claude (Claude Code) is not on the PATH");
const ev = new Eval(NAME, "a real Claude Code memory update is tested by the canary before it is written back");
const dir = workdir(NAME);
const s = await session(dir);
const agent = D("agents:learner");
await s.parties({ agents: [agent] });
const proj = `${dir}/proj`;
mkdirSync(proj, { recursive: true });
writeFileSync(`${proj}/CLAUDE.md`, "# Project\n\nBe brief.\n");
mkdirSync(`${dir}/home`, { recursive: true });
await s.must(["pack", "--runtime", "claude-code", "--agent", agent, "--project", proj, "--user-home", `${dir}/home`, "--out", `${dir}/learner.aspkg`]);
const pkg = `${dir}/learner.aspkg`;

const setup = await s.must(["canary", "setup", "--agent", agent, "--backend", "claude-code", "--target", "package:claude-code", "--suite", join(ROOT, "canary", "smoke-suite.json"), "--canary-gate", "warn", "--trials", "1"]);
ev.check("the canary was set up for the agent", /canary set up/.test(setup.out));

const save = (name, fact) => `Save a memory file named ${name}.md (with a one-line entry for it in MEMORY.md) recording this fact for next time: ${fact}. Do not run any commands. Reply in one short sentence.`;
const lineage = () => readFileSync(`${pkg}/records/history.ndjson`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === "asp.lineage/v0.2" && r.body.edge === "update");

const r1 = await s.asp(["run", pkg, "--backend", "claude-code", "--project", proj, "--model", CLAUDE_MODEL, "--prompt", save("project-style", "answers in this project should be one short sentence")]);
ev.check("run 1 finished", r1.code === 0, r1.err.slice(-200));
for (const l of r1.err.split("\n").filter((x) => /^\s*(canary|recorded)/.test(x))) ev.note(l.trim().slice(0, 200));
if (!/memory updated during a claude-code run/.test(r1.err)) ev.inconclusive("Claude Code saved a memory note", "it did not; nothing to gate");
else {
  ev.check("the canary ran on the change before it was written back", /canary {3}running 2 task\(s\)/.test(r1.err));
  ev.check("the first result became the baseline", /canary baseline_set: 2\/2 tasks pass/.test(r1.err), r1.err.split("\n").filter((l) => /canary/.test(l)).join(" | ").slice(0, 300));
  const edge = lineage().at(-1)?.body.change;
  ev.check("the lineage edge cites a certificate", edge?.gates?.length === 1 && /canary baseline_set/.test(edge.description), JSON.stringify(edge));
  ev.check("asp verify shows the canary evidence", /canary\s+1 of 1 recorded change/.test((await s.asp(["verify", pkg])).out));

  const r2 = await s.asp(["run", pkg, "--backend", "claude-code", "--project", proj, "--model", CLAUDE_MODEL, "--prompt", save("deploy-window", "deploys happen on Tuesdays")]);
  ev.check("run 2 finished", r2.code === 0, r2.err.slice(-200));
  if (/memory updated during a claude-code run/.test(r2.err)) {
    ev.check("the second change was compared with the baseline", /canary {3}canary (passed|regressed): /.test(r2.err), r2.err.split("\n").filter((l) => /canary/.test(l)).join(" | ").slice(0, 300));
    ev.check("it cites its own certificate", lineage().at(-1)?.body.change.gates?.length === 1);
  } else ev.inconclusive("Claude Code saved a second note", "it did not");
  const evid = await s.asp(["canary", "evidence", pkg]);
  ev.check("the evidence is listed with verdicts", /canary (baseline_set|passed|regressed), \d+% of trials/.test(evid.out), evid.out.slice(0, 300));
  ev.check("the package verifies", (await s.asp(["verify", pkg])).code === 0);
}
ev.check("the log verifies", /log ok/.test(await s.verifyLog()));
ev.finish();
