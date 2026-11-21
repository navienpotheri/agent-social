// DK1650 (S1416): the usage routes on a RUNNING service with real tenants. Two tenants own identities (their own passports and agents) and write records; each tenant's GET /usage counts only its own reads and writes; the
// operator signs a plan (with the owner's go) and closes the month for tenant A's organisation; GET /usage/statements shows that statement to A only, with a recount that matches the log, an operator sees all, and B sees none.
// Real `asp serve` subprocess with the real token files, the real owner store and the real usage file; fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (args: string[]) => new Promise<{ code: number; out: string; err: string }>((resolve) => {
  const c = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
  c.on("close", (code) => resolve({ code: code ?? 1, out, err }));
});
async function asp(f: Fixture, args: string[], env: Record<string, string>) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const A_ORG = "did:web:example.com:users:usage-a", A_AGENT = "did:web:example.com:agents:usage-a-bot";
const B_ORG = "did:web:example.com:users:usage-b", B_AGENT = "did:web:example.com:agents:usage-b-bot";
const OP = "did:web:example.com:users:usage-operator", OWNER = "did:web:example.com:users:usage-owner";
const month = new Date().toISOString().slice(0, 7);

test("a running service counts each tenant's reads and writes alone and shows each tenant only the months closed for its own identities, recounted against the log", { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-usage-e2e-"));
  const tokens = join(dir, "tokens.json");
  const tok = async (name: string, role = "tenant") => (await run(["serve", "token", "--tokens", tokens, "--tenant", name, "--role", role])).out.trim().split("\n").at(-1)!;
  const [tokA, tokB, tokOps] = [await tok("team-a"), await tok("team-b"), await tok("ops", "admin")];
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ASP_OPERATOR_DID: OP, ASP_OWNER_DID: OWNER } });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000);
    });
    const envA = { ASP_LOG_URL: url, ASP_LOG_TOKEN: tokA }, envB = { ASP_LOG_URL: url, ASP_LOG_TOKEN: tokB }, envOps = { ASP_LOG_URL: url, ASP_LOG_TOKEN: tokOps };
    const a = makeFixture(), b = makeFixture(), ops = makeFixture();
    for (const [f, env, human, agent] of [[a, envA, A_ORG, A_AGENT], [b, envB, B_ORG, B_AGENT]] as const) {
      assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", human], env)).code, 0);
      assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", agent, "--sponsor", human], env)).code, 0);
    }
    for (const d of [OP, OWNER]) assert.equal((await asp(ops, ["identity", "new", "--kind", "human", "--did", d], envOps)).code, 0);
    // each agent signs posts in the month: the writes the meter counts
    for (let i = 0; i < 3; i++) assert.equal((await asp(a, ["market", "intent", "--by", A_AGENT, "--purpose", `a task ${i}`, "--budget", "10", "--deadline", "2027-12-01T00:00:00Z"], envA)).code, 0);
    assert.equal((await asp(b, ["market", "intent", "--by", B_AGENT, "--purpose", "b task", "--budget", "10", "--deadline", "2027-12-01T00:00:00Z"], envB)).code, 0);

    const get = async (tok: string, path: string) => { const r = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${tok}` } }); return { status: r.status, body: (await r.json()) as { result: any } }; };
    const rpc = (t: string, method: string, args: unknown[] = []) => fetch(`${url}/rpc`, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ target: "log", method, args }) });
    // reads: A makes 3, B makes 5 more; the counts move by exactly those, apart from each other (GET /usage is not itself counted)
    const before = { a: (await get(tokA, `/usage?month=${month}`)).body.result, b: (await get(tokB, `/usage?month=${month}`)).body.result };
    for (let i = 0; i < 3; i++) await rpc(tokA, "head");
    for (let i = 0; i < 5; i++) await rpc(tokB, "head");
    const after = { a: (await get(tokA, `/usage?month=${month}`)).body.result, b: (await get(tokB, `/usage?month=${month}`)).body.result };
    assert.equal(after.a.reads - before.a.reads, 3, "A's three reads");
    assert.equal(after.b.reads - before.b.reads, 5, "B's five reads");
    assert.equal(after.a.writes, before.a.writes, "reads are not writes");
    assert.ok(after.a.writes >= 5 && after.b.writes >= 3, `each tenant's own writes are counted (a ${after.a.writes}, b ${after.b.writes})`);
    assert.equal(after.a.tenant, "team-a");
    assert.ok(after.a.stored.records >= 5);
    const ops1 = (await get(tokOps, `/usage?month=${month}`)).body.result.tenants as Record<string, { reads: number; writes: number }>;
    assert.deepEqual([ops1["team-a"].reads, ops1["team-b"].reads], [after.a.reads, after.b.reads], "the operator sees both, apart");
    assert.equal(ops1.ops, undefined, "an operator's own calls are not counted");

    // the operator signs a plan with the owner's go and closes the month for A's organisation
    const planFile = join(dir, "plan.json");
    writeFileSync(planFile, JSON.stringify({ plan: "e2e-test-plan", name: "Test plan", currency: "USD", agent_month: 500, writes_included: 1, writes_per_1000: 20, tokens_included_m: 1, tokens_per_m: 300, storage_included_mb: 1, storage_per_gb: 1500, dashboard_month: 0 }));
    const plan = await asp(ops, ["meter", "plan", "--file", planFile, "--by", OP, "--cosign", OWNER], envOps);
    assert.equal(plan.code, 0, plan.err + plan.out);
    const st = await asp(ops, ["meter", "statement", "--holder", A_ORG, "--month", month, "--plan", "e2e-test-plan", "--by", OP, "--tax-line", "GST:1800"], envOps);
    assert.equal(st.code, 0, st.err + st.out);
    const statementId = /^statement (\S+):/.exec(st.out)![1];
    assert.match(st.out, /1 line\(s\)|2 line\(s\)/);

    const seen = async (t: string) => (await get(t, "/usage/statements")).body.result as { id: string; holder: string; month: string; total: number; usage_matches_log: boolean }[];
    const forA = await seen(tokA);
    assert.deepEqual(forA.map((s) => [s.id, s.holder, s.month, s.usage_matches_log]), [[statementId, A_ORG, month, true]], "A sees its own month, and the recount matches the log");
    assert.ok(forA[0].total > 0);
    assert.deepEqual(await seen(tokB), [], "B sees none of A's");
    assert.deepEqual((await seen(tokOps)).map((s) => s.id), [statementId], "the operator sees all");
    assert.equal((await fetch(`${url}/usage/statements`)).status, 401);
    // the recount is live: more work by A's agent makes it differ
    assert.equal((await asp(a, ["market", "intent", "--by", A_AGENT, "--purpose", "late", "--budget", "10", "--deadline", "2027-12-01T00:00:00Z"], envA)).code, 0);
    const late = await seen(tokA);
    assert.equal(late[0].usage_matches_log, false, "a write after the close makes the recount differ");
    assert.match(JSON.stringify((late[0] as unknown as { differences: string[] }).differences), /writes/);
    // the invoice reads the same
    const inv = await asp(ops, ["meter", "invoice", statementId], envOps);
    assert.equal(inv.code, 0, inv.err);
    assert.match(inv.out, /INVOICE .* for did:web:example.com:users:usage-a .* plan e2e-test-plan/);
    assert.match(inv.out, /GST \(18.00 %\)/);
    assert.match(inv.out, /the log now counts differently: writes/);
  } finally { server.kill(); }
});
