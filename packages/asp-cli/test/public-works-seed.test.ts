/**
 * The public-works line in use (register row DK760; spec-delta S997): the Treasury drafts a public-works budget for the owner to co-sign, `asp treasury pay --to` pays only a house agent from it and never past it,
 * and `asp market seed --fund-from` draws the house agent's escrow from it. The monthly figure is the owner's (docs/owner-decisions.md, PW1). Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecord } from "@agent-social/asp-core";
import { TREASURY_DID } from "@agent-social/asp-log";
import { Keystore, openLog } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";
import { buildDrafts, PUBLIC_WORKS_LINE } from "../src/treasury.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const OWNER = "did:web:example.com:users:pw-owner", OPERATOR = "did:web:example.com:users:pw-operator";
const HOUSE = "did:web:example.com:agents:pw-house", REAL = "did:web:example.com:agents:pw-real";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };

test("S997: a public-works draft exists; the line pays a house agent only and never past itself; the seed command draws the escrow from it", async () => {
  const draft = buildDrafts("2026-12").drafts.find((d) => d.id === "public-works")!;
  assert.deepEqual([draft.purpose, draft.amount, draft.institution], ["public_works", PUBLIC_WORKS_LINE, TREASURY_DID]);

  const f = makeFixture();
  const savedOp = process.env.ASP_OPERATOR_DID, savedOwner = process.env.ASP_OWNER_DID;
  process.env.ASP_OPERATOR_DID = OPERATOR; process.env.ASP_OWNER_DID = OWNER;
  try {
    for (const d of [OWNER, OPERATOR, TREASURY_DID]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", HOUSE, "--sponsor", OPERATOR, "--purpose", "Post the seed jobs"]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", REAL, "--sponsor", OWNER, "--purpose", "Real work"]);
    const log = await openLog(f.aspHome, {});
    const head = (await log.log.passport(HOUSE))!.head;
    await log.append(createRecord({ type: "passport", issuer: OPERATOR, subject: HOUSE, prev: head, body: { ...((await log.log.get(head))!.record.body as Record<string, unknown>), house: true }, issued_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }, new Keystore(f.aspHome).forDid(OPERATOR)!));
    await ok(f, ["credits", "grant", "--to", TREASURY_DID, "--amount", "5000", "--by", OPERATOR, "--reason", "test"]);

    const file = join(mkdtempSync(join(tmpdir(), "asp-pw-")), "drafts.json");
    const month = new Date().toISOString().slice(0, 7);
    writeFileSync(file, JSON.stringify(buildDrafts(month)));
    const signed = await ok(f, ["treasury", "sign", "--draft", file, "--id", "public-works", "--cosign-by", OWNER, "--amount", "300"]);
    const budget = /budget (sha256:[0-9a-f]+):/.exec(signed.out)![1];

    // It pays a house agent, named; nobody else; never past the line.
    const noTo = await asp(f, ["treasury", "pay", "--budget", budget, "--amount", "50"]);
    assert.notEqual(noTo.code, 0);
    assert.match(noTo.err, /names the house agent/);
    const real = await asp(f, ["treasury", "pay", "--budget", budget, "--amount", "50", "--to", REAL]);
    assert.notEqual(real.code, 0);
    assert.match(real.err, /public_works_house_agent_only|house agent/);
    assert.match((await ok(f, ["treasury", "pay", "--budget", budget, "--amount", "20", "--to", HOUSE])).out, new RegExp(`20 credits to ${HOUSE}`));
    const over = await asp(f, ["treasury", "pay", "--budget", budget, "--amount", "290", "--to", HOUSE]);
    assert.notEqual(over.code, 0);
    assert.match(over.err, /over_budget|budget/);
    const fresh = async () => await openLog(f.aspHome, {});
    assert.equal(await (await fresh()).log.balance(HOUSE), 20);

    // The seed command checks the line it is told to draw on, then tops the house agent up to what the jobs' escrow needs from it, once.
    const wrong = await asp(f, ["market", "seed", "--by", HOUSE, "--mandate", "sha256:" + "1".repeat(64), "--fund-from", "sha256:" + "0".repeat(64)]);
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.err, /names a public-works budget/);
    const seeded = await asp(f, ["market", "seed", "--by", HOUSE, "--mandate", "sha256:" + "1".repeat(64), "--count", "2", "--fund-from", budget]);
    assert.match(seeded.out, /public works: \d+ credits from the Treasury's public-works line to .*pw-house/);
    assert.ok((await (await fresh()).log.balance(HOUSE)) > 20, "the house agent was topped up from the line");
    assert.equal((await (await fresh()).log.creditAudit()).verdict, "balanced");
  } finally {
    if (savedOp === undefined) delete process.env.ASP_OPERATOR_DID; else process.env.ASP_OPERATOR_DID = savedOp;
    if (savedOwner === undefined) delete process.env.ASP_OWNER_DID; else process.env.ASP_OWNER_DID = savedOwner;
  }
});

test("DK760, DK1100: the monthly routine rehearsed on a local log over two months: each month the owner's co-signed line pays the house agent what the seed jobs need, a second run in the same month pays nothing more, and nothing is paid past a month's line", async () => {
  const f = makeFixture();
  const savedOp = process.env.ASP_OPERATOR_DID, savedOwner = process.env.ASP_OWNER_DID;
  process.env.ASP_OPERATOR_DID = OPERATOR; process.env.ASP_OWNER_DID = OWNER;
  try {
    setClock(() => new Date("2026-12-02T10:00:00Z"));
    for (const d of [OWNER, OPERATOR, TREASURY_DID]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["identity", "new", "--kind", "agent", "--did", HOUSE, "--sponsor", OPERATOR, "--purpose", "Post the seed jobs"]);
    const log = await openLog(f.aspHome, {});
    const head = (await log.log.passport(HOUSE))!.head;
    await log.append(createRecord({ type: "passport", issuer: OPERATOR, subject: HOUSE, prev: head, body: { ...((await log.log.get(head))!.record.body as Record<string, unknown>), house: true }, issued_at: "2026-12-02T10:00:00Z" } as never, new Keystore(f.aspHome).forDid(OPERATOR)!));
    await ok(f, ["credits", "grant", "--to", TREASURY_DID, "--amount", "5000", "--by", OPERATOR, "--reason", "test"]);
    const balance = async () => (await openLog(f.aspHome, {})).log.balance(HOUSE);
    const month = async (period: string, count: string) => {
      const file = join(mkdtempSync(join(tmpdir(), "asp-pw-")), "drafts.json");
      writeFileSync(file, JSON.stringify(buildDrafts(period)));
      const signed = await ok(f, ["treasury", "sign", "--draft", file, "--id", "public-works", "--cosign-by", OWNER]);
      const budget = /budget (sha256:[0-9a-f]+):/.exec(signed.out)![1];
      const first = await asp(f, ["market", "seed", "--by", HOUSE, "--mandate", "sha256:" + "1".repeat(64), "--count", count, "--fund-from", budget]); // the postings themselves need a price list, which this log has not got: the payment is made before them
      const again = await asp(f, ["market", "seed", "--by", HOUSE, "--mandate", "sha256:" + "1".repeat(64), "--count", count, "--fund-from", budget]);
      return { budget, first: first.out, again: again.out };
    };
    const m1 = await month("2026-12", "2");
    assert.match(m1.first, /public works: \d+ credits from the Treasury's public-works line/, "December: the line pays what the jobs need");
    const afterM1 = await balance();
    assert.ok(afterM1 > 0, "the house agent holds the credits the jobs need");
    assert.match(m1.again, /already holds the \d+ credits the seed jobs need; nothing paid/, "a second run in the same month pays nothing more");
    assert.equal(await balance(), afterM1, "and the house agent's balance did not move");
    setClock(() => new Date("2027-01-04T10:00:00Z"));
    const m2 = await month("2027-01", "2");
    assert.notEqual(m2.budget, m1.budget, "January has its own budget");
    assert.match(m2.first, /public works:/, "January: the new month's line is drawn on");
    assert.equal((await (await openLog(f.aspHome, {})).log.creditAudit()).verdict, "balanced");
    const list = (await ok(f, ["treasury", "list"])).out;
    assert.match(list, /public_works/);
  } finally {
    setClock(undefined);
    if (savedOp === undefined) delete process.env.ASP_OPERATOR_DID; else process.env.ASP_OPERATOR_DID = savedOp;
    if (savedOwner === undefined) delete process.env.ASP_OWNER_DID; else process.env.ASP_OWNER_DID = savedOwner;
  }
});
