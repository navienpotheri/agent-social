import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ALSO, EVERYDAY, TOPICS, askToCommand, helpPage, helpRoutes, homeText, nextSteps, parseAspYaml, searchTopics, shimScript, shown } from "../src/guide.ts";

test("help search finds the topic a person means, by its name, title or words", () => {
  assert.equal(searchTopics("stop")[0].name, "stop");
  assert.equal(searchTopics("github action")[0].name, "headless");
  assert.equal(searchTopics("I lost my key")[0].name, "recovery");
  assert.equal(searchTopics("subscription")[0].name, "providers");
  assert.deepEqual(searchTopics("xyzzy"), []);
  assert.deepEqual(searchTopics(""), []);
  assert.equal(new Set(TOPICS.map((t) => t.name)).size, TOPICS.length, "topic names are unique");
});

test("the home screen shows what to type next given the person's state", () => {
  const out = homeText({ joined: false, running: 0, sessions: 0 }).join("\n");
  assert.match(out, /asp join/);
  assert.ok(!/asp runs/.test(out), "a newcomer sees one thing to do");
  const fresh = homeText({ joined: true, tenant: "ada", agent: "my-agent", running: 0, sessions: 0 }).join("\n");
  assert.match(fresh, /ada/);
  for (const [c] of [...EVERYDAY.filter(([c]) => c !== "asp join"), ...ALSO]) assert.ok(fresh.includes(c), `${c} is on the home screen`);
  assert.match(fresh, /Next:\n  asp run claude-code/);
  assert.deepEqual(nextSteps({ joined: true, running: 0, sessions: 3 }), ["asp runs   (see what the last session did)"]);
  assert.match(nextSteps({ joined: true, running: 2, sessions: 3 })[0], /^asp stop .*2 sessions are running/);
  assert.match(nextSteps({ joined: true, running: 0, sessions: 0, hasYaml: true })[0], /^asp run$/);
  assert.match(nextSteps({ joined: true, running: 0, sessions: 1, standingEndingSoon: "bot" }).join("\n"), /standing job of bot ends within a day/);
});

test("asp ask turns words into a command by fixed rules, marks what is incomplete or cannot be undone, and says nothing when it does not understand", () => {
  const cmd = (t: string, ctx = {}) => { const r = askToCommand(t, ctx); return r ? `${shown(r.args)} [${r.risk}${r.complete ? "" : ", incomplete"}]` : undefined; };
  assert.equal(cmd("stop what is running"), "asp stop [change]");
  assert.equal(cmd("Kill it!"), "asp stop [change]");
  assert.equal(cmd("what did my agent do?"), "asp runs [read]");
  assert.equal(cmd("show me the history"), "asp runs [read]");
  assert.equal(cmd("is anything waiting for my approval"), "asp approvals [read]");
  assert.equal(cmd("sign me up"), "asp join [change]");
  assert.equal(cmd("where am I"), "asp status [read]");
  assert.equal(cmd("add an agent called reviewer"), "asp agent add reviewer [change]");
  assert.equal(cmd("make a new agent"), "asp agent add <name> [change, incomplete]");
  assert.equal(cmd("list my agents"), "asp agent list [read]");
  assert.equal(cmd("switch to the agent named reviewer"), "asp agent use reviewer [change]");
  assert.equal(cmd("run claude"), "asp run claude-code [change]");
  assert.equal(cmd("run codex and fix the failing test"), "asp run codex --prompt \"fix the failing test\" [change]");
  assert.equal(cmd("run goose"), "asp run goose --prompt <what to do> --model <model name> [change, incomplete]");
  assert.equal(cmd("launch claude \"update the readme\""), "asp run claude-code --prompt \"update the readme\" [change]");
  assert.equal(cmd("export my data"), "asp account export [change]");
  assert.equal(cmd("delete my account", { tenant: "ada" }), "asp account close --confirm ada [destructive]");
  assert.equal(cmd("close my account"), "asp account close --confirm <your tenant name> [destructive, incomplete]");
  assert.equal(cmd("end my standing job"), "asp standing end [destructive]");
  assert.equal(cmd("list the standing jobs"), "asp standing [read]");
  assert.equal(cmd("I lost my key"), "asp help recovery [read]");
  assert.equal(cmd("how do I run this in github actions"), "asp help headless [read]");
  assert.equal(cmd("seal the run log"), "asp run-log keep [change]");
  assert.equal(cmd("give the run log to the court"), "asp help runlog [read]");
  assert.equal(cmd("what is the meaning of life"), undefined);
  assert.equal(cmd("   "), undefined);
});

