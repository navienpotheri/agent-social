// Row DK384 (RG-10): the sponsor is mailed 30 and 7 days before an agent's identity term ends and once when it has lapsed, each once per term; a renewal moves the due date and starts a new set. Fake addresses and a file transport only (a dry run);
// a live run of the mail is still owed (docs/live-run-checklist.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnerStore, renewalNotices, RENEWAL_TERM_MS, type Tenant } from "@agent-social/asp-log";
import { FileTransport } from "../src/mail-send.ts";
import { ServiceMailer } from "../src/service-mailer.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2026-01-01T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const SPONSOR = "did:web:example.com:users:sponsor", AGENT = "did:web:example.com:agents:renewing", BANK_FREE = "did:web:example.com:agents:no-sponsor";
const passport = (id: string, did: string, at: string, sponsor?: string) => ({ id, type: "asp.passport/v0.2", issuer: did, subject: did, issued_at: at, body: { did, kind: "agent", ...(sponsor ? { sponsor } : {}) } });
const renewal = (id: string, passportId: string, at: string) => ({ id, type: "asp.registry_act/v0.2", issuer: AGENT, subject: null, issued_at: at, body: { act: "identity_renewal", passport: passportId } });
const records = (...extra: object[]): { id: string }[] => [passport("p1", AGENT, iso(T0), SPONSOR), passport("p2", BANK_FREE, iso(T0)), ...extra] as { id: string }[];

test("DK384: notices come 30 days and 7 days before the term ends and once when it has lapsed; none for an agent with no sponsor, a retired one, or a long-lapsed one", () => {
  const stages = (at: number, recs = records()) => renewalNotices(recs as never, iso(at)).map((n) => n.stage);
  assert.deepEqual(stages(T0 + 100 * DAY), [], "nothing early in the term");
  assert.deepEqual(stages(T0 + RENEWAL_TERM_MS - 29 * DAY), ["30"]);
  assert.deepEqual(stages(T0 + RENEWAL_TERM_MS - 6 * DAY), ["7"]);
  assert.deepEqual(stages(T0 + RENEWAL_TERM_MS + 2 * DAY), ["lapsed"]);
  assert.deepEqual(stages(T0 + RENEWAL_TERM_MS + 40 * DAY), [], "after the lapse period the identity is past a reminder");
  const n = renewalNotices(records() as never, iso(T0 + RENEWAL_TERM_MS - 29 * DAY))[0];
  assert.equal(n.sponsor, SPONSOR);
  assert.equal(n.did, AGENT);
  assert.equal(n.key, `renewal:${AGENT}:${n.due}:30`);
  assert.deepEqual(stages(T0 + RENEWAL_TERM_MS - 6 * DAY, records({ id: "r1", type: "asp.registry_act/v0.2", issuer: AGENT, subject: null, issued_at: iso(T0 + 300 * DAY), body: { act: "identity_retirement", holder: AGENT } })), [], "retired");
  const renewed = renewalNotices(records(renewal("r2", "p1", iso(T0 + 340 * DAY))) as never, iso(T0 + 350 * DAY));
  assert.deepEqual(renewed, [], "a renewal moves the due date a year on");
  assert.notEqual(renewalNotices(records(renewal("r3", "p1", iso(T0 + 340 * DAY))) as never, iso(T0 + 340 * DAY + RENEWAL_TERM_MS - 5 * DAY))[0].key, n.key, "and starts a new set of notices");
});

test("DK384: the mailer sends the sponsor each notice once, to the sponsor's verified address, in plain words with the one command; passes do not repeat it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-renewal-mail-"));
  let clock = T0 + RENEWAL_TERM_MS - 29 * DAY;
  const owners = new OwnerStore();
  owners.add("sponsor-team", [SPONSOR]);
  const tenant: Tenant = { name: "sponsor-team", role: "tenant", tokenSha256: "0".repeat(64), signup: { at: iso(T0), addressHash: "h", termsVersion: "v1", google: { sub: "g-1", email: "sponsor@example.org" } } };
  const stored = records().map((r: { id: string }, i: number) => ({ seq: i + 1, id: r.id, record: r, appendedAt: iso(T0) }));
  const log = { since: async () => stored, chainInfo: async () => undefined, chain: async () => [], get: async () => undefined, creditAudit: async () => ({}) } as never;
  const mailer = new ServiceMailer({ log, tenants: () => [tenant], owners, from: "Agent Social <noreply@example.org>", transport: new FileTransport(dir), publicUrl: () => "https://society.example", secret: Buffer.alloc(32, 3), now: () => clock });
  assert.equal((await mailer.tick()).sent, 1);
  assert.equal((await mailer.tick()).sent, 0, "once");
  const mails = () => readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { to: string; subject: string; text: string });
  assert.equal(mails().length, 1);
  assert.equal(mails()[0].to, "sponsor@example.org");
  assert.match(mails()[0].subject, /needs renewing in 29 day\(s\)/);
  assert.match(mails()[0].text, new RegExp(`asp registry renew --by ${AGENT}`));
  assert.match(mails()[0].text, /not money/);
  clock = T0 + RENEWAL_TERM_MS - 6 * DAY;
  assert.equal((await mailer.tick()).sent, 1, "the 7-day notice is its own mail");
  clock = T0 + RENEWAL_TERM_MS + 2 * DAY;
  assert.equal((await mailer.tick()).sent, 1);
  assert.match(mails().map((m) => m.subject).join(" | "), /has lapsed/);
  assert.equal(mails().length, 3);
});
