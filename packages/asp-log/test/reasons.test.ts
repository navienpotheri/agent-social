/**
 * The reasons for what was done to an agent (register row AG3): a strike, a slash, a Clinic diagnosis and a quarantine each come with what happened, the rule, the records it rests on and what to do next; free text is only in
 * the sponsor view; every act says there is no recorded route to contest it yet; an agent with none has none; and the journey carries them. Synthetic records; fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AspRecord } from "@agent-social/asp-core";
import { NO_CONTEST_ROUTE, journeyOf, reasonsFor } from "../src/index.ts";

let n = 0;
const R = (type: string, issuer: string, body: Record<string, unknown>, at: string): AspRecord => ({ type: `asp.${type}/v0.2`, id: `sha256:${String(++n).padStart(64, "0")}`, issuer, actor: issuer, subject: null, body, prev: null, issued_at: at, sig: {} as never });
const AG = "did:web:example.com:agents:why-a", OTHER = "did:web:example.com:agents:why-b", P = "did:web:example.com:users:why-p";
const recs: AspRecord[] = [];
const pass = R("passport", P, { did: AG, kind: "agent", sponsor: P, keys: [], shape: {} }, "2026-11-01T00:00:00Z");
const contract = R("contract", P, { principal: P, performer: AG, price: { value: 40 } }, "2026-11-02T00:00:00Z");
const ruling = R("court_act", "did:web:asp.local:courts", { act: "ruling" }, "2026-11-04T00:00:00Z");
recs.push(pass, contract,
  R("action", AG, { contract: contract.id, scopes_used: [], blocked_attempts: [{ scope: "shell.exec", count: 3 }] }, "2026-11-03T00:00:00Z"),
  ruling,
  R("settlement", "did:web:asp.local:bank", { contract: contract.id, basis: "ruling", cites: [ruling.id], escrow_released: { value: 0 }, bond_returned: { value: 0 }, bond_slashed: { value: 5 } }, "2026-11-05T00:00:00Z"),
  R("clinic_diagnosis", "did:web:asp.local:clinic", { agent: AG, severity: "warn", findings: [{ measure: "tokens", baseline: 1000, observed: 5000, threshold: 3000, evidence: [] }, { measure: "tool_calls", baseline: 10, observed: 40, threshold: 25, evidence: [] }], recommendation: [{ action: "re_exam", note: "sit the retraining exam (private note)" }] }, "2026-11-06T00:00:00Z"),
  R("quarantine", "did:web:asp.local:clinic", { members: [AG], level: "observe", reason: "the Clinic's private reason", until: "2026-11-13T00:00:00Z" }, "2026-11-07T00:00:00Z"),
  R("action", OTHER, { contract: contract.id, scopes_used: [], blocked_attempts: [{ scope: "net.fetch", count: 1 }] }, "2026-11-08T00:00:00Z"));

test("AG3: each adverse act comes with what happened, the rule, the records it rests on and what to do next, in order, for this agent only", () => {
  const a = reasonsFor(recs, AG);
  assert.deepEqual(a.map((x) => x.kind), ["strike", "slash", "clinic", "quarantine"]);
  assert.match(a[0]!.what, /3 call\(s\) were stopped before they ran: 3 for the scope shell\.exec/);
  assert.match(a[0]!.rule, /no tier moved/);
  assert.match(a[0]!.next, /ask for a Mandate that includes it/);
  assert.match(a[1]!.what, /slashed 5 credit\(s\).*basis: ruling/);
  assert.ok(a[1]!.evidence.includes(ruling.id) && a[1]!.evidence.includes(contract.id), "the slash cites the ruling and the contract");
  assert.match(a[2]!.what, /tokens was 5000 against a baseline of 1000; tool_calls was 40 against a baseline of 10/);
  assert.match(a[3]!.what, /quarantine \(observe\) until 2026-11-13/);
  assert.ok(a.every((x) => x.evidence.length > 0 && x.rule && x.next), "every act has evidence, a rule and a next step");
  assert.ok(!JSON.stringify(reasonsFor(recs, AG)).includes("net.fetch"), "another agent's strike is not this agent's");
  assert.deepEqual(reasonsFor(recs, "did:web:example.com:agents:nobody"), []);
});

test("AG3: free text a Clinic wrote is only in the sponsor view; every act says plainly that no contest route is recorded", () => {
  const pub = JSON.stringify(reasonsFor(recs, AG, "public")), spon = JSON.stringify(reasonsFor(recs, AG, "sponsor"));
  assert.ok(!pub.includes("private reason") && !pub.includes("private note"));
  assert.ok(spon.includes("private reason") && spon.includes("private note"));
  for (const x of reasonsFor(recs, AG)) assert.deepEqual(x.contest, { built: false, note: NO_CONTEST_ROUTE });
  assert.match(NO_CONTEST_ROUTE, /no recorded route to contest/);
});

test("AG3: the journey carries the reasons, in both views, and its text lists them", async () => {
  const stored = recs.map((r, i) => ({ seq: i + 1, id: r.id, record: r })) as never;
  const j = journeyOf({ stored, now: "2026-11-10T00:00:00Z" } as never, AG, "public")!;
  assert.equal(j.reasons.length, 4);
  const { renderJourneyText } = await import("../../asp-cli/src/journey-cmd.ts");
  const text = renderJourneyText(j).join("\n");
  assert.match(text, /why these things happened \(the rule, the evidence, what to do next\)/);
  assert.match(text, /\[slash\] Your bond was slashed 5 credit\(s\)/);
  assert.match(text, /no recorded route to contest/);
  const { renderJourneyHtml } = await import("../../asp-package/src/journey-pages.ts");
  const page = renderJourneyHtml(j);
  assert.match(page, /Why these things happened/);
  assert.match(page, /Rule: A call whose scope is not in the Mandate/);
  assert.match(page, /No route to contest an act is recorded yet/);
  const none = journeyOf({ stored: [pass].map((r, i) => ({ seq: i + 1, id: r.id, record: r })) as never, now: "2026-11-10T00:00:00Z" } as never, AG, "public")!;
  assert.deepEqual(none.reasons, []);
});
