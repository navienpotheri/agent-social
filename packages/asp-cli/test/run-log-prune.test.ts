/**
 * Run-log retention (register row E6): `asp run-log prune --days n` lists the run logs on this machine older than n days and, with --yes, deletes them; newer ones and the folder's other files stay.
 * Fake run logs only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";

async function asp(home: string, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home }, cwd: home } as Io;
  let code: number;
  try { code = await main(args, io); } catch (e) { code = 1; err.push((e as Error).message); }
  return { code, out: out.join("\n"), err: err.join("\n") };
}
function world() {
  const home = mkdtempSync(join(tmpdir(), "asp-prune-"));
  const mk = (name: string, ageDays: number) => {
    const dir = join(home, "runs", name); mkdirSync(dir, { recursive: true });
    const f = join(dir, "run-log.ndjson"); writeFileSync(f, "{}\n"); writeFileSync(join(dir, "gateway.log"), "x");
    const t = new Date(Date.now() - ageDays * 86_400_000); utimesSync(f, t, t);
    return f;
  };
  return { home, old: mk("claude-code-2026-08-01T100000Z", 100), mid: mk("claude-code-2026-10-01T100000Z", 40), fresh: mk("claude-code-2026-11-13T100000Z", 1) };
}

test("without --yes it lists the old run logs and deletes nothing; with --yes it deletes exactly those, and the rest of the folder stays", async () => {
  const w = world();
  const plan = await asp(w.home, ["run-log", "prune", "--days", "30"]);
  assert.equal(plan.code, 0, plan.err);
  assert.match(plan.out, /would delete.*2026-08-01/);
  assert.match(plan.out, /would delete.*2026-10-01/);
  assert.doesNotMatch(plan.out, /2026-11-13/);
  assert.match(plan.out, /2 run logs would be deleted/);
  assert.ok(existsSync(w.old) && existsSync(w.mid), "a plan changes nothing");
  const done = await asp(w.home, ["run-log", "prune", "--days", "30", "--yes"]);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /deleted 2 run logs/);
  assert.equal(existsSync(w.old) || existsSync(w.mid), false);
  assert.ok(existsSync(w.fresh), "a newer log stays");
  assert.ok(existsSync(join(w.home, "runs", "claude-code-2026-08-01T100000Z", "gateway.log")), "only the log file goes, not the folder's other files");
});

test("a bad or missing --days is a usage error, and nothing older than the limit is a plain answer", async () => {
  const w = world();
  assert.notEqual((await asp(w.home, ["run-log", "prune"])).code, 0);
  assert.notEqual((await asp(w.home, ["run-log", "prune", "--days", "soon"])).code, 0);
  const none = await asp(w.home, ["run-log", "prune", "--days", "365", "--yes"]);
  assert.equal(none.code, 0);
  assert.match(none.out, /no run log older than 365 days/);
  assert.ok(existsSync(w.old));
});