test("asp.yaml: the settings a project may give, in the forms people write them; anything else is an error naming the line", () => {
  const ok = parseAspYaml(`# defaults\nruntime: claude-code   # the tool\nagent: "reviewer"\nask: [commands, network]\nallow-network:\n  - api.github.com\n  - 'registry.npmjs.org'\nstanding-days: 3\nkeep-run-log: true\n`);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.values, { runtime: "claude-code", agent: "reviewer", ask: ["commands", "network"], "allow-network": ["api.github.com", "registry.npmjs.org"], "standing-days": 3, "keep-run-log": true });
  assert.deepEqual(parseAspYaml("ask: commands, writes").values, { ask: ["commands", "writes"] });
  const bad = parseAspYaml("runtime claude-code\nrutime: x\nstanding-days: soon\nkeep-run-log: maybe\nagent: a\nagent: b\n  - orphan\nmodel:\n");
  assert.equal(bad.errors.length, 7);
  assert.match(bad.errors[0], /line 1: not "key: value"/);
  assert.match(bad.errors[1], /line 2: rutime is not a setting/);
  assert.match(bad.errors[2], /line 3: standing-days is a whole number/);
  assert.match(bad.errors[3], /line 4: keep-run-log is true or false/);
  assert.match(bad.errors[4], /line 6: agent is set twice/);
  assert.match(bad.errors[5], /line 7: a list item with no key above it/);
  assert.match(bad.errors[6], /line 8: model has no value/);
});

test("the shell shim completes asp and sends claude through a governed session, and passes anything else to the real claude with a notice", () => {
  const bash = shimScript("bash")!;
  assert.match(bash, /complete -F _asp_complete asp/);
  assert.match(bash, /command asp run claude-code\b/);
  assert.match(bash, /--prompt "\$2"/);
  assert.match(bash, /command claude "\$@"/);
  assert.match(bash, /ungoverned/);
  assert.match(shimScript("zsh")!, /bashcompinit/);
  const ps = shimScript("powershell")!;
  assert.match(ps, /Register-ArgumentCompleter/);
  assert.match(ps, /function claude/);
  assert.equal(shimScript("tcsh"), undefined);
});

test("the help page lists the topics, searches without scripts, escapes the search text, and the route is public and read-only", async () => {
  const page = helpPage();
  for (const t of TOPICS) assert.ok(page.includes(t.title.replace(/'/g, "&#39;")), t.title);
  assert.ok(!/<script/i.test(page));
  const searched = helpPage("<b>zzzqq</b>\"");
  assert.ok(!searched.includes("<b>zzzqq") && searched.includes("&lt;b&gt;zzzqq"), "the query is escaped");
  assert.match(searched, /Nothing matches/);
  assert.match(helpPage("stop"), /Stopping a session/);
  assert.ok(!/Getting started/.test(helpPage("stop")), "only matches are listed");

  const route = helpRoutes();
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end("other"); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const all = await fetch(`${base}/help`);
    assert.equal(all.status, 200);
    assert.match(all.headers.get("content-security-policy")!, /default-src 'none'/);
    assert.match(await all.text(), /Every day/);
    assert.match(await (await fetch(`${base}/help?q=key`)).text(), /Lost keys and recovery/);
    assert.match(await (await fetch(`${base}/help/stop`)).text(), /asp standing end/);
    assert.equal((await fetch(`${base}/help/nope`)).status, 404);
    assert.equal((await fetch(`${base}/help`, { method: "POST" })).status, 405);
    assert.equal(await (await fetch(`${base}/other`)).text(), "other");
  } finally { server.close(); }
});
