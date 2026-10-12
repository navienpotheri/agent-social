// Run D: a shared log service with two tenants and three ASP homes ("machines"). Real Claude Code runs on two machines of one tenant at the same
// time; a stale push is refused and a merge pull keeps both lessons; tenants cannot see each other's packages; the commons works across tenants;
// the service restarts without losing anything. The log is a file by default; set ASP_EVAL_DATABASE_URL to run it on Postgres.
import { execFile, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_MODEL, D, Eval, ROOT, have, skip, workdir } from "./lib/common.mjs";

const NAME = "service-two-machines";
if (!have("claude")) skip(NAME, "claude (Claude Code) is not on the PATH");
const ev = new Eval(NAME, "shared service, two tenants, concurrent real Claude Code on two machines, stale push + merge, commons, restart");
const dir = workdir(NAME);
const MAIN = join(ROOT, "evals", "lib", "asp-main.mjs");
const port = 18500 + Math.floor(Math.random() * 400);
const URL_ = `http://127.0.0.1:${port}`;
const DB = process.env.ASP_EVAL_DATABASE_URL ?? `local:${dir}/svc-log`;

const asp = (home, token, args, env = {}) => new Promise((resolve) => {
  execFile(process.execPath, [MAIN, ...args], { env: { ...process.env, ASP_HOME: home, ASP_LOG_URL: URL_, ASP_LOG_TOKEN: token, ASP_CWD: dir, ...env }, maxBuffer: 64 << 20, timeout: 20 * 60_000 },
    (e, stdout, stderr) => resolve({ code: e ? (e.code ?? 1) : 0, out: stdout, err: stderr }));
});
const must = async (...a) => { const r = await asp(...a); if (r.code) throw new Error(`failed: asp ${a[2].join(" ")}\n${r.err || r.out}`); return r; };
const grab = (re, t) => { const m = re.exec(t); if (!m) throw new Error(`no match ${re} in ${t.slice(0, 200)}`); return m[1]; };

// Tokens for two tenants and an admin.
const tokenFile = `${dir}/tokens.json`;
const tok = {};
for (const [t, role] of [["team-a", "tenant"], ["team-b", "tenant"], ["ops", "admin"]]) {
  const r = await new Promise((res) => execFile(process.execPath, [MAIN, "serve", "token", "--tokens", tokenFile, "--tenant", t, "--role", role], { env: process.env }, (e, so) => res(so)));
  tok[t] = r.trim().split("\n")[1];
}
const serve = () => spawn(process.execPath, [MAIN, "serve", "--db", DB, "--tokens", tokenFile, "--port", String(port), "--packages", `${dir}/svc-packages`, "--commons", `${dir}/svc-commons`], { env: { ...process.env, ASP_HOME: `${dir}/svc-home` }, stdio: "ignore" });
let svc = serve();
await new Promise((r) => setTimeout(r, 3000));

const A = { home: `${dir}/a`, token: tok["team-a"] }, A2 = { home: `${dir}/a2`, token: tok["team-a"] }, B = { home: `${dir}/b`, token: tok["team-b"] }, OPS = { home: `${dir}/ops`, token: tok.ops };
for (const m of [A, A2, B, OPS]) mkdirSync(m.home, { recursive: true });
const [ALICE, BANK, CC, BOB, CX, REV] = [D("users:alice"), D("bank"), D("agents:coder-cc"), D("users:bob"), D("agents:coder-cx"), D("agents:reviewer")];
const proj = `${dir}/proj`;
mkdirSync(`${proj}/.claude`, { recursive: true });
writeFileSync(`${proj}/CLAUDE.md`, "# Notes project\n\nBe brief.\n");
writeFileSync(`${proj}/notes.txt`, "The magic word is pelican.\n");
writeFileSync(`${proj}/.claude/settings.json`, JSON.stringify({ permissions: { allow: ["Read"] } }));
mkdirSync(`${dir}/uhome`, { recursive: true });

