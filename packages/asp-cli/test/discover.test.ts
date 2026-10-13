import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVERYDAY, ALSO } from "@agent-social/asp-package";
import { AFTER_JOIN, joinDone, joinDoneCli } from "../../asp-log/src/join-page.ts";
import { main, returnToTerminalPlan, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function asp(f: Fixture, args: string[], o: { cwd?: string; ask?: (q: string) => Promise<string> } = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: o.cwd ?? f.root, ...(o.ask ? { ask: o.ask } : {}) };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const join_ = (f: Fixture, tenant = "ada") => {
  mkdirSync(f.aspHome, { recursive: true });
  writeFileSync(join(f.aspHome, "config.json"), JSON.stringify({ service: "http://127.0.0.1:1", token: "tok", tenant, joinedAt: "2026-10-11T00:00:00Z", identities: { me: "did:web:x:u:ada", agent: "did:web:x:a:ada:my-agent", bank: "did:web:x:u:ada:bank" } }));
};

test("asp with nothing after it is a short home: one step for a newcomer, the everyday commands and the next step once joined; the full reference stays at --help and help all", async () => {
  const f = makeFixture();
  const fresh = await asp(f, []);
  assert.equal(fresh.code, 0);
  assert.match(fresh.out, /You have not joined yet/);
  assert.match(fresh.out, /asp join/);
  assert.ok(fresh.out.split("\n").length < 10, "short");
  join_(f);
  const home = await asp(f, []);
  assert.equal(home.code, 0);
  for (const [c] of [...EVERYDAY.filter(([c]) => c !== "asp join"), ...ALSO]) assert.ok(home.out.includes(c), `${c} is on the home screen`);
  assert.match(home.out, /ada.*default agent: my-agent/);
  assert.match(home.out, /Next:\n  asp run claude-code/);
  assert.ok(home.out.split("\n").length < 20, "still short");
  // The whole reference is one flag away, and a bad command is still an error.
  for (const args of [["--help"], ["help", "all"]]) { const r = await asp(f, args); assert.equal(r.code, 0); assert.match(r.out, /asp market/); assert.match(r.out, /asp serve/); }
  assert.equal((await asp(f, ["frobnicate"])).code, 2);
});

test("asp help lists the topics, shows one, and searches by words", async () => {
  const f = makeFixture();
  const all = await asp(f, ["help"]);
  assert.equal(all.code, 0);
  assert.match(all.out, /stop\s+Stopping a session/);
  assert.match(all.out, /asp help all/);
  assert.match((await asp(f, ["help", "stop"])).out, /asp standing end/);
  const found = await asp(f, ["help", "lost", "my", "key"]);
  assert.match(found.out, /Lost keys and recovery/);
  assert.match(found.out, /asp identity recover/);
  const none = await asp(f, ["help", "xyzzy"]);
  assert.equal(none.code, 1);
  assert.match(none.out, /nothing in the help matches/);
});

test("asp ask shows the command it understood before anything runs, asks first, never runs what cannot be undone, and says so when it does not understand", async () => {
  const f = makeFixture();
  join_(f);
  // No terminal to answer on: it shows and stops.
  const shown = await asp(f, ["ask", "stop what is running"]);
  assert.equal(shown.code, 0);
  assert.match(shown.out, /I read that as:  asp stop/);
  assert.match(shown.out, /not run: there is no one here to answer/);
  // "How do I ..." asks how, so the command is shown and never offered to run (a person answered y to "how do I stop a session" and ran `asp stop` for real).
  let offered = false;
  const how = await asp(f, ["ask", "how do I stop a session"], { ask: async () => { offered = true; return "y"; } });
  assert.equal(how.code, 0);
  assert.match(how.out, /To do that, run:  asp stop/);
  assert.equal(offered, false, "it does not offer to run it");
  // Answered no, then yes (asp stop with nothing running says so).
  const no = await asp(f, ["ask", "stop", "what", "is", "running"], { ask: async () => "n" });
  assert.match(no.out, /not run/);
  const asked: string[] = [];
  const yes = await asp(f, ["ask", "stop what is running"], { ask: async (q) => { asked.push(q); return "y"; } });
  assert.deepEqual(asked, ["Run it? [y/N] "]);
  assert.equal(yes.code, 0);
  assert.match(yes.out, /nothing is running/);
  assert.match((await asp(f, ["ask", "what did my agent do", "--yes"])).out, /no sessions yet/);
  // Destructive: shown with the tenant filled in, never run, even with --yes.
  const del = await asp(f, ["ask", "delete my account", "--yes"]);
  assert.match(del.out, /I read that as:  asp account close --confirm ada/);
  assert.match(del.out, /only shows it/);
  // Incomplete: a placeholder left for the person.
  const inc = await asp(f, ["ask", "make a new agent"]);
  assert.match(inc.out, /asp agent add <name>/);
  assert.match(inc.out, /still needs your details/);
  // Not understood: exit 1 and a pointer to the help.
  const lost = await asp(f, ["ask", "what is the meaning of life"]);
  assert.equal(lost.code, 1);
  assert.match(lost.out, /did not understand/);
  assert.equal((await asp(f, ["ask"])).code, 2);
});

test("asp.yaml: init writes and trusts it, a bare asp run uses it, the command line wins, a typo is an error, and a file you did not write cannot grant itself the network", async () => {
  const f = makeFixture();
  const proj = mkdtempSync(join(tmpdir(), "asp-yaml-"));
  // Without a file or a runtime, a bare run is still a usage error.
  assert.equal((await asp(f, ["run"], { cwd: proj })).code, 2);
  const init = await asp(f, ["init"], { cwd: proj });
  assert.equal(init.code, 0, init.err);
  assert.match(readFileSync(join(proj, "asp.yaml"), "utf8"), /^runtime: claude-code/m);
  assert.match((await asp(f, ["init"], { cwd: proj })).err, /already exists/);
  // The file now makes a bare run a claude-code session; it gets as far as needing a login, which is the next thing a newcomer would hit.
  const bare = await asp(f, ["run"], { cwd: proj });
  assert.match(bare.err, /using asp\.yaml/);
  assert.match(bare.err, /join/);
  // A file asking for the network that you did not write: refused until trusted.
  writeFileSync(join(proj, "asp.yaml"), "runtime: claude-code\nallow-network: [evil.example]\n");
  const refused = await asp(f, ["run"], { cwd: proj });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /asks for network access to evil\.example, and you have not trusted this file/);
  // The command line's own hosts win, so the file's are not used and need no trust.
  assert.doesNotMatch((await asp(f, ["run", "--allow-network", "api.github.com"], { cwd: proj })).err, /not trusted/);
  // Trusting is for this content: after trust it goes on; change the file and it asks again.
  const trusted = await asp(f, ["trust", "asp.yaml"], { cwd: proj });
  assert.match(trusted.out, /may reach evil\.example/);
  assert.doesNotMatch((await asp(f, ["run"], { cwd: proj })).err, /not trusted/);
  writeFileSync(join(proj, "asp.yaml"), "runtime: claude-code\nallow-network: [evil.example, worse.example]\n");
  assert.match((await asp(f, ["run"], { cwd: proj })).err, /not trusted/);
  // A typo or an unknown setting is an error naming the line; so is a runtime asp run cannot start.
  writeFileSync(join(proj, "asp.yaml"), "runtime: claude-code\nrutime: x\n");
  const typo = await asp(f, ["run"], { cwd: proj });
  assert.equal(typo.code, 2);
  assert.match(typo.err, /line 2: rutime is not a setting/);
  writeFileSync(join(proj, "asp.yaml"), "runtime: cursor\n");
  assert.match((await asp(f, ["run"], { cwd: proj })).err, /runtime cursor is not one asp run can start/);
  // The file is found from a sub-folder.
  writeFileSync(join(proj, "asp.yaml"), "runtime: claude-code\n");
  mkdirSync(join(proj, "src", "deep"), { recursive: true });
  assert.match((await asp(f, ["run"], { cwd: join(proj, "src", "deep") })).err, /using .*asp\.yaml/);
  // The home screen notices the file.
  join_(f);
  assert.match((await asp(f, [], { cwd: proj })).out, /Next:\n  asp run$/);
  assert.equal((await asp(f, ["trust"], { cwd: f.root })).code, 2);
});

