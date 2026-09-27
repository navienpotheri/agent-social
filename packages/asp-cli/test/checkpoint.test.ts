import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Keystore, LocalLog, signCheckpoint } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const HUMAN = "did:web:example.com:users:navien";
const AGENT = "did:web:example.com:agents:coder";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function setup(f = makeFixture()) {
  assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", HUMAN])).code, 0);
  assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", HUMAN])).code, 0);
  return f;
}

test("log checkpoint signs the current head and appends it; log verify accepts it", async () => {
  const f = await setup();
  const res = await asp(f, ["log", "checkpoint", "--as", HUMAN]);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /checkpoint seq 2 signed by /);
  assert.match(res.out, /not published anywhere yet/);

  const file = join(f.aspHome, "checkpoints.ndjson");
  const [cp] = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(cp.seq, 2);
  assert.ok(cp.sig);

  const verified = await asp(f, ["log", "verify"]);
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.out, /log ok: 2 records/);
  assert.match(verified.out, /checkpoint seq 2 .*: ok/);
});

test("a checkpoint taken partway through the log still verifies after more records are added", async () => {
  const f = await setup();
  await asp(f, ["log", "checkpoint", "--as", HUMAN]); // seq 2, before the agent's node/lineage activity exists
  await asp(f, ["identity", "new", "--kind", "agent", "--did", "did:web:example.com:agents:second", "--sponsor", HUMAN]);
  const verified = await asp(f, ["log", "verify"]);
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.out, /log ok: 3 records/);
  assert.match(verified.out, /checkpoint seq 2 .*: ok/);
});

test("log verify fails a validly-signed checkpoint that simply claims the wrong hash", async () => {
  const f = await setup();
  await asp(f, ["log", "checkpoint", "--as", HUMAN]); // establishes the log at its real state
  const local = await LocalLog.open(f.aspHome);
  const signer = new Keystore(f.aspHome).forDid(HUMAN)!;
  const head = await local.log.head();
  const wrong = signCheckpoint({ seq: head.seq, logHash: "sha256:" + "f".repeat(64) }, signer);
  writeFileSync(join(f.aspHome, "checkpoints.ndjson"), JSON.stringify(wrong) + "\n");

  const res = await asp(f, ["log", "verify"]);
  assert.equal(res.code, 1);
  assert.match(res.out, /log ok: 2 records/, "the log itself is still fine");
  assert.match(res.out, /checkpoint seq 2 .*: FAILED \(hash mismatch\)/, "a genuine signature over a false claim is still caught");
});

test("log verify fails a checkpoint whose signature was forged", async () => {
  const f = await setup();
  await asp(f, ["log", "checkpoint", "--as", HUMAN]);
  const file = join(f.aspHome, "checkpoints.ndjson");
  const cp = JSON.parse(readFileSync(file, "utf8").trim());
  cp.sig = cp.sig.slice(0, -4) + "AAAA";
  writeFileSync(file, JSON.stringify(cp) + "\n");

  const res = await asp(f, ["log", "verify"]);
  assert.equal(res.code, 1);
  assert.match(res.out, /checkpoint seq 2 .*: FAILED \(bad signature\)/);
});

test("without --as, checkpoint is a usage error; with an unknown did, a plain error", async () => {
  const f = await setup();
  assert.equal((await asp(f, ["log", "checkpoint"])).code, 2);
  const res = await asp(f, ["log", "checkpoint", "--as", "did:web:example.com:users:nobody"]);
  assert.equal(res.code, 1);
  assert.match(res.err, /no key for did:web:example.com:users:nobody/);
});
