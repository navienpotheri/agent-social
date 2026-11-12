// asp credits audit (credits.md 6.1, CR-1; register rows DK1 and DK9): the supply rule over the whole log, with a verdict, the figures, --by-flow and --json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";

async function asp(home: string, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home }, cwd: home };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const A = "did:web:example.com:users:audit-a", B = "did:web:example.com:agents:audit-b";

test("asp credits audit: balanced over every account, with the figures; --json and --by-flow say what the log can and cannot report", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-audit-"));
  assert.equal((await asp(home, ["credits", "grant", "--to", A, "--amount", "300"])).code, 0);
  assert.equal((await asp(home, ["credits", "grant", "--to", B, "--amount", "120"])).code, 0);

  const plain = await asp(home, ["credits", "audit"]);
  assert.equal(plain.code, 0, plain.err);
  assert.match(plain.out, /minted \(M\)\s+420/);
  assert.match(plain.out, /in 2 account\(s\)\s+420/);
  assert.match(plain.out, /verdict: balanced/);
  assert.match(plain.out, /Not in this audit yet:/);

  const json = JSON.parse((await asp(home, ["credits", "audit", "--json"])).out);
  assert.equal(json.verdict, "balanced");
  assert.equal(json.minted, 420); assert.equal(json.balances, 420); assert.equal(json.difference, 0); assert.equal(json.accounts, 2);

  const flows = await asp(home, ["credits", "audit", "--by-flow"]);
  assert.equal(flows.code, 0);
  assert.match(flows.out, /By flow \(whole log\):/);
  assert.match(flows.out, /minted 420/);
  assert.match(flows.out, /not available from the log yet:/);
  assert.match(flows.out, /credit lines, premiums, claims and reserves of the Bank and the Insurer/);

  const since = JSON.parse((await asp(home, ["credits", "audit", "--by-flow", "--since", "2026-01-01T00:00:00Z", "--json"])).out);
  assert.equal(since.flows.since, "2026-01-01T00:00:00Z");
  assert.equal(since.flows.settlements.count, 0);
});

test("asp credits audit: the Treasury, burned and institution figures, signed against unsigned mints, and --require-signed (credits.md CR-2, CR-3)", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-audit-signed-"));
  assert.equal((await asp(home, ["credits", "grant", "--to", A, "--amount", "50"])).code, 0);
  const plain = await asp(home, ["credits", "audit"]);
  assert.equal(plain.code, 0, plain.err);
  assert.match(plain.out, /minted \(M\)\s+50\s+signed mint records 0, old unsigned mint 50/);
  assert.match(plain.out, /Treasury 0, burned 0/);
  const json = JSON.parse((await asp(home, ["credits", "audit", "--json"])).out);
  assert.deepEqual([json.mintedSigned, json.mintedUnsigned, json.treasury, json.burned], [0, 50, 0, 0]);
  // The credit was created without a signed mint record: --require-signed says so and exits 1; the books still balance.
  const strict = await asp(home, ["credits", "audit", "--require-signed"]);
  assert.equal(strict.code, 1);
  assert.match(strict.out, /verdict: balanced/);
  assert.match(strict.out, /--require-signed: FAILED, 50 credit\(s\)/);
});

test("asp credits grant --by: the operator signs a mint on their own machine; the log checks the DID, a different signer is refused, and the audit then passes --require-signed (DK67)", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-audit-op-"));
  const OP = "did:web:example.com:users:operator", OTHER = "did:web:example.com:users:not-the-operator";
  assert.equal((await asp(home, ["identity", "new", "--kind", "human", "--did", OP])).code, 0);
  assert.equal((await asp(home, ["identity", "new", "--kind", "human", "--did", OTHER])).code, 0);
  // With no operator named, a signed mint is refused: only the DID the log is configured with may mint.
  const none = await asp(home, ["credits", "grant", "--to", A, "--amount", "40", "--by", OP, "--reason", "test"]);
  assert.equal(none.code, 1);
  assert.match(none.err, /none configured/);
  // The operator DID is public configuration (never a key) kept in the home.
  writeFileSync(join(home, "operator.json"), JSON.stringify({ operator: OP }));
  const ok = await asp(home, ["credits", "grant", "--to", A, "--amount", "40", "--by", OP, "--reason", "test"]);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /signed mint .* by .*operator, reason test/);
  const refused = await asp(home, ["credits", "grant", "--to", A, "--amount", "40", "--by", OTHER, "--reason", "test"]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /is not the operator/);
  assert.equal((await asp(home, ["credits", "grant", "--to", A, "--amount", "5", "--by", OP, "--reason", "nonsense"])).code, 2, "an unknown reason is a usage error");
  const strict = await asp(home, ["credits", "audit", "--require-signed", "--json"]);
  assert.equal(strict.code, 0, strict.out);
  const json = JSON.parse(strict.out);
  assert.deepEqual([json.minted, json.mintedSigned, json.mintedUnsigned, json.verdict], [40, 40, 0, "balanced"]);
  assert.equal((await asp(home, ["credits", "balance", A])).out.includes("40 credits"), true);
});

test("asp credits fund: a sponsor funds its own agent and the agent returns credits; an unrelated pair is refused (DK7, T8 and R1)", async () => {
  const home = mkdtempSync(join(tmpdir(), "asp-fund-"));
  const SPONSOR = "did:web:example.com:users:sponsor", AGENT = "did:web:example.com:agents:funded", STRANGER = "did:web:example.com:users:stranger";
  assert.equal((await asp(home, ["identity", "new", "--kind", "human", "--did", SPONSOR])).code, 0);
  assert.equal((await asp(home, ["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "Test"])).code, 0);
  assert.equal((await asp(home, ["identity", "new", "--kind", "human", "--did", STRANGER])).code, 0);
  assert.equal((await asp(home, ["credits", "grant", "--to", SPONSOR, "--amount", "100"])).code, 0);
  assert.equal((await asp(home, ["credits", "grant", "--to", STRANGER, "--amount", "100"])).code, 0);
  const ok = await asp(home, ["credits", "fund", "--from", SPONSOR, "--to", AGENT, "--amount", "40"]);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /balances: .*sponsor 60, .*funded 40/);
  assert.equal((await asp(home, ["credits", "fund", "--from", AGENT, "--to", SPONSOR, "--amount", "10"])).code, 0);
  const bad = await asp(home, ["credits", "fund", "--from", STRANGER, "--to", AGENT, "--amount", "10"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /credits between unrelated parties move only against a job/);
  assert.equal((await asp(home, ["credits", "audit", "--json"])).code, 0, "the books still balance");
});
