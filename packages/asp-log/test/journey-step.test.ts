// The journey step's core logic (register rows DK1300 and DK1301; found by a mutation check to be reached only through the slow page tests): which records are the agent's and in what role, the other parties named (at most four, once
// each), the amount taken from the body, the text of a record shown only in the sponsor view, and the kind and credit flow of a few record types. Synthetic stored records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepOf, type JourneyCtx } from "../src/journey.ts";

const ME = "did:web:example.com:agents:me";
const rec = (type: string, issuer: string, body: Record<string, unknown>, o: { subject?: string | null; seq?: number } = {}) => ({ seq: o.seq ?? 1, id: `sha256:${"1".repeat(64)}`, record: { type: `asp.${type}/v0.2`, issuer, subject: o.subject ?? null, issued_at: "2026-11-22T00:00:00Z", body } }) as never;
const ctx = (contracts: [string, { principal: string; performer: string; price?: number }][] = []): JourneyCtx => ({ contracts: new Map(contracts.map(([k, v]) => [k, { price: undefined, ...v } as never])) });

test("a record is the agent's as issuer, subject, or a role in its body, or through a contract it is party to; otherwise it is not in the journey", () => {
  assert.equal(stepOf(rec("mint", ME, { to: ME, amount: { value: 5, unit: "credit" }, reason: "x" }), ME, ctx(), "public")!.role, "issuer");
  assert.equal(stepOf(rec("mint", "did:web:op", { to: ME, amount: { value: 5, unit: "credit" }, reason: "x" }, { subject: ME }), ME, ctx(), "public")!.role, "subject");
  assert.equal(stepOf(rec("mint", "did:web:op", { to: ME, amount: { value: 5, unit: "credit" }, reason: "x" }), ME, ctx(), "public")!.role, "to", "named in the body as `to`");
  assert.equal(stepOf(rec("mint", "did:web:op", { to: "did:web:other", amount: { value: 5, unit: "credit" }, reason: "x" }), ME, ctx(), "public"), undefined, "someone else's mint");
  const linked = ctx([["sha256:" + "c".repeat(64), { principal: "did:web:p", performer: ME }]]);
  assert.equal(stepOf(rec("mandate", "did:web:p", { contract: "sha256:" + "c".repeat(64) }), ME, linked, "public")!.role, "performer");
  assert.equal(stepOf(rec("mandate", "did:web:p", { contract: "sha256:" + "c".repeat(64) }), "did:web:p", linked, "public")!.role, "issuer", "the issuer is the issuer before it is the principal");
  assert.equal(stepOf(rec("mandate", "did:web:q", { contract: "sha256:" + "d".repeat(64) }), ME, linked, "public"), undefined, "a contract the agent is not party to");
});

test("the other parties are named once each and at most four; the amount comes from the body; the text is the sponsor's view only", () => {
  const body = { to: ME, amount: { value: 7, unit: "credit" }, reason: "starter", note: "a private note", others: ["did:web:a1", "did:web:a1", "did:web:a2", "did:web:a3", "did:web:a4", "did:web:a5"] };
  const pub = stepOf(rec("mint", "did:web:op", body), ME, ctx(), "public")!;
  assert.deepEqual(pub.with, ["a1", "a2", "a3", "a4"], "four names, a repeat once; those named in the body come before the issuer, so the issuer and a5 are cut");
  assert.equal(pub.amount, 7);
  assert.equal(pub.detail, undefined, "the public view carries no text");
  assert.equal(stepOf(rec("mint", "did:web:op", body), ME, ctx(), "sponsor")!.detail, "starter", "the first detail key present (reason before note)");
  assert.equal(stepOf(rec("mint", "did:web:op", { ...body, reason: undefined }), ME, ctx(), "sponsor")!.detail, "a private note");
  assert.equal(stepOf(rec("mint", "did:web:op", { ...body, price: 3 }), ME, ctx(), "public")!.amount, 7, "the amount key that comes first wins");
});

test("a few record types: a mint and a starter claim are credits in, a passport is joined for itself and sponsored for another, a message is sent or received by who the agent is", () => {
  const mint = stepOf(rec("mint", "did:web:op", { to: ME, amount: { value: 5, unit: "credit" }, reason: "starter" }), ME, ctx(), "public")!;
  assert.deepEqual([mint.kind, mint.flow], ["credits_in", { dir: "in", credits: 5, why: "starter" }]);
  const claim = stepOf(rec("starter_claim", ME, { part: "upfront", amount: { value: 100, unit: "credit" } }), ME, ctx(), "public")!;
  assert.deepEqual([claim.kind, claim.flow?.credits, claim.flow?.why], ["credits_in", 100, "starter"]);
  assert.equal(stepOf(rec("passport", ME, { did: ME, kind: "agent", sponsor: "did:web:s" }), ME, ctx(), "public")!.kind, "joined");
  assert.match(stepOf(rec("passport", ME, { did: ME, kind: "agent", sponsor: "did:web:s" }), ME, ctx(), "public")!.text, /sponsored by s/);
  assert.equal(stepOf(rec("passport", "did:web:s", { did: "did:web:kid", kind: "agent", sponsor: "did:web:s" }, { subject: "did:web:kid" }), "did:web:s", ctx(), "public")!.kind, "sponsored");
  assert.equal(stepOf(rec("agent_message", ME, { to: "did:web:you", kind: "note" }), ME, ctx(), "public")!.kind, "message_sent");
  assert.equal(stepOf(rec("agent_message", "did:web:you", { to: ME, kind: "note" }), ME, ctx(), "public")!.kind, "message_received");
});

test("a party named in the body and again through the contract is named once, and a record the agent both issued and is the subject of is read as issued", () => {
  const cid = "sha256:" + "e".repeat(64);
  const c = ctx([[cid, { principal: "did:web:op", performer: ME }]]);
  const s = stepOf(rec("mandate", "did:web:op", { contract: cid, signed_by: "did:web:op" }), ME, c, "public")!;
  assert.deepEqual(s.with, ["op"], "the same party from the body, the contract and the issuer is one name");
  assert.equal(stepOf(rec("mint", ME, { to: ME, amount: { value: 1, unit: "credit" }, reason: "x" }, { subject: ME }), ME, ctx(), "public")!.role, "issuer");
});