await must(A.home, A.token, ["identity", "new", "--kind", "human", "--did", ALICE]);
await must(A.home, A.token, ["identity", "new", "--kind", "human", "--did", BANK]);
await must(A.home, A.token, ["identity", "new", "--kind", "agent", "--did", CC, "--sponsor", ALICE, "--purpose", "Answer questions from notes"]);
await must(B.home, B.token, ["identity", "new", "--kind", "human", "--did", BOB]);
await must(B.home, B.token, ["identity", "new", "--kind", "agent", "--did", CX, "--sponsor", BOB, "--purpose", "Answer questions from notes"]);
await must(B.home, B.token, ["identity", "new", "--kind", "agent", "--did", REV, "--sponsor", BOB, "--purpose", "Review shared lessons"]);
cpSync(`${A.home}/keys`, `${A2.home}/keys`, { recursive: true });
let granted = 0;
for (const [d, n] of [[ALICE, 3000], [CC, 400], [BOB, 2000], [CX, 400]]) { await must(OPS.home, OPS.token, ["credits", "grant", "--to", d, "--amount", String(n)]); granted += n; }
ev.check("two machines of different tenants share one log", /: 3000 credits/.test((await must(B.home, B.token, ["credits", "balance", ALICE])).out));

// Packages.
await must(A.home, A.token, ["pack", "--runtime", "claude-code", "--agent", CC, "--project", proj, "--user-home", `${dir}/uhome`, "--out", `${A.home}/cc.aspkg`]);
await must(A.home, A.token, ["package", "push", `${A.home}/cc.aspkg`, "--name", "cc"]);
await must(A2.home, A2.token, ["package", "pull", "cc", "--out", `${A2.home}/cc.aspkg`]);
const steal = await asp(B.home, B.token, ["package", "pull", "cc", "--out", `${B.home}/steal.aspkg`]);
ev.check("another tenant cannot pull the package", steal.code !== 0 && /no package cc/.test(steal.err));

// A contract that may share to the commons, and one that may not.
async function job(m, principal, agent, share) {
  const intent = grab(/^intent (\S+)/, (await must(m.home, m.token, ["market", "intent", "--by", principal, "--purpose", "Read notes", "--budget", "1000", "--deadline", "2099-01-01T00:00:00Z"])).out);
  const offer = grab(/^offer (\S+)/, (await must(m.home, m.token, ["market", "offer", "--by", agent, "--intent", intent, "--price", "1000", "--plan", "do it", "--eta", "2098-01-01T00:00:00Z"])).out);
  const c = grab(/^contract (\S+):/, (await must(m.home, m.token, ["market", "contract", "--principal", principal, "--bank", BANK, "--intent", intent, "--offer", offer])).out);
  await must(m.home, m.token, ["market", "bond", "--contract", c, "--backer", agent, "--amount", "200", "--escrow-payer", principal, "--escrow-amount", "1000"]);
  await must(m.home, m.token, ["market", "mandate", "--contract", c, "--principal", principal, "--performer", agent, "--scopes", "repo.read", ...(share ? ["--share-to-commons"] : [])]);
  return c;
}
const cNo = await job(A, ALICE, CC, false);
const cYes = await job(A, ALICE, CC, true);

// Two real runs of one agent at the same time on two machines.
const prompt = (file, fact) => `Use the Read tool on notes.txt. Then save a memory file named ${file} (with a one-line entry for it in MEMORY.md) recording this fact for next time: ${fact}. Do not run any commands. Reply in one short sentence.`;
const [ra, ra2] = await Promise.all([
  asp(A.home, A.token, ["run", `${A.home}/cc.aspkg`, "--backend", "claude-code", "--project", proj, "--contract", cYes, "--model", CLAUDE_MODEL, "--prompt", prompt("pelican-fact.md", "the magic word in notes.txt is pelican")]),
  asp(A2.home, A2.token, ["run", `${A2.home}/cc.aspkg`, "--backend", "claude-code", "--project", proj, "--model", CLAUDE_MODEL, "--prompt", prompt("notes-location.md", "this project keeps its facts in notes.txt, so read that file first")]),
]);
ev.check("both concurrent runs finished", ra.code === 0 && ra2.code === 0, `${ra.err.slice(-150)} | ${ra2.err.slice(-150)}`);
ev.check("saving a note under a repo.read Mandate is not a strike", !/strike/.test(ra.err), "memory writes must need no scope");

