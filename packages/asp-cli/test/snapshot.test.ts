import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";

const ALICE = "did:web:example.com:users:alice";

function setup(env: NodeJS.ProcessEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), "asp-snap-"));
  const asp = async (args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ASP_SNAPSHOT_EVERY: "0", ...env }, cwd: home };
    const code = await main(args, io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  return { home, asp };
}
const ok = async (r: Promise<{ code: number; out: string; err: string }>) => { const x = await r; assert.equal(x.code, 0, x.err || x.out); return x; };

/** A log with identities and credits: several records plus a mint. */
async function populate(asp: ReturnType<typeof setup>["asp"], n: number, prefix = "p") {
  for (let i = 0; i < n; i++) await ok(asp(["identity", "new", "--kind", "human", "--did", `did:web:example.com:users:${prefix}${i}`]));
}

test("a snapshot lets the log open without replaying what it holds, and a full replay confirms its state", async () => {
  const { home, asp } = setup();
  await ok(asp(["identity", "new", "--kind", "human", "--did", ALICE]));
  await ok(asp(["credits", "grant", "--to", ALICE, "--amount", "500"]));
  await populate(asp, 5);
  const snap = await ok(asp(["log", "snapshot"]));
  assert.match(snap.out, /snapshot at seq 6/);
  assert.ok(existsSync(join(home, "snapshot.json")));

  await populate(asp, 2, "later");
  await ok(asp(["credits", "grant", "--to", ALICE, "--amount", "100"]));
  const log = await LocalLog.open(home, { ASP_SNAPSHOT_EVERY: "0" });
  assert.equal(log.openedFrom, "snapshot");
  assert.equal(log.replayed, 2, "only the two records after the snapshot were replayed");
  assert.equal(await log.log.balance(ALICE), 600, "a mint after the snapshot is applied");

  const full = await ok(asp(["log", "verify", "--full"]));
  assert.match(full.out, /full replay from genesis: 8 records re-verified; the state loaded from the snapshot matches/);
});

test("a snapshot whose state was altered opens fast but fails the full audit", async () => {
  const { home, asp } = setup();
  await ok(asp(["identity", "new", "--kind", "human", "--did", ALICE]));
  await ok(asp(["credits", "grant", "--to", ALICE, "--amount", "500"]));
  await ok(asp(["log", "snapshot"]));
  const file = join(home, "snapshot.json");
  const snap = JSON.parse(readFileSync(file, "utf8"));
  const accounts: [string, { did: string; balance: number }][] = snap.state.tables.accounts;
  accounts[0][1].balance = 999999;
  writeFileSync(file, JSON.stringify(snap));

  const live = await LocalLog.open(home, { ASP_SNAPSHOT_EVERY: "0" });
  assert.equal(live.openedFrom, "snapshot");
  assert.equal(await live.log.balance(ALICE), 999999, "the forged balance is what the snapshot-loaded log believes");
  const audit = await asp(["log", "verify", "--full"]);
  assert.equal(audit.code, 1);
  assert.match(audit.out, /the state DIFFERS/);
});

test("a snapshot that does not match the log (rewritten history) is ignored and the log is replayed in full", async () => {
  const { home, asp } = setup();
  await populate(asp, 4);
  await ok(asp(["log", "snapshot"]));
  // Rewrite history: swap two lines of the log, so the hash chain no longer matches the snapshot.
  const lines = readFileSync(join(home, "log.ndjson"), "utf8").trim().split("\n");
  [lines[1], lines[2]] = [lines[2], lines[1]];
  writeFileSync(join(home, "log.ndjson"), lines.join("\n") + "\n");
  // The reordered log is itself still a valid log here (independent identities), so it replays; the point is the snapshot is not trusted.
  const log = await LocalLog.open(home, { ASP_SNAPSHOT_EVERY: "0" });
  assert.equal(log.openedFrom, "replay");
  assert.equal(log.replayed, 4);

  // A corrupt snapshot file is also just ignored.
  writeFileSync(join(home, "snapshot.json"), "{ not json");
  assert.equal((await LocalLog.open(home, { ASP_SNAPSHOT_EVERY: "0" })).openedFrom, "replay");
});

test("the log snapshots itself every ASP_SNAPSHOT_EVERY records", async () => {
  const { home, asp } = setup({ ASP_SNAPSHOT_EVERY: "4" });
  await populate(asp, 3);
  assert.equal(existsSync(join(home, "snapshot.json")), false, "not yet: fewer than 4 records to replay");
  await populate(asp, 3, "more"); // the next open replays 3 + ... and crosses the threshold
  await ok(asp(["credits", "balance", ALICE]));
  assert.equal(existsSync(join(home, "snapshot.json")), true);
  const log = await LocalLog.open(home, { ASP_SNAPSHOT_EVERY: "4" });
  assert.equal(log.openedFrom, "snapshot");
  assert.equal((await ok(asp(["log", "verify", "--full"]))).code, 0);
});
