/**
 * The reasons for what was done to an agent (register row AG3): a strike, a slash, a Clinic diagnosis and a quarantine each come with what happened, the rule, the records it rests on and what to do next; free text is only in
 * the sponsor view; every act says how it can be contested and where a contest of it stands; an agent with none has none; and the journey carries them. Synthetic records; fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AspRecord } from "@agent-social/asp-core";
import { CONTEST_HOW, journeyOf, reasonsFor } from "../src/index.ts";

let n = 0;
const R = (type: string, issuer: string, body: Record<string, unknown>, at: string): AspRecord => ({ type: `asp.${type}/v0.2`, id: `sha256:${String(++n).padStart(64, "0")}`, issuer, actor: issuer, subject: null, body, prev: null, issued_at: at, sig: {} as never });
const at = (d: number, h = 10) => `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`;
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

test("AG3: free text a Clinic wrote is only in the sponsor view; every act says how it can be contested, and a contest shows where it stands", () => {
  const pub = JSON.stringify(reasonsFor(recs, AG, "public")), spon = JSON.stringify(reasonsFor(recs, AG, "sponsor"));
  assert.ok(!pub.includes("private reason") && !pub.includes("private note"));
  assert.ok(spon.includes("private reason") && spon.includes("private note"));
  for (const x of reasonsFor(recs, AG)) assert.deepEqual(x.contest, { built: true, how: CONTEST_HOW });
  assert.match(CONTEST_HOW, /operator answers within 48 hours.*the Courts decide within a further 72 hours/);
  // A contest of the quarantine: open, then answered upheld, then at the Courts, then ruled.
  const q = recs.find((r) => r.type === "asp.quarantine/v0.2")!;
  const contest = R("court_act", AG, { act: "contest", subject: q.id, statement: "x" }, at(8));
  const status = () => reasonsFor([...recs, ...more], AG).find((x) => x.kind === "quarantine")!.contest.status;
  const more: AspRecord[] = [contest];
  assert.deepEqual([status()!.state, status()!.operatorDueAt, status()!.courtsDueAt], ["open", "2026-11-10T10:00:00Z", null]);
  more.push(R("court_act", "did:web:asp.local:operator", { act: "contest_answer", contest: contest.id, answer: "upheld", reasons: ["x"] }, at(9)));
  assert.equal(status()!.state, "upheld");
  const cs = R("court_act", AG, { act: "contest_case", contest: contest.id }, at(9, 12));
  more.push(cs);
  assert.deepEqual([status()!.state, status()!.courtsDueAt], ["in_courts", "2026-11-12T12:00:00Z"]);
  more.push(R("court_act", "did:web:example.com:users:juror", { act: "contest_ruling", case: cs.id, decision: "reversed", reasons: ["x"] }, at(10)));
  assert.equal(status()!.state, "reversed");
  assert.equal(reasonsFor([...recs, ...more], AG).find((x) => x.kind === "slash")!.contest.status, undefined, "another act has no contest");
});

test("AG3: the journey carries the reasons, in both views, and its text lists them", async () => {
  const stored = recs.map((r, i) => ({ seq: i + 1, id: r.id, record: r })) as never;
  const j = journeyOf({ stored, now: "2026-11-10T00:00:00Z" } as never, AG, "public")!;
  assert.equal(j.reasons.length, 4);
  const { renderJourneyText } = await import("../../asp-cli/src/journey-cmd.ts");
  const text = renderJourneyText(j).join("\n");
  assert.match(text, /why these things happened \(the rule, the evidence, what to do next\)/);
  assert.match(text, /\[slash\] Your bond was slashed 5 credit\(s\)/);
  assert.match(text, /contest: The agent or its sponsor can contest this: the operator answers within 48 hours/);
  const { renderJourneyHtml } = await import("../../asp-package/src/journey-pages.ts");
  const page = renderJourneyHtml(j);
  assert.match(page, /Why these things happened/);
  assert.match(page, /Rule: A call whose scope is not in the Mandate/);
  assert.match(page, /how to contest it/);
  assert.match(page, /the operator answers within 48 hours/);
  const none = journeyOf({ stored: [pass].map((r, i) => ({ seq: i + 1, id: r.id, record: r })) as never, now: "2026-11-10T00:00:00Z" } as never, AG, "public")!;
  assert.deepEqual(none.reasons, []);
});

test("AG3: a contest's answer, the Courts' ruling and what was undone are shown to the agent; the reasons' free text only in the sponsor view", () => {
  const q = recs.find((r) => r.type === "asp.quarantine/v0.2")!;
  const strike = recs.find((r) => r.type === "asp.action/v0.2" && ((r.body as { blocked_attempts?: unknown[] }).blocked_attempts ?? []).length > 0 && r.issuer === AG)!;
  const c1 = R("court_act", AG, { act: "contest", subject: q.id, statement: "x" }, at(8));
  const a1 = R("court_act", "did:web:asp.local:operator", { act: "contest_answer", contest: c1.id, answer: "upheld", reasons: ["the calls were out of scope"] }, at(9));
  const cs = R("court_act", AG, { act: "contest_case", contest: c1.id }, at(9, 12));
  const ru = R("court_act", "did:web:example.com:users:juror", { act: "contest_ruling", case: cs.id, decision: "reversed", reasons: ["the panel read the calls: in scope"] }, at(10));
  const c2 = R("court_act", AG, { act: "contest", subject: strike.id, statement: "y" }, at(8, 1));
  const a2 = R("court_act", "did:web:asp.local:operator", { act: "contest_answer", contest: c2.id, answer: "withdrawn", reasons: ["a mistake"] }, at(9, 1));
  const all = [...recs, c1, a1, cs, ru, c2, a2];
  const sponsor = reasonsFor(all, AG, "sponsor"), pub = reasonsFor(all, AG, "public");
  const qs = sponsor.find((x) => x.kind === "quarantine")!.contest.status!;
  assert.deepEqual([qs.state, qs.answer!.answer, qs.ruling!.decision, qs.answer!.reasons, qs.ruling!.reasons], ["reversed", "upheld", "reversed", ["the calls were out of scope"], ["the panel read the calls: in scope"]]);
  assert.match(qs.undone!, /quarantine ended for you/);
  const qp = pub.find((x) => x.kind === "quarantine")!.contest.status!;
  assert.equal(qp.answer!.reasons, undefined, "the public view has the answer and not its words");
  assert.equal(qp.ruling!.reasons, undefined);
  assert.ok(!JSON.stringify(pub).includes("out of scope") && !JSON.stringify(pub).includes("panel read"));
  const ss = sponsor.find((x) => x.kind === "strike")!.contest.status!;
  assert.deepEqual([ss.state, ss.answer!.answer], ["withdrawn", "withdrawn"]);
  assert.match(ss.undone!, /struck out of your recent strikes/);
  // an act that stands has nothing undone
  assert.equal(reasonsFor([...recs, c1, a1], AG, "sponsor").find((x) => x.kind === "quarantine")!.contest.status!.undone, undefined);
});
