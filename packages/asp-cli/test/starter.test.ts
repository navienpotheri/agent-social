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

test("a newcomer's first job: a Google-verified tenant claims starter credits once (per tenant and per Google account), within the pool, and runs a first job end to end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-starter-e2e-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([
    tenant("team-a", "tok-a", "g-1"), tenant("team-b", "tok-b", "g-1"), tenant("team-c", "tok-c", "g-2"), tenant("team-d", "tok-d"),
    { name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") },
  ]));
  // A pool of exactly one grant (two identities, 500 each).
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
    assert.match((await asp(a, ["account", "show"], A)).out, /starter credits: available: 500 each for up to 2 of your identities/);
    const stranger = await asp(a, ["account", "starter", "--did", STRANGER], A);
    assert.equal(stranger.code, 1);
    assert.match(stranger.err, /is not an identity this tenant has written as/);
    assert.equal((await asp(a, ["account", "starter", "--did", `${ALICE},${CODER},${BANK}`], A)).code, 1, "at most two identities");
    assert.equal((await asp(a, ["account", "starter"], A)).code, 2);
    // Claimed once.
    const claim = await asp(a, ["account", "starter", "--did", `${ALICE},${CODER}`], A);
    assert.equal(claim.code, 0, claim.err);
    assert.match(claim.out, /alice: \+500 credits|users:alice: \+500 credits \(balance 500\)/);
    assert.match((await asp(a, ["credits", "balance", ALICE], A)).out, /500 credits/);
    assert.match((await asp(a, ["credits", "balance", CODER], A)).out, /500 credits/);
    assert.equal((await asp(a, ["account", "starter", "--did", ALICE], A)).code, 1, "a second claim is refused");
    assert.match((await asp(a, ["account", "show"], A)).out, /starter credits: claimed \(1000\)/);

    // The same Google account on another tenant: no second grant. Another Google account: the pool is used up.
    assert.match((await asp(a, ["account", "show"], env("tok-b"))).out, /this Google account has already claimed its starter credits/);
    assert.match((await asp(a, ["account", "show"], env("tok-c"))).out, /the starter pool is used up for now/);

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
    assert.match((await asp(a, ["credits", "balance", CODER], A)).out, /600 credits/, "500 - 100 bond + 100 paid + 100 bond back");
    assert.match((await asp(a, ["credits", "balance", ALICE], A)).out, /400 credits/);

    // Closing the account does not make a second grant possible for the same Google account (the tombstone keeps the claim).
    assert.equal((await asp(a, ["account", "close", "--confirm", "team-a", "--skip-export"], A)).code, 0);
    assert.match((await asp(a, ["account", "show"], env("tok-b"))).out, /this Google account has already claimed its starter credits/);
    const stone = (JSON.parse(readFileSync(tokens, "utf8")) as any[]).find((t) => t.name === "team-a");
    assert.deepEqual([stone.starter.amount, stone.starter.dids], [1000, undefined], "the tombstone keeps the amount, not the identities");
    assert.equal(JSON.parse(readFileSync(`${tokens}.starter.json`, "utf8")).minted, 1000);
  } finally {
    server.kill();
  }
});
