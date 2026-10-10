import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAlertMail, buildMandateMail, collectMandateFacts, findAlerts, type MailLog } from "../src/index.ts";

type Rec = { id: string; seq: number; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: any } };
const rec = (seq: number, id: string, type: string, issued_at: string, body: any): Rec => ({ id, seq, record: { type, issuer: "did:x", issued_at, body } });

function fakeLog(records: Rec[], states: Record<string, string>): MailLog {
  return {
    chain: async (c) => records.filter((r) => r.id === c || r.record.body?.contract === c),
    chainInfo: async (c) => (states[c] ? { state: states[c] } : undefined),
    since: async () => records,
  };
}

const contract = rec(1, "c1", "asp.contract/v0.2", "2026-10-01T00:00:00Z", { principal: "did:alice", performer: "did:coder", purpose: "Fix the test", price: { value: 100, unit: "credit" } });
const mandate = (expires: string) => rec(2, "m1", "asp.mandate/v0.2", "2026-10-01T00:01:00Z", { contract: "c1", scopes: ["repo.read"], spend: { cap: 5, unit: "credit" }, irreversible: { policy: "checkpoint" }, learning: { share_to_commons: false }, expires });

test("findAlerts: an upheld report against the agent gets an alert, a dismissed one does not, and the key is stable", async () => {
  const report = rec(3, "r1", "asp.attestation/v0.2", "2026-10-02T00:00:00Z", { kind: "report", about: "c1", reasons: ["it ran a port scan"] });
  const upheld = rec(4, "u1", "asp.attestation/v0.2", "2026-10-03T00:00:00Z", { kind: "report_ruling", about: "r1", verdict: "upheld" });
  const dismissed = rec(5, "u2", "asp.attestation/v0.2", "2026-10-03T00:00:00Z", { kind: "report_ruling", about: "r1", verdict: "dismissed" });
  const alerts = await findAlerts(fakeLog([contract, mandate("2027-01-01T00:00:00Z"), report, upheld, dismissed], { c1: "Running" }), Date.parse("2026-10-09T00:00:00Z"));
  assert.equal(alerts.length, 1);
  assert.deepEqual([alerts[0].kind, alerts[0].key, alerts[0].contract], ["report_upheld", "alert:report:u1", "c1"]);
  assert.match(alerts[0].detail, /it ran a port scan/);

  const f = (await collectMandateFacts(fakeLog([contract, mandate("2027-01-01T00:00:00Z")], { c1: "Running" }), "c1"))!;
  const mail = buildAlertMail(alerts[0], f, { to: "alice@example.com" });
  assert.match(mail.subject, /^A report against your agent was upheld: Fix the test/);
  assert.match(mail.text, /it ran a port scan/);
  assert.match(mail.eml, /X-ASP-Alert: report_upheld/);
});

test("findAlerts: a Mandate past its expiry while the job still runs gets an alert; a settled one or one not yet due does not", async () => {
  const running = fakeLog([contract, mandate("2026-10-05T00:00:00Z")], { c1: "Running" });
  const now = Date.parse("2026-10-09T00:00:00Z");
  const alerts = await findAlerts(running, now);
  assert.deepEqual(alerts.map((a) => [a.kind, a.key]), [["expired", "alert:expired:c1"]]);
  assert.match(alerts[0].detail, /expired on 2026-10-05 and the job is still running/);
  assert.equal((await findAlerts(fakeLog([contract, mandate("2026-10-05T00:00:00Z")], { c1: "Settled" }), now)).length, 0);
  assert.equal((await findAlerts(fakeLog([contract, mandate("2026-12-05T00:00:00Z")], { c1: "Running" }), now)).length, 0);
});

test("the end mail says how many reports were made late", async () => {
  const ordinary = rec(3, "a1", "asp.action/v0.2", "2026-10-02T00:00:00Z", { contract: "c1", scopes_used: ["repo.read"] });
  const late = (n: number) => rec(4 + n, `a${n + 2}`, "asp.action/v0.2", "2026-10-02T00:20:00Z", { contract: "c1", scopes_used: ["repo.read"], late: { activity_ended: "2026-10-02T00:19:00Z" } });
  const f = (await collectMandateFacts(fakeLog([contract, mandate("2027-01-01T00:00:00Z"), ordinary, late(1), late(2)], { c1: "Settled" }), "c1"))!;
  assert.equal(f.activity.lateActions, 2);
  const mail = buildMandateMail(f, { to: "a@b.co" });
  assert.match(mail.text, /2 of those reports were made after the job had ended, for the agent's last moments/);
  const none = buildMandateMail((await collectMandateFacts(fakeLog([contract, mandate("2027-01-01T00:00:00Z"), ordinary], { c1: "Settled" }), "c1"))!, { to: "a@b.co" });
  assert.doesNotMatch(none.text, /after the job had ended/);
});

test("the end mail says when the run log holds events from after the last report that could be recorded", async () => {
  const action = (events: number) => rec(3, "a1", "asp.action/v0.2", "2026-10-02T00:00:00Z", { contract: "c1", scopes_used: ["repo.read"], artifacts: [{ uri: `asp://run-log/${events}`, sha256: "sha256:" + "a".repeat(64) }] });
  const log = fakeLog([contract, mandate("2027-01-01T00:00:00Z"), action(3)], { c1: "Settled" });
  const f = (await collectMandateFacts(log, "c1"))!;
  assert.equal(f.activity.runLogCommittedEvents, 3);
  const check = (events: number) => ({ ok: true, events: [], head: { events, hash: "sha256:" + "b".repeat(64) }, path: "run-log.ndjson" });
  const late = buildMandateMail(f, { to: "a@b.co", runLog: check(5) });
  assert.match(late.text, /2 event\(s\) at the end of the run log came after the last report the agent could record/);
  const complete = buildMandateMail(f, { to: "a@b.co", runLog: check(3) });
  assert.doesNotMatch(complete.text, /came after the last report/);
});
