import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ServiceMailer } from "../src/service-mailer.ts";
import { MemoryTransport } from "../src/mail-send.ts";
import { OwnerStore } from "@agent-social/asp-log";
import { economySupplyRoutes } from "../src/economy-supply.ts";

// A log stub with nothing in it: the mandate-mail and dispute passes of ServiceMailer.tick() find nothing to do, so only the audit
// path (the thing under test here, DK1 and DK9) does anything.
const emptyLog = { since: async () => [], chain: async () => [], chainInfo: async () => undefined, get: async () => undefined };

function mailer(opts: { audit: () => Promise<any>; auditIntervalMs?: number; now: () => number }) {
  const transport = new MemoryTransport();
  const m = new ServiceMailer({
    log: emptyLog as any, tenants: () => [], owners: new OwnerStore(), transport, from: "Agent Social <noreply@example.org>",
    operatorTo: "ops@example.org", publicUrl: () => "https://log.example.org", secret: Buffer.alloc(32, 1),
    audit: opts.audit, auditIntervalMs: opts.auditIntervalMs, now: opts.now,
  });
  return { m, transport };
}

test("the nightly credit audit (DK1, DK9): a balanced ledger mails nobody", async () => {
  let now = 0;
  const audit = async () => ({ verdict: "balanced" as const, difference: 0, problems: [], head: { seq: 10, logHash: "h".repeat(64) } });
  const { m, transport } = mailer({ audit, auditIntervalMs: 1000, now: () => now });
  await m.tick();
  assert.equal(transport.sent.length, 0, "a balanced audit sends no alert");
  assert.deepEqual(m.lastAudit(), { at: new Date(0).toISOString(), verdict: "balanced" });
});

test("the nightly credit audit: a mismatch mails the operator once, through the operator channel, naming the recompute command", async () => {
  let now = 0;
  let calls = 0;
  const audit = async () => { calls++; return { verdict: "mismatch" as const, difference: 3, problems: ["3 credit(s) were minted and are in no account or lock: credits were lost"], head: { seq: 42, logHash: "a".repeat(64) } }; };
  const { m, transport } = mailer({ audit, auditIntervalMs: 1000, now: () => now });

  await m.tick();
  assert.equal(calls, 1);
  assert.equal(transport.sent.length, 1, "the mismatch is mailed to the operator");
  const mail = transport.sent[0];
  assert.equal(mail.to, "ops@example.org");
  assert.match(mail.subject, /Credit audit mismatch: 3 credit\(s\) at log seq 42/);
  assert.match(mail.text, /credits were lost/);
  assert.match(mail.text, /asp credits audit --json/);
  assert.equal(mail.headers, undefined, "an operator note carries no unsubscribe footer");
  assert.deepEqual(m.lastAudit(), { at: new Date(0).toISOString(), verdict: "mismatch" });

  // Before the interval elapses, a second pass neither re-runs the audit nor mails again.
  now = 500;
  await m.tick();
  assert.equal(calls, 1, "not due yet");
  assert.equal(transport.sent.length, 1, "no second mail for the same mismatch");

  // Once the interval elapses with the ledger still broken at the same log head, the audit runs again but the alert (keyed on the head) is not repeated.
  now = 1500;
  await m.tick();
  assert.equal(calls, 2, "the audit runs again once the interval has passed");
  assert.equal(transport.sent.length, 1, "the same mismatch, at the same log head, is not mailed twice");
});

test("the nightly credit audit: a mismatch at a new log head is alerted again", async () => {
  let now = 0;
  let head = 1;
  const audit = async () => ({ verdict: "mismatch" as const, difference: 1, problems: ["off by one"], head: { seq: head, logHash: "b".repeat(64) } });
  const { m, transport } = mailer({ audit, auditIntervalMs: 100, now: () => now });
  await m.tick();
  assert.equal(transport.sent.length, 1);
  now = 200; head = 2;
  await m.tick();
  assert.equal(transport.sent.length, 2, "a mismatch found again at a later log head is a new alert");
});

test("without an audit function, ServiceMailer.tick() does nothing extra and asks nobody", async () => {
  const transport = new MemoryTransport();
  const m = new ServiceMailer({
    log: emptyLog as any, tenants: () => [], owners: new OwnerStore(), transport, from: "Agent Social <noreply@example.org>",
    operatorTo: "ops@example.org", publicUrl: () => "https://log.example.org", secret: Buffer.alloc(32, 1),
  });
  await m.tick();
  assert.equal(transport.sent.length, 0);
  assert.deepEqual(m.lastAudit(), { at: undefined, verdict: undefined });
});

async function withSupplyServer<T>(audit: () => Promise<any>, fn: (url: string) => Promise<T>): Promise<T> {
  const route = economySupplyRoutes({ audit });
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

const SAMPLE_AUDIT = {
  head: { seq: 7, logHash: "c".repeat(64) }, minted: 1000, mintedSigned: 1000, mintedUnsigned: 0, burned: 40, treasury: 60,
  institutions: [{ did: "did:web:asp.local:academy", balance: 120 }], accounts: 5, balances: 940, circulating: 760,
  locked: { escrow: 60, bond: 0, feeReserves: 0, jurorStakes: 0, reportDeposits: 0, total: 60 }, verdict: "balanced" as const, problems: [],
};

test("GET /economy/supply (DK9): a public page needing no token, JSON on request", async () => {
  await withSupplyServer(async () => SAMPLE_AUDIT, async (url) => {
    const json = await fetch(`${url}/economy/supply`, { headers: { accept: "application/json" } });
    assert.equal(json.status, 200);
    assert.equal(json.headers.get("content-type"), "application/json");
    const body = await json.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.verdict, "balanced");
    assert.equal(body.minted, 1000);
    assert.equal(body.institutions[0].did, "did:web:asp.local:academy");

    const byQuery = await fetch(`${url}/economy/supply?format=json`);
    assert.equal(byQuery.headers.get("content-type"), "application/json");

    const html = await fetch(`${url}/economy/supply`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get("content-type") ?? "", /text\/html/);
    const text = await html.text();
    assert.match(text, /Credit supply/);
    assert.match(text, /Balanced/);
    assert.match(text, /did:web:asp\.local:academy/);
    assert.match(text, /asp credits audit --json/);

    assert.equal((await fetch(`${url}/no-such-route`)).status, 404, "only /economy/supply is handled");
    assert.equal((await fetch(`${url}/economy/supply`, { method: "POST" })).status, 405);
  });
});

test("GET /economy/supply: a mismatch shows plainly, in both forms", async () => {
  const broken = { ...SAMPLE_AUDIT, verdict: "mismatch" as const, problems: ["3 credit(s) were minted and are in no account or lock: credits were lost"] };
  await withSupplyServer(async () => broken, async (url) => {
    const body = await (await fetch(`${url}/economy/supply`, { headers: { accept: "application/json" } })).json() as any;
    assert.equal(body.verdict, "mismatch");
    const text = await (await fetch(`${url}/economy/supply`)).text();
    assert.match(text, /MISMATCH/);
    assert.match(text, /credits were lost/);
  });
});
