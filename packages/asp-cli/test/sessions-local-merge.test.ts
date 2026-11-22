// Found in the owner's first real run (2026-11-22): a home that already held old sessions never looked at <home>/local, where `asp run --local` keeps its own index, so tonight's sessions were not listed, not found by id,
// not stopped by asp stop --all, and `asp live report` with no id showed an old run. The sessions of the home and of <home>/local are one list, newest first; each is read and stopped where it lives; the report says which
// session it is reporting. Synthetic index lines, fake names, no secrets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const AGENT = "did:web:example.com:agents:coder", ME = "did:web:example.com:users:ada", BANK = "did:web:example.com:bank";
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const start = (sid: string, at: string, runtime: string, purpose: string) => JSON.stringify({ t: "start", pid: 1, sid, contract: "sha256:" + "c".repeat(64), at, runtime, agent: AGENT, me: ME, bank: BANK, purpose, scopes: ["repo.read"], hosts: [] }) + "\n";
const end = (sid: string, at: string, state: string, calls: number, refused: string[]) => JSON.stringify({ t: "end", sid, contract: "sha256:" + "c".repeat(64), at, state, calls, refused, tokens: 100, exitCode: 0 }) + "\n";
function fixture(): Fixture {
  const f = makeFixture();
  mkdirSync(join(f.aspHome, "local"), { recursive: true });
  // fourteen old sessions in the home itself, 32 days ago (the owner's real home)
  for (let i = 0; i < 14; i++) { const sid = "old" + String(i).padStart(5, "0"); const at = `2026-10-21T10:${String(i).padStart(2, "0")}:00Z`; appendFileSync(join(f.aspHome, "runs.ndjson"), start(sid, at, "claude-code", "an old task") + end(sid, at.replace(":00Z", ":30Z"), "ended", 11, ["x"])); }
  // tonight's sessions in the local index
  appendFileSync(join(f.aspHome, "local", "runs.ndjson"), start("36f6fb95", "2026-11-22T08:41:23Z", "claude-code", "List the files, then run curl") + end("36f6fb95", "2026-11-22T08:42:00Z", "ended", 2, ["shell.network"]));
  appendFileSync(join(f.aspHome, "local", "runs.ndjson"), start("61ed67fe", "2026-11-22T08:50:00Z", "codex", "a Codex task") + end("61ed67fe", "2026-11-22T08:50:30Z", "failed", 0, []));
  return f;
}

test("asp runs lists tonight's local sessions first, then the home's old ones; an id from either index is found", async () => {
  const f = fixture();
  const r = await asp(f, ["runs"]);
  assert.equal(r.code, 0, r.err);
  const lines = r.out.split("\n").filter((l) => /^\s+\w{8}\s/.test(l));
  assert.deepEqual(lines.slice(0, 2).map((l) => l.trim().split(/\s+/)[0]), ["61ed67fe", "36f6fb95"], "newest first, local sessions included");
  assert.equal(lines.length, 15, "fifteen shown by default: the two new and thirteen old");
  assert.match(r.out, /details: asp runs 61ed67fe/);
  const one = await asp(f, ["runs", "36f6fb95"]);
  assert.equal(one.code, 0, one.err);
  assert.match(one.out, /session 36f6fb95/);
  assert.match(one.out, /task\s+List the files, then run curl/);
  const old = await asp(f, ["runs", "old00003"]);
  assert.equal(old.code, 0, old.err);
  assert.match(old.out, /session old00003/);
  assert.equal((await asp(f, ["runs", "--all"])).out.split("\n").filter((l) => /^\s+\w{8}\s/.test(l)).length, 16);
});

test("asp live report with no id reports the NEWEST session and says which; --session reports the one named, from either index", async () => {
  const f = fixture();
  const r = await asp(f, ["live", "report"]);
  assert.equal(r.code === 0 || r.code === 1, true, r.err);
  assert.match(r.out, /reporting the newest session, 61ed67fe/);
  assert.match(r.out, /live run 61ed67fe: failed/);
  const named = await asp(f, ["live", "report", "--session", "36f6fb95"]);
  assert.match(named.out, /live run 36f6fb95: ended/);
  assert.match(named.out, /2 judged|calls\s+2/);
  assert.doesNotMatch(named.out, /reporting the newest session/, "a named session is not called the newest");
  const old = await asp(f, ["live", "report", "--session", "old00001"]);
  assert.match(old.out, /live run old00001: ended/);
  assert.notEqual((await asp(f, ["live", "report", "--session", "nope"])).code, 0);
});

test("asp stop --all writes each stop file where its session's gateway looks: the local one under <home>/local, the home's own under the home", async () => {
  const f = makeFixture();
  mkdirSync(join(f.aspHome, "local"), { recursive: true });
  appendFileSync(join(f.aspHome, "runs.ndjson"), start("aaaa1111", new Date().toISOString(), "claude-code", "a run in the home"));
  appendFileSync(join(f.aspHome, "local", "runs.ndjson"), start("bbbb2222", new Date().toISOString(), "claude-code", "a local run"));
  const r = await asp(f, ["stop", "--all"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /stopping 2 sessions/);
  assert.ok(existsSync(join(f.aspHome, "stop-aaaa1111")), "the home's own session");
  assert.ok(existsSync(join(f.aspHome, "local", "stop-bbbb2222")), "the local session, where its gateway looks");
  assert.ok(!existsSync(join(f.aspHome, "stop-bbbb2222")));
  // one session by id
  const g = makeFixture(); mkdirSync(join(g.aspHome, "local"), { recursive: true });
  appendFileSync(join(g.aspHome, "local", "runs.ndjson"), start("cccc3333", new Date().toISOString(), "codex", "x"));
  assert.equal((await asp(g, ["stop", "cccc"])).code, 0);
  assert.ok(existsSync(join(g.aspHome, "local", "stop-cccc3333")));
});

test("a home with only a local index, and one with none, still behave", async () => {
  const f = makeFixture(); mkdirSync(join(f.aspHome, "local"), { recursive: true });
  appendFileSync(join(f.aspHome, "local", "runs.ndjson"), start("dddd4444", "2026-11-22T09:00:00Z", "claude-code", "only local") + end("dddd4444", "2026-11-22T09:00:10Z", "ended", 1, []));
  assert.match((await asp(f, ["runs"])).out, /dddd4444/);
  assert.match((await asp(f, ["live", "report"])).out, /live run dddd4444/);
  const none = makeFixture();
  assert.match((await asp(none, ["runs"])).out, /no sessions yet/);
  assert.notEqual((await asp(none, ["live", "report"])).code, 0);
});
