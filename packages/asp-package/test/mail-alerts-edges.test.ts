// The alert finder's edges (register rows E10 and E13; found loose by a mutation check): a revoked settlement is a kill only when the bond was slashed, a Mandate that expires exactly now has expired, a job waiting on a checkpoint is
// still running, and the latest Mandate of a contract is the one that counts. Fake log, no signing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findAlerts, alertRecipients } from "../src/mail.ts";

type S = { id: string; seq: number; record: { type: string; issuer: string; issued_at: string; body: any } };
let n = 0;
const rec = (type: string, body: any, at = "2026-11-20T00:00:00Z", issuer = "did:web:x"): S => ({ id: `r${++n}`, seq: n, record: { type, issuer, issued_at: at, body } });
const log = (recs: S[], states: Record<string, string>) => ({ since: async () => recs, chainInfo: async (c: string) => (states[c] ? { state: states[c] } : undefined), get: async () => undefined }) as never;

test("a revoked settlement is a kill only when the bond was slashed", async () => {
  const slashed = rec("asp.settlement/v0.2", { contract: "c1", basis: "revoked", bond_slashed: { value: 5, unit: "credit" } });
  const plain = rec("asp.settlement/v0.2", { contract: "c2", basis: "revoked", bond_slashed: { value: 0, unit: "credit" } });
  const alerts = await findAlerts(log([slashed, plain], {}), Date.parse("2026-11-21T00:00:00Z"));
  assert.deepEqual(alerts.map((a) => [a.kind, a.contract]), [["killed", "c1"]]);
});

test("a Mandate that expires exactly now has expired; a job waiting on a checkpoint is still running; the latest Mandate counts", async () => {
  const now = Date.parse("2026-11-21T00:00:00Z");
  const at = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const m = (contract: string, expires: string, issued = "2026-11-01T00:00:00Z") => rec("asp.mandate/v0.2", { contract, expires }, issued);
  const exact = await findAlerts(log([m("c1", at(now))], { c1: "Running" }), now);
  assert.equal(exact.length, 1, "expiring at this very second is expired");
  assert.equal((await findAlerts(log([m("c1", at(now + 1000))], { c1: "Running" }), now)).length, 0, "a second later is not");
  assert.equal((await findAlerts(log([m("c2", at(now - 1000))], { c2: "Checkpoint" }), now)).length, 1, "waiting on a checkpoint is still running");
  assert.equal((await findAlerts(log([m("c3", at(now - 1000))], { c3: "Settled" }), now)).length, 0, "a settled job does not alert");
  // the latest Mandate counts: an old one that expired is replaced by a later one that has not
  const older = m("c4", at(now - 5000), "2026-11-02T00:00:00Z"), newer = m("c4", at(now + 86_400_000), "2026-11-10T00:00:00Z");
  assert.equal((await findAlerts(log([older, newer], { c4: "Running" }), now)).length, 0, "the later Mandate has not expired");
});

test("the reporter is told of an upheld report only, and the sponsor of a kill or an upheld report only", () => {
  const addresses = { p: "p@x.org", s: "s@x.org", r: "r@x.org" };
  const expired = alertRecipients({ key: "k", kind: "expired", contract: "c", at: "", detail: "", record: "r1", reporter: "r" }, "p", "s", addresses);
  assert.deepEqual(expired.map((x) => x.role), ["principal"], "an expiry goes to the principal alone, even when a reporter is named");
  const killed = alertRecipients({ key: "k", kind: "killed", contract: "c", at: "", detail: "", record: "r1", reporter: "r" }, "p", "s", addresses);
  assert.deepEqual(killed.map((x) => x.role), ["principal", "sponsor"], "a kill never goes to a reporter");
});
