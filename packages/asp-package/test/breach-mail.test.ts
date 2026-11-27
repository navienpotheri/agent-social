// Register row DK1714 (and E10): a breach reported to the service is mailed to the operator and to the sponsor of the agent at once, each only once for a report, without waiting for the owner's machine. The mail
// says the agent is not yet quarantined and what the owner runs. A sponsor without a verified address is skipped, not guessed. Stand-in log and transport; fake addresses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceMailer } from "../src/service-mailer.ts";
import { MemoryTransport } from "../src/mail-send.ts";
import { OwnerStore } from "@agent-social/asp-log";

const emptyLog = { since: async () => [], chain: async () => [], chainInfo: async () => undefined, get: async () => undefined };
const SPONSOR = "did:web:example.com:users:bm-sponsor", AGENT = "did:web:example.com:agents:bm-agent";

function make(withSponsorMail = true) {
  const transport = new MemoryTransport();
  const owners = new OwnerStore();
  owners.add("sponsor-tenant", [SPONSOR]);
  const tenants = [{ name: "sponsor-tenant", role: "tenant", tokenSha256: "x", ...(withSponsorMail ? { signup: { google: { sub: "g1", email: "sponsor@example.org" } } } : {}) }];
  const m = new ServiceMailer({ log: emptyLog as any, tenants: () => tenants as any, owners, transport, from: "Agent Social <noreply@example.org>", operatorTo: "ops@example.org", publicUrl: () => "https://log.example.org", secret: Buffer.alloc(32, 7), now: () => Date.parse("2026-11-22T10:00:00Z") });
  return { m, transport };
}
const breach = { id: "b1", agent: AGENT, cause: "exfiltration", summary: "sent a file to an unknown host", at: "2026-11-22T10:00:00Z", sponsor: SPONSOR };

test("a reported breach is mailed to the operator and to the sponsor, once each; the mail names the next step and the unsent quarantine", async () => {
  const { m, transport } = make();
  assert.deepEqual(await m.tellBreach(breach), ["operator", SPONSOR]);
  assert.deepEqual(transport.sent.map((x) => x.to).sort(), ["ops@example.org", "sponsor@example.org"]);
  for (const mail of transport.sent) {
    assert.match(mail.subject, /Breach reported: exfiltration by did:web:example.com:agents:bm-agent/);
    assert.match(mail.text, /not yet quarantined/);
    assert.match(mail.text, /asp breach respond --from-service/);
    assert.match(mail.text, /sent a file to an unknown host/);
  }
  assert.deepEqual(await m.tellBreach(breach), [], "the same report is never mailed twice");
  assert.equal(transport.sent.length, 2);
  assert.deepEqual(await m.tellBreach({ ...breach, id: "b2", agent: "did:web:example.com:agents:other" }), ["operator", SPONSOR], "a new report is mailed again");
});

test("a sponsor with no verified address is skipped and the operator is still told; no operator address means the sponsor alone", async () => {
  const { m, transport } = make(false);
  assert.deepEqual(await m.tellBreach(breach), ["operator"]);
  assert.deepEqual(transport.sent.map((x) => x.to), ["ops@example.org"]);
  const t2 = new MemoryTransport();
  const owners = new OwnerStore(); owners.add("s", [SPONSOR]);
  const m2 = new ServiceMailer({ log: emptyLog as any, tenants: () => [{ name: "s", role: "tenant", tokenSha256: "x", signup: { google: { sub: "g", email: "s@example.org" } } }] as any, owners, transport: t2, from: "Agent Social <noreply@example.org>", publicUrl: () => "https://x", secret: Buffer.alloc(32, 7), now: () => 0 });
  assert.deepEqual(await m2.tellBreach(breach), [SPONSOR]);
});
