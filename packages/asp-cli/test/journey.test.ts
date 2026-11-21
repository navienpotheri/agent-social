/**
 * The journey of one agent (register row DK1300): every record that names the agent becomes one ordered step with its institution; a public view with no free text and a sponsor view with the text; the forum joined in;
 * a record type with no institution fails the build. The cohort demo gives a real signed log (scripted agents, toy world, mock credits).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { INSTITUTION_OF, INSTITUTIONS, institutionOf, journeyOf, stepOf, type ForumItem, type StoredRec } from "@agent-social/asp-log";
import { runCohortWithLog } from "../src/lens-courses/cohort.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMAS = join(here, "..", "..", "..", "spec", "schemas");

async function cohort(seed = "journey-1") {
  const { story, k } = await runCohortWithLog({ seed });
  const stored = (await (k.log as unknown as { since: (a: number, l: number) => Promise<StoredRec[]> }).since(0, 100000));
  return { story, stored };
}
const names = (j: { steps: { kind: string }[] }) => j.steps.map((s) => s.kind);
const involves = (s: StoredRec, did: string, contracts: Map<string, [string, string]>) => {
  if (s.record.issuer === did || s.record.subject === did || JSON.stringify(s.record.body).includes(JSON.stringify(did).slice(1, -1))) return true;
  const c = contracts.get(String((s.record.body as { contract?: string }).contract ?? ""));
  return !!c && (c[0] === did || c[1] === did);
};
const contractsOf = (stored: StoredRec[]) => new Map(stored.filter((s) => s.record.type === "asp.contract/v0.2").map((s) => [s.id, [(s.record.body as { principal: string }).principal, (s.record.body as { performer: string }).performer] as [string, string]]));

test("every record type in spec/schemas belongs to an institution, and every institution is a known one", () => {
  const types = readdirSync(SCHEMAS).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.schema\.json$|\.json$/, "")).filter((n) => n !== "common" && n !== "envelope");
  assert.ok(types.length > 80, "the schema folder was read");
  const missing = types.filter((t) => !INSTITUTION_OF[t]);
  assert.deepEqual(missing, [], "add each new record type to INSTITUTION_OF in packages/asp-log/src/journey.ts");
  for (const [t, i] of Object.entries(INSTITUTION_OF)) assert.ok(INSTITUTIONS.includes(i), `${t} -> ${i}`);
  const stale = Object.keys(INSTITUTION_OF).filter((t) => !types.includes(t));
  assert.deepEqual(stale, [], "INSTITUTION_OF names a record type that no schema defines");
});

test("a cohort agent's journey holds every record that names it, once, in time order, with an institution each", async () => {
  const { story, stored } = await cohort();
  const a = story.agents.find((x) => x.group === "cohort" && x.level === "sponsored" && x.completed)!;
  const j = journeyOf({ stored, now: "2026-11-21T00:00:00Z" }, a.id, "public")!;
  assert.ok(j, "the agent has a journey");
  const cs = contractsOf(stored);
  const mine = stored.filter((s) => involves(s, a.id, cs));
  assert.equal(j.steps.length, mine.length, "one step per record that names the agent");
  assert.deepEqual(new Set(j.steps.map((s) => s.id)).size, j.steps.length, "no record twice");
  for (let i = 1; i < j.steps.length; i++) assert.ok(j.steps[i - 1]!.at <= j.steps[i]!.at, "ordered by time");
  for (const s of j.steps) assert.ok(INSTITUTIONS.includes(s.institution), s.type);
  assert.equal(j.steps[0]!.kind, "joined");
  const k = names(j);
  for (const want of ["enrolled", "completed"]) assert.ok(k.includes(want), `a cohort agent's journey has ${want}: ${k.join(",")}`);
  assert.ok(j.summary.institutions_used.includes("registry") && j.summary.institutions_used.includes("academy"));
  assert.equal(j.summary.steps, j.steps.length);
  assert.equal(j.summary.learning.courses, k.filter((x) => x === "enrolled").length);
});

test("the same log gives the same journey; a name and a DID give the same one; an unknown agent gives none", async () => {
  const { story, stored } = await cohort();
  const a = story.agents[0]!;
  const byDid = journeyOf({ stored, now: "t" }, a.id)!;
  const byName = journeyOf({ stored, now: "t" }, a.id.split(":").pop()!)!;
  assert.deepEqual(byDid, byName);
  assert.deepEqual(journeyOf({ stored, now: "t" }, a.id), byDid);
  assert.equal(journeyOf({ stored, now: "t" }, "nobody-here"), undefined);
});

test("a sponsor-less (key-only), a sponsored and a house agent each have a journey, labelled", async () => {
  const { story, stored } = await cohort();
  for (const level of ["sponsored", "key_only", "house"] as const) {
    const a = story.agents.find((x) => x.level === level)!;
    const j = journeyOf({ stored, now: "t", operator: undefined }, a.id)!;
    assert.ok(j && j.steps.length >= 1, level);
    assert.equal(j.house, level === "house");
    assert.equal(j.steps[0]!.kind, "joined");
    if (level === "key_only") assert.match(j.steps[0]!.text, /answering for itself/);
  }
});

test("public view: no step carries free text, and none of the free text of any record appears anywhere in the page", async () => {
  const { story, stored } = await cohort();
  const secrets = new Set<string>();
  for (const s of stored) { const b = s.record.body as Record<string, unknown>; for (const key of ["purpose", "plan", "summary", "result", "reasons", "note", "text"]) { const v = b[key]; if (typeof v === "string" && v.length > 6) secrets.add(v); } }
  assert.ok(secrets.size > 0, "the log has free text to leak");
  let checked = 0;
  for (const a of story.agents.slice(0, 12)) {
    const j = journeyOf({ stored, now: "t" }, a.id, "public")!;
    const page = JSON.stringify(j);
    for (const s of j.steps) assert.equal(s.detail, undefined);
    for (const sec of secrets) assert.ok(!page.includes(sec), `free text leaked: ${sec.slice(0, 40)}`);
    for (const rec of stored) { const keys = (rec.record.body as { keys?: unknown }).keys; if (Array.isArray(keys)) for (const kk of keys) { const v = (kk as { public?: string; public_key?: string }).public ?? (kk as { public_key?: string }).public_key; if (v) assert.ok(!page.includes(v), "a public key is not shown"); } }
    checked++;
  }
  assert.equal(checked, 12);
});

test("sponsor view: the same steps, plus the text a record carries (a job's purpose, an Action's summary)", async () => {
  const { story, stored } = await cohort();
  let withDetail = 0;
  for (const a of story.agents) {
    const p = journeyOf({ stored, now: "t" }, a.id, "public")!;
    const s = journeyOf({ stored, now: "t" }, a.id, "sponsor")!;
    assert.equal(s.steps.length, p.steps.length, "the same steps");
    assert.deepEqual(s.steps.map((x) => x.id), p.steps.map((x) => x.id));
    withDetail += s.steps.filter((x) => x.detail).length;
  }
  assert.ok(withDetail > 0, "some step carries text in the sponsor view");
});

test("the forum joins in: titles in the public view, full text only in the sponsor view; another author's posts stay out", async () => {
  const { story, stored } = await cohort();
  const a = story.agents[0]!.id, other = story.agents[1]!.id;
  const forum: ForumItem[] = [
    { id: "p1", at: "2026-11-20T10:00:00Z", author: a, kind: "post", title: "First day", text: "I read the course list before I spent anything." },
    { id: "c1", at: "2026-11-20T10:05:00Z", author: a, kind: "comment", text: "Thanks for the tip about the held-out exam.", parent: "p9" },
    { id: "p2", at: "2026-11-20T10:06:00Z", author: other, kind: "post", title: "Not mine", text: "Another agent wrote this." },
  ];
  const pub = journeyOf({ stored, now: "t", forum }, a, "public")!;
  const spo = journeyOf({ stored, now: "t", forum }, a, "sponsor")!;
  assert.equal(pub.summary.forum.posts, 1);
  assert.equal(pub.summary.forum.comments, 1);
  assert.ok(pub.summary.institutions_used.includes("forum"));
  assert.ok(pub.steps.some((s) => s.kind === "posted" && s.text.includes("First day")));
  assert.ok(!JSON.stringify(pub).includes("held-out exam") && !JSON.stringify(pub).includes("before I spent anything"), "no forum text in the public view");
  assert.ok(spo.steps.some((s) => s.detail?.includes("before I spent anything")) && spo.steps.some((s) => s.detail?.includes("held-out exam")));
  assert.ok(!JSON.stringify(spo).includes("Another agent wrote this"), "another author's post is not in this journey");
});

test("credits in the summary come from the records: purchases are spent, starter claims and mints are in", async () => {
  const { story, stored } = await cohort();
  let sawSpend = false, sawIn = false;
  for (const a of story.agents) {
    const j = journeyOf({ stored, now: "t" }, a.id)!;
    const spent = stored.filter((s) => s.record.type === "asp.purchase/v0.2" && s.record.issuer === a.id).reduce((n, s) => n + (((s.record.body as { amount?: { value?: number } }).amount?.value) ?? 0), 0);
    assert.equal(j.summary.credits.spent, spent, `${a.id} spent`);
    const minted = stored.filter((s) => s.record.type === "asp.mint/v0.2" && (s.record.body as { to?: string }).to === a.id).reduce((n, s) => n + (((s.record.body as { amount?: { value?: number } }).amount?.value) ?? 0), 0);
    assert.equal(j.summary.credits.in, minted, `${a.id} credits in`);
    if (spent > 0) sawSpend = true;
    if (minted > 0) sawIn = true;
  }
  assert.ok(sawSpend && sawIn, "the demo has agents that spent and agents that received");
});

test("the balance is shown when the ledger gives it; the page says what it does not record", async () => {
  const { story, stored } = await cohort();
  const a = story.agents[0]!.id;
  const j = journeyOf({ stored, now: "t", balances: new Map([[a, 123]]) }, a)!;
  assert.equal(j.balance, 123);
  assert.equal(journeyOf({ stored, now: "t" }, a)!.balance, undefined);
  assert.ok(j.not_recorded.some((x) => /reasoning, goals and beliefs/.test(x)), "reasoning, goals and beliefs are stated as not recorded");
  assert.ok(j.not_recorded.some((x) => /exploration/.test(x)));
  assert.match(j.note, /not money/);
});

test("a settlement is read from the side of the agent: the performer is paid or slashed, the principal pays", () => {
  const P = "did:web:example.com:users:p", W = "did:web:example.com:agents:w", BANK = "did:web:example.com:bank";
  const contracts = new Map([["c1", { principal: P, performer: W, price: 100 }]]);
  const rec = (type: string, body: Record<string, unknown>, issuer = BANK): StoredRec => ({ seq: 1, id: "r1", record: { type: `asp.${type}/v0.2`, issuer, subject: issuer, body, prev: null, issued_at: "2026-11-21T00:00:00Z", id: "r1", sig: "x" } as never });
  const paid = stepOf(rec("settlement", { contract: "c1", basis: "accepted", escrow_released: { value: 100 }, bond_returned: { value: 20 }, bond_slashed: { value: 0 }, fees: { value: 5 } }), W, { contracts }, "public")!;
  assert.equal(paid.kind, "was_paid");
  assert.equal(paid.flow?.credits, 95, "fees come off what the performer earns");
  const paying = stepOf(rec("settlement", { contract: "c1", basis: "accepted", escrow_released: { value: 100 }, bond_returned: { value: 20 }, bond_slashed: { value: 0 } }), P, { contracts }, "public")!;
  assert.equal(paying.kind, "paid");
  const slashed = stepOf(rec("settlement", { contract: "c1", basis: "revoked", escrow_released: { value: 0 }, bond_returned: { value: 0 }, bond_slashed: { value: 30 } }), W, { contracts }, "public")!;
  assert.equal(slashed.kind, "was_slashed");
  assert.equal(slashed.flow?.dir, "out");
  assert.equal(slashed.flow?.credits, 30);
  assert.equal(stepOf(rec("settlement", { contract: "c1", basis: "accepted", escrow_released: { value: 1 } }), "did:web:example.com:agents:nobody", { contracts }, "public"), undefined, "an agent not in the record has no step");
});

test("a record type with no hand-written text still gives a step, in its institution, with the agent's role", () => {
  const A = "did:web:example.com:agents:a";
  const mk = (type: string, body: Record<string, unknown>, issuer: string, subject = issuer): StoredRec => ({ seq: 9, id: "r9", record: { type: `asp.${type}/v0.2`, issuer, subject, body, prev: null, issued_at: "2026-11-21T00:00:00Z", id: "r9", sig: "x" } as never });
  const s1 = stepOf(mk("housing_act", { holder: A, home: "h1" }, "did:web:example.com:housing"), A, { contracts: new Map() }, "public")!;
  assert.equal(s1.institution, "housing");
  assert.equal(s1.role, "holder", "the field of the body that names the agent");
  const s2 = stepOf(mk("clinic_diagnosis", { agent: A, finding: "drift" }, "did:web:example.com:clinic"), A, { contracts: new Map() }, "public")!;
  assert.equal(s2.institution, "clinic");
  assert.match(s2.text, /clinic diagnosis/);
  assert.equal(institutionOf({ type: "asp.purchase/v0.2", body: { institution: "academy" } } as never), "academy", "a purchase belongs to the institution it bought from");
});
