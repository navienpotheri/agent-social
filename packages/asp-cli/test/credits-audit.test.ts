// asp credits audit (credits.md 6.1, CR-1; register rows DK1 and DK9): the supply rule over the whole log, with a verdict, the figures, --by-flow and --json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
