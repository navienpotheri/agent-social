import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const ALICE = "did:web:example.com:users:alice", CODER = "did:web:example.com:agents:alice-coder", BANK = "did:web:example.com:users:bank", STRANGER = "did:web:example.com:users:nobody";

const tenant = (name: string, token: string, google?: string) => ({
  name, role: "tenant", tokenSha256: hashToken(token), createdAt: "2026-10-11T00:00:00Z",
  ...(google ? { signup: { at: "2026-10-11T00:00:00Z", addressHash: "x".repeat(24), termsVersion: "v1", google: { sub: google, email: `${name}@example.org` } } } : {}),
});

// Gap M9: the grant is 100 at once for each of two identities (enough for a first job), and 400 more each when one of them has had a job accepted; a full pool puts a tenant on a waiting list the operator serves by topping it up.
test("a newcomer's first job: a Google-verified tenant claims the first part of its starter credits once (per tenant and per Google account), runs a first job end to end, and gets the rest when the job is accepted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-starter-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([
    tenant("team-a", "tok-a", "g-1"), tenant("team-b", "tok-b", "g-1"), tenant("team-c", "tok-c", "g-2"), tenant("team-d", "tok-d"),
    { name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") },
  ]));
  // A pool of exactly one whole grant (two identities, 500 each).
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--starter-pool", "1000"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const env = (token: string) => ({ ASP_LOG_URL: url, ASP_LOG_TOKEN: token });
    const a = makeFixture(), d = makeFixture();
    const A = env("tok-a");
    for (const [kind, did, sponsor] of [["human", ALICE, undefined], ["agent", CODER, ALICE], ["human", BANK, undefined]] as const) {
      assert.equal((await asp(a, ["identity", "new", "--kind", kind, "--did", did, ...(sponsor ? ["--sponsor", sponsor, "--purpose", "Fix the flaky test"] : [])], A)).code, 0);
    }

    // No Google account behind the tenant: no starter credits.
    const noGoogle = await asp(d, ["account", "show"], env("tok-d"));
    assert.match(noGoogle.out, /starter credits: not available: starter credits go to tenants that signed up with a verified Google account/);
    assert.equal((await asp(d, ["account", "starter", "--did", ALICE], env("tok-d"))).code, 1);

    // Available to team-a; refused for an identity it did not write, for too many, and without any.
    assert.match((await asp(a, ["account", "show"], A)).out, /starter credits: available: 100 now for each of up to 2 of your identities, and 400 more each after a job of theirs is accepted/);
    const stranger = await asp(a, ["account", "starter", "--did", STRANGER], A);
    assert.equal(stranger.code, 1);
    assert.match(stranger.err, /is not an identity this tenant has written as/);
    assert.equal((await asp(a, ["account", "starter", "--did", `${ALICE},${CODER},${BANK}`], A)).code, 1, "at most two identities");
    assert.equal((await asp(a, ["account", "starter"], A)).code, 2);
    // Claimed once.
    const claim = await asp(a, ["account", "starter", "--did", `${ALICE},${CODER}`], A);
    assert.equal(claim.code, 0, claim.err);
    assert.match(claim.out, /users:alice: \+100 credits \(balance 100\)/);
    assert.match(claim.out, /100 each is enough for a first job.*The other 400 each comes when one of these identities has a job accepted/);
    assert.match((await asp(a, ["credits", "balance", ALICE], A)).out, /100 credits/);
    assert.match((await asp(a, ["credits", "balance", CODER], A)).out, /100 credits/);
    assert.equal((await asp(a, ["account", "starter", "--did", ALICE], A)).code, 1, "a second claim is refused");
    assert.match((await asp(a, ["account", "show"], A)).out, /starter credits: 200 so far; 100 each so far; the other 400 each comes when one of those identities has a job accepted/);
    assert.match((await asp(a, ["credits", "balance", CODER], A)).out, /100 credits/, "looking at the account released nothing: no job has been accepted");

    // The same Google account on another tenant: no second grant. Another Google account: the pool has room for the first part (800 of 1000 is still free).
    assert.match((await asp(a, ["account", "show"], env("tok-b"))).out, /this Google account has already claimed its starter credits/);
    assert.match((await asp(a, ["account", "show"], env("tok-c"))).out, /starter credits: available/);

    // A first job within a newcomer's limits: price 100, escrow 100, a bond of 100, accepted and paid.
    const job = async (args: string[]) => { const r = await asp(a, args, A); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err}`); return r; };
    const intent = /^intent (\S+)/.exec((await job(["market", "intent", "--by", ALICE, "--purpose", "First job", "--budget", "100", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
    const offer = /^offer (\S+)/.exec((await job(["market", "offer", "--by", CODER, "--intent", intent, "--price", "100", "--plan", "do it", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
    const contract = /^contract (\S+):/.exec((await job(["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
    await job(["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "100", "--escrow-payer", ALICE, "--escrow-amount", "100"]);
    await job(["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--spend-cap", "100"]);
    await job(["market", "deliver", "--contract", contract, "--by", CODER, "--summary", "Done"]);
    await job(["market", "accept", "--contract", contract, "--by", ALICE]);
    await job(["market", "settle", "--contract", contract, "--bank", BANK, "--basis", "accepted", "--escrow-released", "100", "--bond-returned", "100", "--bond-slashed", "0"]);
    assert.match((await asp(a, ["credits", "balance", CODER], A)).out, /200 credits/, "100 - 100 bond + 100 paid + 100 bond back");
    assert.match((await asp(a, ["credits", "balance", ALICE], A)).out, /\b0 credits/, "100 - 100 escrow");

    // The job was accepted: looking at the account releases the other 400 each, once.
    const released = await asp(a, ["account", "show"], A);
    assert.match(released.out, /starter credits: claimed \(1000\)/);
    assert.match((await asp(a, ["credits", "balance", CODER], A)).out, /600 credits/, "200 + 400 released");
    assert.match((await asp(a, ["credits", "balance", ALICE], A)).out, /400 credits/);
    assert.match((await asp(a, ["account", "show"], A)).out, /starter credits: claimed \(1000\)/);
    assert.match((await asp(a, ["credits", "balance", ALICE], A)).out, /400 credits/, "released once, not again");
    assert.equal(JSON.parse(readFileSync(`${tokens}.starter.json`, "utf8")).minted, 1000);

    // The pool is now whole-grant used up. A newcomer is put on the waiting list, in order; the operator tops the pool up on purpose, and then it is their turn.
    assert.match((await asp(a, ["account", "show"], env("tok-c"))).out, /starter credits: the starter pool is full right now; asp account starter puts you on the waiting list/);
    const waits = await asp(a, ["account", "starter", "--did", ALICE], env("tok-c"));
    assert.equal(waits.code, 1);
    assert.match(waits.err, /You are number 1 on the waiting list/);
    assert.match((await asp(a, ["account", "show"], env("tok-c"))).out, /you are number 1 on the waiting list for the starter pool/);
    const ops = env("tok-ops");
    const status = await asp(a, ["serve", "starter", "--tokens", tokens], ops);
    assert.match(status.out, /starter pool: 1000 credits, 1000 given out, 0 left; 1 tenant\(s\) waiting: team-c/);
    const topUp = await asp(a, ["serve", "starter", "--tokens", tokens, "--add", "300"], ops);
    assert.match(topUp.out, /the starter pool is now 1300 credits \(it was 1000\)/);
    assert.match(topUp.out, /300 left; 1 tenant\(s\) waiting: team-c/);
    assert.match(topUp.out, /room for the first on the list/);
    assert.match((await asp(a, ["account", "show"], env("tok-c"))).out, /starter credits: available/, "the running service read the new size without a restart");
    assert.equal((await asp(a, ["serve", "starter", "--tokens", tokens, "--add", "0"], ops)).code, 2);

    // Closing the account does not make a second grant possible for the same Google account (the tombstone keeps the claim).
    assert.equal((await asp(a, ["account", "close", "--confirm", "team-a", "--skip-export"], A)).code, 0);
    assert.match((await asp(a, ["account", "show"], env("tok-b"))).out, /this Google account has already claimed its starter credits/);
    const stone = (JSON.parse(readFileSync(tokens, "utf8")) as any[]).find((t) => t.name === "team-a");
    assert.deepEqual([stone.starter.amount, stone.starter.dids], [1000, undefined], "the tombstone keeps the amount, not the identities");
    assert.equal(JSON.parse(readFileSync(`${tokens}.starter.json`, "utf8")).minted, 1000);
    assert.deepEqual(JSON.parse(readFileSync(`${tokens}.starter.json`, "utf8")).waiting, ["team-c"]);
  } finally {
    server.kill();
  }
});
