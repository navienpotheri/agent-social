/**
 * The closed loop's commands on a real log (register row DK98; spec-delta S450): `asp treasury list | pay | allowance` and `asp prizes`, and the audit's by-flow lines for budgets, payments, allowances and prizes.
 * Credits are accounting entries, not money. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TREASURY_DID } from "@agent-social/asp-log";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const OWNER = "did:web:example.com:users:the-owner";
const SPONSOR = "did:web:example.com:users:newbie-sponsor";
const NEWBIE = "did:web:example.com:agents:newbie";
let clockMs = Date.parse("2026-11-14T00:00:00Z");
async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("DK98: budget list and pay, the newcomer allowance line, prizes and the audit's by-flow lines all run against a local log", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  const savedOwner = process.env.ASP_OWNER_DID;
  process.env.ASP_OWNER_DID = OWNER;
  try {
    for (const d of [OWNER, TREASURY_DID, SPONSOR]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", NEWBIE, "--sponsor", SPONSOR]);
    await ok(f, ["credits", "grant", "--to", TREASURY_DID, "--amount", "60000"]);

    // Before any budget the allowance line says why not.
    const before = await ok(f, ["treasury", "allowance", "--agent", NEWBIE]);
    assert.match(before.out, /not eligible yet: no allowance budget for 2026-11/);

    // The owner's first budgets (the same one-command-each path as the drafts), for the month of the test.
    const dir = mkdtempSync(join(tmpdir(), "asp-loop-"));
    const file = join(dir, "budgets.json");
    await ok(f, ["treasury", "draft", "--period", "2026-11", "--out", file]);
    for (const id of ["courts", "allowance"]) { clockMs += 60_000; await ok(f, ["treasury", "sign", "--draft", file, "--id", id, "--cosign-by", OWNER]); }

    const listed = await ok(f, ["treasury", "list"]);
    assert.match(listed.out, /2 budget\(s\), 0 payment\(s\), 0 newcomer allowance\(s\), 0 prize\(s\)/);
    assert.match(listed.out, /courts\s+2026-11\s+2000 credits, paid 0, left 2000/);
    const budgetId = /budget (\S{12})\s+courts/.exec(listed.out)![1];

    clockMs += 60_000;
    const paid = await ok(f, ["treasury", "pay", "--budget", budgetId, "--amount", "700", "--memo", "panel fees"]);
    assert.match(paid.out, /700 credits to did:web:asp.local:courts out of budget .* \(1300 left/);
    assert.match((await ok(f, ["treasury", "list"])).out, /paid 700, left 1300/);
    clockMs += 60_000;
    const over = await asp(f, ["treasury", "pay", "--budget", budgetId, "--amount", "1301"]);
    assert.notEqual(over.code, 0);
    assert.match(over.err, /over_budget|more than|budget/i, "never beyond the budget");

    // The allowance line is shown to an agent that can use it; the log's own rules decide the claim (a first course or a first bond is what it has not done).
    const eligible = await ok(f, ["treasury", "allowance", "--agent", NEWBIE]);
    assert.match(eligible.out, /you may be eligible for the 40-credit newcomer allowance/);
    assert.match(eligible.out, /asp treasury allowance --agent did:web:example.com:agents:newbie --yes/);
    const claim = await asp(f, ["treasury", "allowance", "--agent", NEWBIE, "--yes"]);
    assert.notEqual(claim.code, 0);
    assert.match(claim.err, /the log refused the claim: .*(first course|first bond|not earned|allowance)/i);

    const statement = await ok(f, ["treasury", "statement"]);
    assert.match(statement.out, /came in: issuance 60000, job tax 0, its share of purchases 0/);
    assert.match(statement.out, /went out: budget payments 700, newcomer allowances 0/);
    assert.match(statement.out, /balance 59300; reconciles to the ledger/);
    assert.match(statement.out, /courts\s+budgeted\s+2000\s+paid by the Treasury\s+700/);
    assert.match((await ok(f, ["prizes"])).out, /^0 prize\(s\), 0 credits in all/);

    // The audit lists the closed-loop flows by their records, and the books still balance.
    const audit = await ok(f, ["credits", "audit", "--by-flow"]);
    assert.match(audit.out, /Treasury closed loop: 2 budget\(s\) for 22,?000, 1 payment\(s\) out of them for 700, 0 newcomer allowance\(s\) for 0, 0 prize\(s\) for 0/);
    assert.doesNotMatch(audit.out, /allowances and prizes \(S190\) are not yet listed by flow/);
    assert.match(audit.out, /balanced/i);
  } finally { setClock(undefined); if (savedOwner === undefined) delete process.env.ASP_OWNER_DID; else process.env.ASP_OWNER_DID = savedOwner; }
});

test("DK15: every institution has a budget line once the drafts are signed, and the statement shows each one's budget, what it was paid and what it earned", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  const savedOwner = process.env.ASP_OWNER_DID;
  process.env.ASP_OWNER_DID = OWNER;
  try {
    for (const d of [OWNER, TREASURY_DID]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["credits", "grant", "--to", TREASURY_DID, "--amount", "60000"]);
    const file = join(mkdtempSync(join(tmpdir(), "asp-lines-")), "budgets.json");
    await ok(f, ["treasury", "draft", "--period", "2026-12", "--out", file]);
    const drafts = JSON.parse((await import("node:fs")).readFileSync(file, "utf8")).drafts as { id: string; institution: string; purpose: string; amount: number }[];
    for (const d of drafts) { clockMs += 60_000; await ok(f, ["treasury", "sign", "--draft", file, "--id", d.id, "--cosign-by", OWNER]); }
    const out = (await ok(f, ["treasury", "statement"])).out;
    for (const d of drafts.filter((x) => x.purpose === "charter")) {
      const name = d.institution.replace("did:web:asp.local:", "");
      assert.match(out, new RegExp(`${name} +budgeted +${d.amount} +paid by the Treasury +0 +earned from purchases +0`), `${name} has its line`);
    }
    assert.equal(drafts.filter((x) => x.purpose === "charter").length, 11, "all eleven institutions");
    assert.match(out, /reconciles to the ledger/);
  } finally { setClock(undefined); if (savedOwner === undefined) delete process.env.ASP_OWNER_DID; else process.env.ASP_OWNER_DID = savedOwner; }
});
