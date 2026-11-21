/**
 * The city's restore drill, as far as it can be run without the host (register row GV6; docs/deploy/restore-drill.sh is the drill on the server): a log with identities, credits, a job and a slash is copied as a backup would
 * copy it, the copy is opened and replayed from genesis, and it must come out the same (head, credit audit, balances, every record verified); a snapshot is not needed; and a damaged copy is REFUSED or fails verification,
 * so a corrupt backup is found by the drill and not by the first user. What this does not test: the database dump, the nightly job, the disk, the service process and the time it takes on a real database (the drill on the host). Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalLog } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const P = "did:web:example.com:users:rd-principal", S = "did:web:example.com:users:rd-sponsor", B = "did:web:example.com:bank-rd", A = "did:web:example.com:agents:rd-agent";

test("GV6: a copied log directory replays from genesis to the same head, audit and balances; a damaged copy is found", async () => {
  const f = makeFixture();
  let clock = Date.parse("2026-11-20T00:00:00Z");
  setClock(() => new Date(clock));
  const call = async (args: string[]) => {
    clock += 60_000;
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root } as Io);
    assert.equal(code, 0, `${args.join(" ")}: ${err.join(" ") || out.join(" ")}`);
    return out.join("\n");
  };
  try {
    for (const d of [P, S, B]) await call(["identity", "new", "--kind", "human", "--did", d]);
    await call(["identity", "new", "--kind", "agent", "--did", A, "--sponsor", S, "--purpose", "a drill job"]);
    await call(["credits", "grant", "--to", P, "--amount", "200"]);
    await call(["credits", "grant", "--to", A, "--amount", "50"]);
    const intent = /^intent (\S+)/.exec(await call(["market", "intent", "--by", P, "--purpose", "a drill", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"]))![1];
    const offer = /^offer (\S+)/.exec(await call(["market", "offer", "--by", A, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"]))![1];
    const contract = /^contract (\S+):/.exec(await call(["market", "contract", "--principal", P, "--bank", B, "--intent", intent, "--offer", offer]))![1];
    await call(["market", "bond", "--contract", contract, "--backer", A, "--amount", "20", "--escrow-payer", P, "--escrow-amount", "100"]);
    await call(["market", "mandate", "--contract", contract, "--principal", P, "--performer", A, "--scopes", "repo.read"]);
    await call(["market", "settle", "--contract", contract, "--bank", B, "--basis", "revoked", "--principal", P, "--escrow-released", "0", "--bond-slashed", "10", "--bond-returned", "10", "--pro-rata", "0"]).catch(() => "");
  } finally { setClock(undefined); }

  // the "backup": the whole directory, copied while the service is stopped
  const root = mkdtempSync(join(tmpdir(), "asp-restore-drill-"));
  const restored = join(root, "restored");
  cpSync(f.aspHome, restored, { recursive: true });
  for (const name of readdirSync(restored)) if (/snapshot/i.test(name)) rmSync(join(restored, name), { recursive: true, force: true }); // a restore does not trust a snapshot

  const live = await LocalLog.openFull(f.aspHome);
  const back = await LocalLog.openFull(restored);
  const [hl, hb] = [await live.log.head(), await back.log.head()];
  assert.ok(hl.seq > 8, `a real log of ${hl.seq} records`);
  assert.deepEqual(hb, hl, "the restored log has the same head (sequence and log hash)");
  assert.deepEqual(await back.log.creditAudit(), await live.log.creditAudit(), "the same credit audit: the supply rule holds the same way");
  for (const d of [P, S, A, B]) assert.equal(await back.log.balance(d), await live.log.balance(d), `${d} balance`);
  assert.equal((await back.log.verify()).ok, true, "every record, signature and chain link verifies in the restored copy");

  // a damaged backup: one record's body is changed; the drill must find it
  const damaged = join(root, "damaged");
  cpSync(f.aspHome, damaged, { recursive: true });
  const file = join(damaged, "log.ndjson");
  const text = readFileSync(file, "utf8");
  assert.ok(text.includes("a drill job"), "the record to damage is in the file");
  writeFileSync(file, text.replace("a drill job", "a drill jab"));
  let found = false;
  try { const bad = await LocalLog.openFull(damaged); found = !(await bad.log.verify()).ok; } catch { found = true; }
  assert.equal(found, true, "a changed record is refused at replay or fails verification: the drill finds a corrupt backup");

  // a truncated backup (the last records missing) opens but is SHORTER: the drill compares the head with the live one
  const short = join(root, "short");
  cpSync(f.aspHome, short, { recursive: true });
  const lines = readFileSync(join(short, "log.ndjson"), "utf8").split("\n").filter((l) => l.trim());
  writeFileSync(join(short, "log.ndjson"), lines.slice(0, lines.length - 2).join("\n") + "\n");
  const cut = await LocalLog.openFull(short);
  assert.ok((await cut.log.head()).seq < hl.seq, "a truncated backup is shorter than the live log: comparing heads finds it");
  rmSync(root, { recursive: true, force: true });
});