const pushA = await asp(A.home, A.token, ["package", "push", `${A.home}/cc.aspkg`, "--name", "cc"]);
const pushA2 = await asp(A2.home, A2.token, ["package", "push", `${A2.home}/cc.aspkg`, "--name", "cc"]);
if (pushA.code === 0 && pushA2.code !== 0) {
  ev.pass("the second push was refused as stale");
  ev.check("the refusal says how to merge", /pull <name> --out <your package> --merge/.test(pushA2.err));
  const merge = await asp(A2.home, A2.token, ["package", "pull", "cc", "--out", `${A2.home}/cc.aspkg`, "--merge"]);
  ev.check("the merge pull succeeded and re-signed", merge.code === 0 && /merged into the service's copy/.test(merge.err), merge.err.slice(-200));
  const topics = existsSync(`${A2.home}/cc.aspkg/memory/auto`) ? readdirSync(`${A2.home}/cc.aspkg/memory/auto`) : [];
  ev.check("both machines' lessons survived", topics.includes("pelican-fact.md") && topics.includes("notes-location.md"), topics.join(", "));
  ev.check("the merged package verifies", (await asp(A2.home, A2.token, ["verify", `${A2.home}/cc.aspkg`])).code === 0);
  ev.check("the next push goes through", (await asp(A2.home, A2.token, ["package", "push", `${A2.home}/cc.aspkg`, "--name", "cc"])).code === 0);
} else ev.inconclusive("both runs changed memory so a push could conflict", `push a: ${pushA.code}, push a2: ${pushA2.code} (one of the runs may not have saved a note)`);

// The commons across tenants.
const lesson = existsSync(`${A2.home}/cc.aspkg/memory/auto/pelican-fact.md`) ? `${A2.home}/cc.aspkg/memory/auto/pelican-fact.md` : `${A.home}/cc.aspkg/memory/auto/pelican-fact.md`;
if (existsSync(lesson)) {
  const refused = await asp(A.home, A.token, ["commons", "add", lesson, "--by", CC, "--title", "The magic word lives in notes.txt", "--contract", cNo]);
  ev.check("sharing is refused under a contract that does not allow it", refused.code !== 0 && /does not let/.test(refused.err));
  const added = await asp(A.home, A.token, ["commons", "add", lesson, "--by", CC, "--title", "The magic word lives in notes.txt", "--tag", "notes", "--contract", cYes]);
  ev.check("sharing is accepted under a contract that allows it", added.code === 0, added.err);
  const id = /(sha256:[0-9a-f]{64})/.exec(added.out)?.[1];
  if (id) {
    ev.check("the author cannot review itself", (await asp(A.home, A.token, ["commons", "review", id, "--by", CC, "--verdict", "endorse"])).code !== 0);
    await must(B.home, B.token, ["commons", "review", id, "--by", REV, "--verdict", "endorse"]);
    const second = await must(B.home, B.token, ["commons", "review", id, "--by", CX, "--verdict", "endorse"]);
    ev.check("two other agents' endorsements make it reviewed", /now reviewed/.test(second.out));
    await must(B.home, B.token, ["commons", "cite", id, "--by", CX, "--context", "used it to find the magic word"]);
    await must(A.home, A.token, ["commons", "cite", id, "--by", CC, "--context", "citing myself"]);
    ev.check("only the other agent's citation counts", /cited by 1 agent/.test((await must(A.home, A.token, ["commons", "show", id])).out));
  }
} else ev.inconclusive("the commons step", "no lesson file was saved by the runs");

// Conservation and restart.
const bal = async (m, d) => Number(grab(/: (\d+) credits/, (await must(m.home, m.token, ["credits", "balance", d])).out));
const sum = (await bal(A, ALICE)) + (await bal(A, CC)) + (await bal(B, BOB)) + (await bal(B, CX));
ev.check("credits are conserved (granted = balances + 2 escrows + 2 bonds)", sum + 2 * 1200 === granted, `granted ${granted}, balances ${sum}, locked ${2 * 1200}`);
const before = (await must(A.home, A.token, ["log", "verify"])).out.trim();
svc.kill();
await new Promise((r) => setTimeout(r, 1500));
const down = await asp(A.home, A.token, ["log", "verify"]);
ev.check("clients get a clear error while the service is down", down.code !== 0 && /cannot reach the log service/.test(down.err));
svc = serve();
await new Promise((r) => setTimeout(r, 3000));
const after = (await must(A.home, A.token, ["log", "verify"])).out.trim();
const afterB = (await must(B.home, B.token, ["log", "verify"])).out.trim();
ev.check("after a restart both machines see the same verified log", after === afterB && /log ok/.test(after) && after.split(" ")[2] === before.split(" ")[2], `${before.slice(0, 40)} -> ${after.slice(0, 40)}`);
ev.check("the packages are still there", /1 package\(s\)/.test((await must(A.home, A.token, ["package", "list"])).out));
svc.kill();
ev.finish();
