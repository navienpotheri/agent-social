/**
 * The newcomer allowance offered at the end of `asp join` is true when it is read (register row DK380): before a first course the command says the allowance opens after one; the newcomer takes a first course (a purchase from the
 * Academy); the same command then says the first course is done and the claim pays the allowance. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWANCE_AMOUNT, TREASURY_DID } from "@agent-social/asp-log";
import { treasuryCmd } from "../src/treasury.ts";
import { Kit, SERVICES, credit, owner, treasury, type Party } from "../../asp-log/test/academy-kit.ts";

test("DK380: a newcomer is told the allowance opens after a first course, takes the course, is told it is done, and the claim pays the allowance", async () => {
  const kit = new Kit();
  await kit.mint(TREASURY_DID, 5000);
  const month = kit.now().slice(0, 7);
  await kit.put(kit.mk("budget", treasury, { institution: TREASURY_DID, period: month, amount: credit(400), purpose: "allowance" }, null, { at: kit.tick(), cosigners: [owner] }));
  const sponsor = await kit.person("al-sponsor");
  const newcomer = await kit.agent("al-newcomer", sponsor, 1);
  await kit.fund(newcomer, 50);
  const parties = new Map<string, Party>([[newcomer.did, newcomer]]);
  const out: string[] = [];
  const run = async (flags: Record<string, unknown>) => { out.length = 0; const code = await treasuryCmd("allowance", { log: { log: kit.log, append: (r: unknown) => kit.log.append(r as never) } as never, io: { out: (l) => out.push(l), err: (l) => out.push(l) }, now: () => kit.tick(), signerFor: (d: string) => parties.get(d)!, flags: { agent: newcomer.did, ...flags } as never }); return { code, text: out.join("\n") }; };

  const before = await run({});
  assert.equal(before.code, 0);
  assert.match(before.text, /the 40-credit newcomer allowance opens after your first course \(a purchase from the Academy: asp academy courses, then asp academy enrol <course> --by did:web:example\.com:agents:al-newcomer\)/);
  assert.ok(!/your first course is done/.test(before.text), "not before the course");
  assert.equal(ALLOWANCE_AMOUNT, 40);
  const balance0 = await kit.log.balance(newcomer.did);

  await kit.buy(newcomer, SERVICES.sitting, 20); // the first course: a purchase from the Academy
  const paid = await kit.log.balance(newcomer.did);
  assert.equal(paid, balance0 - 20);
  const after = await run({});
  assert.match(after.text, /your first course is done: you may claim the 40-credit newcomer allowance now/);
  assert.match(after.text, /asp treasury allowance --agent did:web:example\.com:agents:al-newcomer --yes/);

  const claim = await run({ claim: true });
  assert.equal(claim.code, 0, claim.text);
  assert.match(claim.text, /allowance sha256:[0-9a-f]+: 40 credits to did:web:example\.com:agents:al-newcomer \(first_course\)/);
  assert.equal(await kit.log.balance(newcomer.did), paid + 40, "the allowance moved from the Treasury");
  const again = await run({});
  assert.match(again.text, /already received the newcomer allowance/);
  assert.equal((await kit.log.creditAudit()).verdict, "balanced");
});

test("DK380: an agent with no passport is told so, and never that the course is done", async () => {
  const kit = new Kit();
  await kit.mint(TREASURY_DID, 5000);
  await kit.put(kit.mk("budget", treasury, { institution: TREASURY_DID, period: kit.now().slice(0, 7), amount: credit(400), purpose: "allowance" }, null, { at: kit.tick(), cosigners: [owner] }));
  const out: string[] = [];
  const code = await treasuryCmd("allowance", { log: { log: kit.log, append: (r: unknown) => kit.log.append(r as never) } as never, io: { out: (l) => out.push(l), err: (l) => out.push(l) }, now: () => kit.tick(), signerFor: () => { throw new Error("no key"); }, flags: { agent: "did:web:example.com:agents:nobody" } as never });
  assert.equal(code, 0);
  assert.match(out.join("\n"), /not eligible yet: no passport in this log/);
});
