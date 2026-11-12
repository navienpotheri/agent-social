// DK94 and DK67: the starter grant with no key on the service. The operator names itself (ASP_OPERATOR_DID) and funds the starter pool with a signed mint on its own machine; a new
// identity signs its own starter claim; the log moves credits out of the pool by fixed rules. After a sign-up claim there is no unsigned credit and `asp credits audit --require-signed` passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken, STARTER_POOL_DID } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function asp(f: Fixture, args: string[], env: Record<string, string>) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const OP = "did:web:example.com:users:operator", ALICE = "did:web:example.com:users:alice", CODER = "did:web:example.com:agents:alice-coder";
const tenant = (name: string, token: string, google: string) => ({
  name, role: "tenant", tokenSha256: hashToken(token), createdAt: "2026-10-11T00:00:00Z",
  signup: { at: "2026-10-11T00:00:00Z", addressHash: "x".repeat(24), termsVersion: "v1", google: { sub: google, email: `${name}@example.org` } },
});

test("a sign-up claim with no key on the service: the operator funds the pool with a signed mint, the identities sign their own claims, the pool is never overdrawn, and the audit passes --require-signed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-starter-signed-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([tenant("team-a", "tok-a", "g-1"), tenant("team-c", "tok-c", "g-2"), { name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ASP_OPERATOR_DID: OP } });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 20_000);
    });
    const env = (token: string) => ({ ASP_LOG_URL: url, ASP_LOG_TOKEN: token });
    const op = makeFixture(), a = makeFixture(), c = makeFixture();
    // The operator registers its identity and funds the pool with a signed mint: 100 credits, one upfront claim.
    assert.equal((await asp(op, ["identity", "new", "--kind", "human", "--did", OP], env("tok-ops"))).code, 0);
    const fund = await asp(op, ["credits", "grant", "--to", STARTER_POOL_DID, "--amount", "100", "--by", OP, "--reason", "starter_upfront"], env("tok-ops"));
    assert.equal(fund.code, 0, fund.err);
    for (const [kind, did, sponsor] of [["human", ALICE, undefined], ["agent", CODER, ALICE]] as const) {
      assert.equal((await asp(a, ["identity", "new", "--kind", kind, "--did", did, ...(sponsor ? ["--sponsor", sponsor, "--purpose", "Fix the flaky test"] : [])], env("tok-a"))).code, 0);
    }
    // The agent claims the first part; the service holds no key, so the identity signs the claim here and the service hands it to the log.
    const claim = await asp(a, ["account", "starter", "--did", CODER], env("tok-a"));
    assert.equal(claim.code, 0, claim.err);
    assert.match(claim.out, /agents:alice-coder: \+100 credits \(balance 100\)/);
    assert.match((await asp(a, ["credits", "balance", CODER], env("tok-a"))).out, /100 credits/);
    // Once: the rest is not earned yet, and a second upfront claim is not possible.
    const again = await asp(a, ["account", "starter", "--did", CODER], env("tok-a"));
    assert.equal(again.code, 1);
    assert.match(again.err, /already claimed the first part.*released when one of your identities has had a job accepted/);
    // The pool is empty now: a second Google account waits, and nothing was minted without a signature.
    for (const [kind, did] of [["human", "did:web:example.com:users:carol"], ["agent", "did:web:example.com:agents:carol-bot"]] as const) {
      assert.equal((await asp(c, ["identity", "new", "--kind", kind, "--did", did, ...(kind === "agent" ? ["--sponsor", "did:web:example.com:users:carol", "--purpose", "Test"] : [])], env("tok-c"))).code, 0);
    }
    const empty = await asp(c, ["account", "starter", "--did", "did:web:example.com:agents:carol-bot"], env("tok-c"));
    assert.equal(empty.code, 1);
    assert.match(empty.err, /starter pool is full right now/);
    const audit = await asp(op, ["credits", "audit", "--require-signed", "--json"], env("tok-ops"));
    assert.equal(audit.code, 0, audit.out + audit.err);
    const j = JSON.parse(audit.out);
    assert.deepEqual([j.minted, j.mintedSigned, j.mintedUnsigned, j.verdict], [100, 100, 0, "balanced"]);
  } finally {
    server.kill();
  }
});

test("a tenant cannot append a starter claim straight to the log: it goes through the account route, which applies the once-per-Google-account policy", async () => {
  const { courtGuard } = await import("@agent-social/asp-log");
  const guard = courtGuard({ mode: "operator-only", minStake: 1, tenants: () => [], owners: { of: () => [] } as never, log: { juror: async () => undefined, drawPanel: async () => [] } });
  const t = { name: "team-a", role: "tenant" } as never, admin = { name: "ops", role: "admin" } as never;
  const claim = { type: "asp.starter_claim/v0.2", issuer: CODER, body: { part: "upfront", amount: { value: 100, unit: "credit" } } };
  assert.match(String(await guard({ tenant: t, method: "append", args: [claim] })), /asp account starter/);
  assert.match(String(await guard({ tenant: t, method: "importRecords", args: [[{ record: claim }]] })), /cannot be imported/);
  assert.equal(await guard({ tenant: admin, method: "append", args: [claim] }), undefined);
});
