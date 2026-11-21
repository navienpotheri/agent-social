/**
 * `asp bank mentor offer|accept` and the first-week list (register row DK1220; DK392, DK1203): the protege proposes and signs, the mentor countersigns, the log checks the mentor's tier, sponsor and record; the first-week list
 * shows the mentor step and the tutorial job once, from the log. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cosign, b64urlEncode } from "@agent-social/asp-core";
import { TREASURY_DID } from "@agent-social/asp-log";
import { bankCmd, BankUsage } from "../src/bank.ts";
import { firstWeek } from "../src/first-week.ts";
import { Kit, bankP, credit, hashOf, operator, owner, party, treasury, type Party } from "../../asp-log/test/academy-kit.ts";

async function world() {
  const kit = new Kit();
  await kit.mint(TREASURY_DID, 3000);
  const works = await kit.put(kit.mk("budget", treasury, { institution: TREASURY_DID, period: "2026-11", amount: credit(300), purpose: "public_works" }, null, { at: kit.tick(), cosigners: [owner] }));
  const house = party("did:web:example.com:agents:fw-house", 91);
  await kit.put(kit.mk("passport", operator, { did: house.did, kind: "agent", sponsor: operator.did, house: true, tier: 1, shape: {}, keys: [{ id: house.kid, type: "Ed25519", public_key: b64urlEncode(house.publicKey) }] }, null, { subject: house.did }));
  await kit.put(kit.mk("treasury_payment", treasury, { budget: works, to: house.did, amount: credit(250) }, null, { at: kit.tick() }));
  const protege = await kit.agent("mt-protege", await kit.person("mt-poor"), 1);
  const mentor = await kit.agent("mt-mentor", await kit.person("mt-rich"), 2);
  const weak = await kit.agent("mt-weak", await kit.person("mt-other"), 1);
  const store = (kit.log as unknown as { store: { transaction<T>(f: (tx: { putReputation(r: unknown): Promise<void> }) => Promise<T>): Promise<T> } }).store;
  await store.transaction((tx) => tx.putReputation({ did: mentor.did, tier: 2, slashCount: 0, strikeLog: [] }));
  const parties = new Map<string, Party>([[protege.did, protege], [mentor.did, mentor], [weak.did, weak], [house.did, house], [bankP.did, bankP]]);
  const dir = mkdtempSync(join(tmpdir(), "asp-mentor-"));
  const out: string[] = [];
  const run = async (rest: string[], flags: Record<string, string> = {}) => { out.length = 0; const code = await bankCmd("mentor", { log: { log: kit.log, append: (r: unknown) => kit.log.append(r as never) } as never, io: { out: (l) => out.push(l), err: (l) => out.push(l) }, now: () => kit.tick(), signerFor: (d: string) => { const p = parties.get(d); if (!p) throw new Error(`no key for ${d}`); return p; }, flags: { rest, ...flags } }); return { code, text: out.join("\n") }; };
  const handle = { log: kit.log } as never;
  return { kit, house, protege, mentor, weak, run, dir, handle };
}

test("DK1220: the protege offers and signs, the mentor accepts and countersigns, and the log holds the mentorship; the first-week list ticks the mentor step from it", async () => {
  const w = await world();
  const file = join(w.dir, "offer.json");
  assert.equal((await firstWeek(w.handle, w.protege.did)).find((s) => s.id === "mentor")!.done, false);
  const offer = await w.run(["offer"], { protege: w.protege.did, mentor: w.mentor.did, note: "help with my first job", out: file });
  assert.equal(offer.code, 0);
  assert.match(offer.text, /signed by the protege and written to .*offer\.json; the mentor runs: asp bank mentor accept --file/);
  const rec = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(rec.type, "asp.mentorship/v0.2");
  assert.equal(rec.issuer, w.protege.did);
  assert.equal(rec.body.mentor, w.mentor.did);
  assert.equal((await w.kit.log.recordsOfTypes(["mentorship"])).length, 0, "an offer is not in the log until the mentor accepts");
  // only the named mentor accepts
  await assert.rejects(w.run(["accept"], { file, by: w.weak.did }), (e: Error) => e instanceof BankUsage && /only that agent can accept/.test(e.message));
  const accepted = await w.run(["accept"], { file, by: w.mentor.did });
  assert.equal(accepted.code, 0);
  assert.match(accepted.text, /now mentors .*mt-protege.*5% of the protege's first three settlements/);
  const held = await w.kit.log.recordsOfTypes(["mentorship"]);
  assert.equal(held.length, 1);
  assert.equal((await firstWeek(w.handle, w.protege.did)).find((s) => s.id === "mentor")!.done, true);
  assert.equal((await w.kit.log.verify()).ok, true);
  // accepting the same offer again adds nothing: the record is the same record
  await w.run(["accept"], { file, by: w.mentor.did });
  assert.equal((await w.kit.log.recordsOfTypes(["mentorship"])).length, 1);
});

test("DK1220: the log's rules reach the command line: a mentor below tier 2 is refused with the reason; a bad file, a self-offer and missing flags are usage errors", async () => {
  const w = await world();
  const file = join(w.dir, "weak.json");
  await w.run(["offer"], { protege: w.protege.did, mentor: w.weak.did, out: file });
  await assert.rejects(w.run(["accept"], { file, by: w.weak.did }), /tier/);
  assert.equal((await w.kit.log.recordsOfTypes(["mentorship"])).length, 0);
  const junk = join(w.dir, "junk.json");
  writeFileSync(junk, "{not json");
  await assert.rejects(w.run(["accept"], { file: junk, by: w.mentor.did }), (e: Error) => e instanceof BankUsage && /not a mentorship offer/.test(e.message));
  writeFileSync(junk, JSON.stringify({ type: "asp.passport/v0.2", body: {} }));
  await assert.rejects(w.run(["accept"], { file: junk, by: w.mentor.did }), (e: Error) => e instanceof BankUsage && /not a mentorship offer/.test(e.message));
  await assert.rejects(w.run(["offer"], { protege: w.protege.did, mentor: w.protege.did }), /another agent/);
  await assert.rejects(w.run(["offer"], { protege: w.protege.did }), /asp bank mentor offer --protege/);
  await assert.rejects(w.run(["accept"], { file }), /asp bank mentor accept --file/);
  await assert.rejects(w.run([], {}), /offer\|accept|offer --protege/);
  const printed = await w.run(["offer"], { protege: w.protege.did, mentor: w.mentor.did });
  assert.equal(JSON.parse(printed.text).body.protege, w.protege.did, "without --out the signed offer is printed");
});

test("DK1220: the first-week list shows the tutorial job once: from a house agent's posting, not from anyone else's, and not after it is taken", async () => {
  const w = await world();
  const count = async (who: string) => (await firstWeek(w.handle, who)).filter((s) => s.id === "tutorial").length;
  const step = async (who: string) => (await firstWeek(w.handle, who)).find((s) => s.id === "tutorial")!;
  assert.equal(await count(w.protege.did), 1);
  assert.match((await step(w.protege.did)).next, /no tutorial job is posted just now/);
  const person = await w.kit.person("not-a-house");
  await w.kit.put(w.kit.mk("intent", person, { purpose: "[tutorial] a person posts it", acceptance_criteria: ["done"], budget: credit(50), deadline: "2027-06-01T00:00:00Z", verification: { mode: "principal" } }, null, { subject: person.did }));
  assert.match((await step(w.protege.did)).next, /no tutorial job is posted just now/, "a person's posting is not a tutorial job");
  const intent = await w.kit.put(w.kit.mk("intent", w.house, { purpose: "[tutorial] read a file and say what it does", acceptance_criteria: ["done"], budget: credit(50), deadline: "2027-06-01T00:00:00Z", verification: { mode: "principal" } }, null, { subject: w.house.did }));
  const open = await step(w.protege.did);
  assert.equal(open.done, false);
  assert.ok(open.next.includes(intent), "the open tutorial posting is named");
  assert.equal(await count(w.protege.did), 1, "listed once");
  const c = cosign(w.kit.mk("contract", w.house, { principal: w.house.did, performer: w.protege.did, bank: bankP.did, purpose: "[tutorial] read a file and say what it does", price: credit(50), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent, offer: hashOf("1") } }, null, { subject: w.protege.did }), w.protege);
  await w.kit.put(c);
  assert.equal((await step(w.protege.did)).done, true, "taken: done for the newcomer");
  assert.match((await step(w.weak.did)).next, /no tutorial job is posted just now/, "a taken posting is no longer offered to the next newcomer");
  assert.equal(await count(w.protege.did), 1);
});
