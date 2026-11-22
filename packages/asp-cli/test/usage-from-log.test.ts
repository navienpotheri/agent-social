// Register row O17: the usage counts are the log's own. At start the service raises each tenant's count to what the log holds for the identities that tenant wrote as, so a lost usage file, or records written before
// the service counted, do not give a tenant a quota it has already used; the counts never go down; records whose issuer no tenant owns count to nobody. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken, UsageStore, usageFromLog } from "@agent-social/asp-log";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("O17: usageFromLog counts each record to the tenant that owns its issuer, with the record's own size, and counts an unowned issuer to nobody", async () => {
  const recs = [
    { seq: 1, record: { issuer: "did:a", body: "x" } }, { seq: 2, record: { issuer: "did:b", body: "yy" } },
    { seq: 3, record: { issuer: "did:a", body: "z" } }, { seq: 4, record: { issuer: "did:stranger", body: "w" } }, { seq: 5, record: { issuer: "did:a2", body: "v" } },
  ];
  const calls: number[] = [];
  const since = async (after: number, limit: number) => { calls.push(after); assert.ok(limit > 0); return recs.filter((r) => r.seq > after).slice(0, 2); }; // pages of two
  const out = await usageFromLog(since as never, { alpha: ["did:a", "did:a2"], beta: ["did:b"] });
  assert.deepEqual(Object.keys(out).sort(), ["alpha", "beta"], "the stranger belongs to nobody");
  assert.equal(out.alpha.records, 3);
  assert.equal(out.beta.records, 1);
  assert.equal(out.alpha.bytes, [recs[0], recs[2], recs[4]].reduce((n, r) => n + JSON.stringify(r.record).length, 0));
  assert.deepEqual(calls, [0, 2, 4, 5], "the log is read in pages until it ends");
});

test("O17: reconcile raises a count to the log's and never lowers it, and says how many tenants it raised", () => {
  const u = new UsageStore();
  u.add("alpha", 5, 1000);
  u.add("beta", 1, 50);
  assert.equal(u.reconcile({ alpha: { records: 3, bytes: 2000 }, beta: { records: 1, bytes: 50 }, gamma: { records: 4, bytes: 9 } }), 2, "alpha's bytes and gamma are raised; beta is already equal");
  assert.deepEqual(u.get("alpha"), { records: 5, bytes: 2000 }, "records stay at the higher count, bytes rise to the log's");
  assert.deepEqual(u.get("beta"), { records: 1, bytes: 50 });
  assert.deepEqual(u.get("gamma"), { records: 4, bytes: 9 });
  assert.equal(u.reconcile({ alpha: { records: 0, bytes: 0 } }), 0, "a lower count raises nothing");
});

test("O17: a service started on a log that already holds a tenant's records, with no usage file, counts them", async () => {
  const f = makeFixture();
  mkdirSync(f.aspHome, { recursive: true });
  setClock(() => new Date("2026-11-22T10:00:00Z"));
  const call = async (args: string[]) => { const out: string[] = []; const code = await main(args, { out: (l) => out.push(l), err: () => {}, env: { ASP_HOME: f.aspHome }, cwd: f.root } as Io); assert.equal(code, 0, args.join(" ")); return out.join("\n"); };
  const P = "did:web:example.com:users:uf-sponsor", A = "did:web:example.com:agents:uf-agent";
  await call(["identity", "new", "--kind", "human", "--did", P]);
  await call(["identity", "new", "--kind", "agent", "--did", A, "--sponsor", P, "--purpose", "work"]);
  setClock(undefined);
  const dir = mkdtempSync(join(tmpdir(), "asp-usage-log-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "alpha", role: "tenant", tokenSha256: hashToken("tok-alpha") }, { name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  writeFileSync(`${tokens}.dids.json`, JSON.stringify({ alpha: [P, A] }));
  assert.equal(existsSync(`${tokens}.usage.json`), false, "no usage file yet");
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${f.aspHome}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  try {
    await new Promise<void>((resolve, reject) => { server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); }); server.on("close", () => reject(new Error(`the service exited: ${buf}`))); setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000); });
    assert.match(buf, /usage counts raised from the log for 1 tenant/);
    const usage = JSON.parse(readFileSync(`${tokens}.usage.json`, "utf8")) as Record<string, { records: number; bytes: number }>;
    assert.ok(usage.alpha.records >= 2, `alpha's passports are counted: ${JSON.stringify(usage)}`);
    assert.ok(usage.alpha.bytes > 0);
    assert.equal(usage.ops, undefined, "a tenant that owns no identity has nothing counted");
  } finally { server.kill(); }
});
