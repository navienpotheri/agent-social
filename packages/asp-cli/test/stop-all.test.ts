/**
 * `asp stop --all` (register row US1, the stop-all control): one command ends every running session on this machine, whichever agent it is for, and leaves ended sessions and the standing jobs alone. Fake sessions only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { main, type Io } from "../src/cli.ts";

async function asp(home: string, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home }, cwd: home } as Io;
  let code: number;
  try { code = await main(args, io); } catch (e) { code = 1; err.push((e as Error).message); }
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const start = (sid: string, agent: string) => JSON.stringify({ t: "start", sid, contract: `c-${sid}`, at: "2026-11-14T10:00:00Z", runtime: "claude-code", agent, me: "did:web:example.com:users:me", bank: "did:web:example.com:bank", purpose: `work ${sid}`, scopes: ["repo.write"] });
const end = (sid: string) => JSON.stringify({ t: "end", sid, contract: `c-${sid}`, at: "2026-11-14T10:05:00Z", state: "done", calls: 1, refused: [], tokens: 10, exitCode: 0 });

test("stop --all writes a stop file for every running session and none for an ended one, and says which", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-stop-all-"));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "runs.ndjson"), [start("aaaa1111", "did:web:example.com:agents:one"), start("bbbb2222", "did:web:example.com:agents:two"), start("cccc3333", "did:web:example.com:agents:three"), end("cccc3333")].join("\n") + "\n");
  const r = await asp(home, ["stop", "--all"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /stopping 2 sessions: .*aaaa1111.*bbbb2222/);
  assert.deepEqual(readdirSync(home).filter((n) => n.startsWith("stop-")).sort(), ["stop-aaaa1111", "stop-bbbb2222"]);
  assert.equal(existsSync(join(home, "stop-cccc3333")), false, "an ended session is left alone");
});

test("without --all two running sessions are still refused with a pointer to --all; --all with an id is a usage error; nothing running is not an error", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-stop-all-"));
  writeFileSync(join(home, "runs.ndjson"), [start("aaaa1111", "a"), start("bbbb2222", "b")].join("\n") + "\n");
  const two = await asp(home, ["stop"]);
  assert.notEqual(two.code, 0);
  assert.match(two.err, /asp stop --all/);
  assert.equal(readdirSync(home).some((n) => n.startsWith("stop-")), false, "nothing was stopped by the refusal");
  assert.notEqual((await asp(home, ["stop", "aaaa", "--all"])).code, 0);
  const none = mkdtempSync(join(tmpdir(), "asp-stop-none-"));
  const r = await asp(none, ["stop", "--all"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /nothing is running/);
});
