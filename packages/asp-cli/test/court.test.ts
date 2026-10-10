import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function asp(f: Fixture, args: string[], env: Record<string, string>) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ALICE = "did:web:example.com:users:alice", CODER = "did:web:example.com:agents:alice-coder", BANK = "did:web:example.com:users:bank";
const COURT = "did:web:court.example.com:court";

test("the beta's court: tenants cannot seat jurors, the operator seats three and rules a real dispute with keys held on its own machine, and no ruling is accepted before a court exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-court-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([
    { name: "team-a", role: "tenant", tokenSha256: hashToken("tok-a"), signup: { at: "2026-10-11T00:00:00Z", addressHash: "x", termsVersion: "v1", google: { sub: "g-1", email: "a@example.org" } } },
    { name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") },
  ]));
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const A = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-a" }, OPS = { ASP_LOG_URL: url, ASP_LOG_TOKEN: "tok-ops" };
    const a = makeFixture(), ops = makeFixture();
    for (const [kind, did, sponsor] of [["human", ALICE, undefined], ["agent", CODER, ALICE], ["human", BANK, undefined]] as const) {
      assert.equal((await asp(a, ["identity", "new", "--kind", kind, "--did", did, ...(sponsor ? ["--sponsor", sponsor, "--purpose", "Fix the flaky test"] : [])], A)).code, 0);
    }
    // No court yet.
    const none = await asp(ops, ["court", "status"], OPS);
    assert.equal(none.code, 1);
    assert.match(none.out, /0 juror\(s\) seated/);
    assert.match(none.out, /fewer than 3 jurors are seated/);
    // A tenant cannot seat itself as a juror.
    await asp(a, ["credits", "grant", "--to", ALICE, "--amount", "1"], A); // not an admin: refused, not needed below
    const self = await asp(a, ["market", "juror", "register", "--by", ALICE, "--stake", "100"], A);
    assert.equal(self.code, 1);
    assert.match(self.err, /during the beta the court's panel is run by the operator/);

    // A dispute with no court: the ruling is refused (the mocked "any neutral DID" fallback is never used on the service).
    const job = async (args: string[]) => { const r = await asp(a, args, A); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err}`); return r; };
    const intent = /^intent (\S+)/.exec((await job(["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "0", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
    const offer = /^offer (\S+)/.exec((await job(["market", "offer", "--by", CODER, "--intent", intent, "--price", "0", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
    const contract = /^contract (\S+):/.exec((await job(["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
    await job(["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "0", "--escrow-payer", ALICE, "--escrow-amount", "0"]);
    await job(["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER]);
    await job(["market", "deliver", "--contract", contract, "--by", CODER, "--summary", "First attempt"]);
    await job(["market", "reject", "--contract", contract, "--by", ALICE, "--reasons", "not good enough"]);
    const early = await asp(a, ["market", "rule", "--contract", contract, "--by", BANK, "--verdict", "for_performer", "--fault", `${ALICE}=1000`], A);
    assert.equal(early.code, 1);
    assert.match(early.err, /no court panel can be drawn for this dispute/);

    // The operator seats the court; the docket shows the dispute and a panel whose keys the operator holds.
    const seat = await asp(ops, ["court", "seat", "--count", "3", "--stake", "100", "--base", COURT], OPS);
    assert.equal(seat.code, 0, seat.err);
    assert.match(seat.out, /seated did:web:court\.example\.com:court:juror-1 with 100 credits staked/);
    const status = await asp(ops, ["court", "status"], OPS);
    assert.equal(status.code, 0);
    assert.match(status.out, /3 juror\(s\) seated, 3 with keys on this machine/);
    const docket = await asp(ops, ["court", "docket"], OPS);
    assert.match(docket.out, new RegExp(`${contract.replace(/[.]/g, "\\.")}: ${ALICE} v ${CODER}; panel .*court:juror-\\d \\(key held\\)`));
    assert.match(docket.out, /1 open dispute\(s\)/);
    // Seating again changes nothing.
    assert.match((await asp(ops, ["court", "seat", "--count", "3", "--stake", "100", "--base", COURT], OPS)).out, /already seated/);

    // The operator rules with the keys it holds; a party's agent cannot, and the job settles on the ruling.
    const ruled = await asp(ops, ["court", "rule", "--contract", contract, "--verdict", "for_performer", "--fault", `${ALICE}=1000`], OPS);
    assert.equal(ruled.code, 0, ruled.err);
    assert.match(ruled.out, /ruling .* on contract .*: for_performer/);
    const settle = await asp(a, ["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "ruling", "--escrow-released", "0", "--bond-returned", "0", "--bond-slashed", "0"], A);
    assert.equal(settle.code, 0, settle.err);
    assert.match(settle.out, /state Settled/);
    assert.match((await asp(ops, ["court", "docket"], OPS)).out, /0 open dispute\(s\)/);
  } finally {
    server.kill();
  }
});
