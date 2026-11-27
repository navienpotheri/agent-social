/**
 * The sponsor's monthly statement read from the real log (register row DK1225): the ledger is the agent's balance as the log's rules moved it, the statement reconciles to it, an altered ledger entry fails verification,
 * services and disputes are counted from the agent's own records, and what the log does not record is said not to be. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyStatement } from "@agent-social/asp-package";
import { Kit, SERVICES } from "../../asp-log/test/academy-kit.ts";
import { DAY, jump, kit as societyKit, mk } from "../../asp-log/test/society-kit.ts";
import { buildStatement } from "../src/sponsor-statement.ts";

test("DK1225: a month of an agent's activity reconciles to the log: opening plus earned less spent is the closing balance, purchases are services hired, and the next month opens where this one closed", async () => {
  const k = new Kit(); // the clock starts on 2026-11-01
  await k.priceList();
  const a = await k.agent("ss-a", undefined, 2);
  const [p1, p2] = [await k.person("ss-p1"), await k.person("ss-p2")];
  await k.fund(a, 50);
  await k.acceptedJob(p1, a);
  await k.acceptedJob(p2, a);
  await k.buy(a, SERVICES.sitting, 20);
  await k.buy(a, SERVICES.foundations, 30);
  const other = await k.agent("ss-other", undefined, 2); await k.fund(other, 100); await k.buy(other, SERVICES.sitting, 20); // another agent's purchase is not this agent's service
  const nov = await buildStatement(k.log as never, a.did, "2026-11");
  assert.deepEqual(nov.verification, { ok: true });
  assert.equal(nov.statement.opening, 0, "nothing before November");
  assert.equal(nov.statement.closing, await k.log.balance(a.did), "the closing balance is the log's balance");
  assert.equal(nov.statement.closing, nov.statement.opening + nov.statement.earned - nov.statement.spent);
  assert.equal(nov.statement.spent >= 50, true, "the two purchases are spent");
  assert.deepEqual([nov.statement.servicesHired.count, nov.statement.servicesHired.total], [2, 50]);
  assert.ok(nov.statement.earned >= 50 + 2 * 96 - 40, "the grant and the two jobs' pay are in what came in");
  k.addDays(40);
  await k.fund(a, 5); // a grant in December
  const dec = await buildStatement(k.log as never, a.did, "2026-12");
  assert.equal(dec.statement.opening, nov.statement.closing, "December opens where November closed");
  assert.deepEqual([dec.statement.earned, dec.statement.spent], [5, 0]);
  assert.deepEqual(dec.verification, { ok: true });
  assert.equal(dec.statement.servicesHired.count, 0, "no purchase in December");
  const empty = await buildStatement(k.log as never, a.did, "2026-10");
  assert.deepEqual([empty.statement.opening, empty.statement.earned, empty.statement.spent, empty.statement.closing], [0, 0, 0, 0]);
  await assert.rejects(() => buildStatement(k.log as never, a.did, "Nov"), /YYYY-MM/);
});

test("DK1225: altering a ledger entry, or the statement, fails verification, and the statement says what the log does not record", async () => {
  const k = new Kit();
  await k.priceList();
  const a = await k.agent("ss-t", undefined, 2);
  await k.fund(a, 100);
  await k.buy(a, SERVICES.sitting, 20);
  await k.buy(a, SERVICES.foundations, 30);
  const built = await buildStatement(k.log as never, a.did, "2026-11");
  assert.ok(built.ledger.length >= 3);
  assert.ok(built.ledger.every((e) => e.amount > 0), "a record that did not move the balance is not an entry");
  const tampered = built.ledger.map((e, i) => (i === 1 ? { ...e, amount: e.amount + 1 } : e));
  assert.deepEqual(verifyStatement(built.statement, tampered, built.records), { ok: false, reason: "ledger_tampered" }, "a changed entry breaks the chain");
  const lied = { ...built.statement, earned: built.statement.earned + 10, closing: built.statement.closing + 10 };
  assert.deepEqual(verifyStatement(lied, built.ledger, built.records), { ok: false, reason: "statement_mismatch" }, "a changed figure no longer equals what the ledger gives");
  assert.deepEqual([built.records.courses, built.records.floors], [[], []], "held-out gains and the bond floor's history are not recorded, so they are empty");
  assert.equal(built.statement.floorChangePermille, null);
  assert.deepEqual(built.statement.heldOutGains, []);
});

test("DK1225: disputes are counted from the rulings on the agent's contracts: a ruling that puts the greater fault on the other side is won, on the agent lost, an even split a split", async () => {
  const k = await societyKit();
  const principal = await k.person("ss-claimant", 50_000);
  const performer = await k.agent("ss-performer", await k.person("ss-sponsor", 50), { funds: 5000 });
  const judge = await k.person("ss-judge", 10);
  const dispute = async (fault: (p: string, a: string) => Record<string, number>) => {
    const j = await k.runJob(principal, performer, 40, undefined, { settle: false });
    const rej = mk("attestation", principal, { kind: "acceptance", about: j.delivery, verdict: "rejected", reasons: ["no"] }, j.delivery, { subject: j.contract });
    await k.log.append(rej);
    jump(DAY);
    await k.log.append(mk("attestation", judge, { kind: "ruling", about: j.contract, verdict: "for_principal", fault: fault(principal.did, performer.did), reasons: ["on the record"], code: { version: "1.0", articles: ["4.1"] } }, rej.id, { subject: j.contract }));
  };
  await dispute((p) => ({ [p]: 1000 }));
  await dispute((_p, a) => ({ [a]: 1000 }));
  await dispute((p, a) => ({ [p]: 500, [a]: 500 }));
  await dispute((p) => ({ [p]: 1000 }));
  const asPerformer = await buildStatement(k.log as never, performer.did, "2026-11");
  assert.deepEqual(asPerformer.statement.disputes, { won: 2, lost: 1, split: 1 });
  const asPrincipal = await buildStatement(k.log as never, principal.did, "2026-11");
  assert.deepEqual(asPrincipal.statement.disputes, { won: 1, lost: 2, split: 1 }, "the other side of the same rulings");
  assert.deepEqual(asPerformer.verification, { ok: true });
  const stranger = await buildStatement(k.log as never, (await k.person("ss-stranger", 10)).did, "2026-11");
  assert.deepEqual(stranger.statement.disputes, { won: 0, lost: 0, split: 0 }, "no one else's rulings");
});

import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

test("DK1225: `asp sponsor statement --agent <did> --month` prints the month from the log and says it reconciles; a bad month and no agent are usage errors; --json is the statement", async () => {
  const f = makeFixture();
  const asp = async (args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root } as Io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const SPONSOR = "did:web:example.com:users:st2-sponsor", AGENT = "did:web:example.com:agents:st2-agent";
  assert.equal((await asp(["identity", "new", "--kind", "human", "--did", SPONSOR])).code, 0);
  assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "work"])).code, 0);
  assert.equal((await asp(["credits", "grant", "--to", AGENT, "--amount", "40"])).code, 0);
  const month = new Date().toISOString().slice(0, 7);
  const r = await asp(["sponsor", "statement", "--agent", AGENT, "--month", month]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /credits {2}opening 40, earned 0, spent 0, closing 40/);
  assert.match(r.out, /checked {2}the statement reconciles to the log's ledger of 1 entries/);
  assert.match(r.out, /not read from the log: held-out gains per course and the bond floor's history/);
  assert.equal((await asp(["sponsor", "statement", "--agent", AGENT, "--month", "Nov"])).code, 2, "a bad month is a usage error");
  assert.equal((await asp(["sponsor", "statement"])).code, 2, "an agent is needed");
  const j = await asp(["sponsor", "statement", "--agent", AGENT, "--month", month, "--json"]);
  assert.equal(JSON.parse(j.out).closing, 40, "a grant from before signed mints is the opening balance, so the statement still ends at the log's balance");
  assert.deepEqual(JSON.parse(j.out).verification, { ok: true });
});