test("after the browser step, asp join gets the person's attention in the terminal the way each operating system allows (a page cannot focus another application)", () => {
  const win = returnToTerminalPlan("win32", {}, "It's done", "asp join");
  assert.equal(win.length, 1);
  assert.equal(win[0].cmd, "powershell");
  const script = win[0].args.at(-1)!;
  assert.match(script, /AppActivate\('asp join'\)/);
  assert.match(script, /ShowBalloonTip\(6000, 'Agent Social', 'It''s done'/, "quotes in the message are escaped");
  const mac = returnToTerminalPlan("darwin", { TERM_PROGRAM: "iTerm.app" }, "Back to the terminal", "asp join");
  assert.deepEqual(mac.map((p) => p.cmd), ["osascript", "osascript"]);
  assert.match(mac[1].args[1], /tell application "iTerm" to activate/);
  assert.equal(returnToTerminalPlan("darwin", {}, "x", "t").length, 1, "an unknown terminal app gets the notification only");
  assert.deepEqual(returnToTerminalPlan("linux", {}, "Back", "t"), [{ cmd: "notify-send", args: ["Agent Social", "Back"] }]);
});

test("asp shim prints a script for the shell and refuses a shell it does not know", async () => {
  const f = makeFixture();
  const bash = await asp(f, ["shim", "bash"]);
  assert.equal(bash.code, 0);
  assert.match(bash.out, /claude\(\) \{/);
  assert.match(bash.out, /command asp run claude-code/);
  assert.match((await asp(f, ["shim", "powershell"])).out, /function claude/);
  assert.equal((await asp(f, ["shim", "tcsh"])).code, 2);
  assert.equal((await asp(f, ["shim"])).code, 2);
});

test("asp status says where things stand from this machine when the service cannot be reached, and what to do next", async () => {
  const f = makeFixture();
  const none = await asp(f, ["status"]);
  assert.match(none.out, /not joined yet/);
  join_(f);
  // One session with no end recorded: it shows as running, with asp stop as the first step.
  writeFileSync(join(f.aspHome, "runs.ndjson"), JSON.stringify({ t: "start", sid: "s1", contract: "c1", at: new Date().toISOString(), runtime: "claude-code", agent: "did:web:x:a:ada:my-agent", me: "did:web:x:u:ada", bank: "b", purpose: "fix the build", scopes: ["repo.read"], hosts: [] }) + "\n");
  const st = await asp(f, ["status"]);
  assert.equal(st.code, 0, st.err);
  assert.match(st.out, /ada on http:\/\/127\.0\.0\.1:1; default agent my-agent/);
  assert.match(st.out, /service: not reachable now/);
  assert.match(st.out, /running: 1\n\s+s1\s+claude-code/);
  assert.match(st.out, /Next:\n  asp stop/);
});

test("the service answers /help without a sign-in, and the page after sign-up shows the same everyday lines as the command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-help-e2e-"));
  const tokens = join(dir, "tokens.json");
  await new Promise<void>((resolve) => { const c = spawn(process.execPath, [cli, "serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"], { stdio: "ignore" }); c.on("close", () => resolve()); });
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const page = await fetch(`${url}/help?q=lost+key`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Lost keys and recovery/);
    assert.match(await (await fetch(`${url}/help`)).text(), /Every day/);
  } finally { server.kill(); }
  // The lines on the sign-up pages are the command's lines (the home screen without asp join, plus asp help).
  const expected = EVERYDAY.filter(([c]) => c !== "asp join").map(([c]) => c);
  assert.deepEqual(AFTER_JOIN.slice(0, 4).map(([c]) => c), expected);
  assert.equal(AFTER_JOIN[4][0], "asp help");
  for (const [c, d] of EVERYDAY.filter(([c]) => c !== "asp join")) assert.ok(AFTER_JOIN.some(([c2, d2]) => c2 === c && d2 === d), `${c} says the same on both`);
  for (const html of [joinDoneCli("ada"), joinDone({ tenant: "ada", token: "t", service: "http://x", quotas: { recordQuota: 1, byteQuota: 1048576, rateLimitPerMinute: 1 } })]) {
    for (const [c] of AFTER_JOIN) assert.ok(html.includes(c), `${c} is on the page after sign-up`);
  }
});
