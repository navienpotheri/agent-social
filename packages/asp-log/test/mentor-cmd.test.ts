// Row DK1220 (spec-delta S1452): `asp bank mentor offer | accept | show` write the mentorship records with the two signatures, and `asp first-week` lists the mentor and the tutorial job once. The log's own rules (DK392,
// DK1203) decide; the commands pass its refusals on. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64urlEncode, cosign, type Signer } from "@agent-social/asp-core";
import { BANK_DID, TREASURY_DID, TUTORIAL_LABEL } from "../src/index.ts";
import { firstWeek, firstWeekCmd } from "../../asp-cli/src/first-week.ts";
import { MentorUsage, mentorCmd, mentorshipsOf } from "../../asp-cli/src/mentor.ts";
import { Kit, bankP, credit, hashOf, operator, owner, party, treasury, type Party } from "./academy-kit.ts";

async function world() {
  const kit = new Kit();
  await kit.mint(TREASURY_DID, 3000);
  const works = await kit.put(kit.mk("budget", treasury, { institution: TREASURY_DID, period: "2026-11", amount: credit(300), purpose: "public_works" }, null, { at: kit.tick(), cosigners: [owner] }));
  const house = party("did:web:example.com:agents:tutorial-house", 90);
  await kit.put(kit.mk("passport", operator, { did: house.did, kind: "agent", sponsor: operator.did, house: true, tier: 1, shape: {}, keys: [{ id: house.kid, type: "Ed25519", public_key: b64urlEncode(house.publicKey) }] }, null, { subject: house.did }));
  await kit.put(kit.mk("treasury_payment", treasury, { budget: works, to: house.did, amount: credit(150) }, null, { at: kit.tick() }));
  const poorSponsor = await kit.person("poor-sponsor");
  const richSponsor = await kit.person("mentor-sponsor");
  const protege = await kit.agent("cmd-protege", poorSponsor, 1);
  const mentor = await kit.agent("cmd-mentor", richSponsor, 2);
  const lowMentor = await kit.agent("cmd-low-mentor", await kit.person("low-sponsor"), 1);
  const store = (kit.log as unknown as { store: { transaction<T>(f: (tx: { putReputation(r: unknown): Promise<void> }) => Promise<T>): Promise<T> } }).store;
  await store.transaction((tx) => tx.putReputation({ did: mentor.did, tier: 2, slashCount: 0, strikeLog: [] }));
  const keys = new Map<string, Party>([[protege.did, protege], [mentor.did, mentor], [lowMentor.did, lowMentor]]);
  const handle = { log: kit.log, append: (r: never) => kit.log.append(r) } as never;
  const dir = mkdtempSync(join(tmpdir(), "asp-mentor-"));
  const out: string[] = [], err: string[] = [];
  const run = (action: string | undefined, flags: Record<string, string | undefined>) => mentorCmd(action, {
    log: handle, io: { out: (l) => out.push(l), err: (l) => err.push(l) }, now: () => kit.tick(),
    signerFor: (did): Signer => { const k = keys.get(did); if (!k) throw new Error(`no key for ${did}: only its holder can sign for it`); return k; }, flags,
  });
  return { kit, house, protege, mentor, lowMentor, handle, dir, out, err, run, cleanup: () => rmSync(dir, { recursive: true, force: true }), works };
}
const rejects = async (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: Error) => re.test(e.message));

test("the protege's offer is signed by the protege alone and is not in the log; the mentor's accept countersigns it and the log holds a mentorship with both signatures", async () => {
  const w = await world();
  try {
    const file = join(w.dir, "offer.json");
    assert.equal(await w.run("offer", { protege: w.protege.did, mentor: w.mentor.did, note: "reviews my first jobs", out: file }), 0);
    const offer = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(offer.type, "asp.mentorship/v0.2");
    assert.equal(offer.issuer, w.protege.did);
    assert.deepEqual(offer.body, { mentor: w.mentor.did, protege: w.protege.did, note: "reviews my first jobs" });
    assert.ok(!offer.cosigs?.length, "the mentor has not signed");
    assert.equal((await mentorshipsOf(w.handle, w.protege.did)).length, 0, "an offer is not in the log");
    assert.match(w.out.join("\n"), /signed by .* only and not in the log/);

    assert.equal(await w.run("accept", { file, mentor: w.mentor.did }), 0);
    const [m] = await mentorshipsOf(w.handle, w.protege.did);
    assert.equal(m.mentor, w.mentor.did); assert.equal(m.protege, w.protege.did); assert.equal(m.note, "reviews my first jobs");
    const stored = (await w.kit.log.get(m.id))!.record;
    assert.equal(stored.cosigs?.length, 1, "both signatures are on it");
    assert.match(w.out.join("\n"), /mentorship \S+: .*mentors .*asp bank line/);
    // show lists it from either side
    w.out.length = 0;
    await w.run("show", { agent: w.mentor.did });
    assert.match(w.out[0], new RegExp(`${m.id}.*mentor ${w.mentor.did}.*protege ${w.protege.did}`));
    w.out.length = 0;
    await w.run("show", { agent: w.lowMentor.did });
    assert.match(w.out[0], /no mentorship/);
  } finally { w.cleanup(); }
});

test("an offer is refused for what it is: a self-offer, a bad note, a second mentorship, and an offer without a key to sign it", async () => {
  const w = await world();
  try {
    await rejects(w.run("offer", { protege: w.protege.did, mentor: w.protege.did }), /does not mentor itself/);
    await rejects(w.run("offer", { protege: w.protege.did }), /asp bank mentor offer --protege/);
    await rejects(w.run("offer", { protege: w.protege.did, mentor: w.mentor.did, note: "x".repeat(301) }), /1 to 300 characters/);
    await rejects(w.run("offer", { protege: "did:web:example.com:agents:nobody-here", mentor: w.mentor.did }), /no key for/);
    const file = join(w.dir, "o.json");
    await w.run("offer", { protege: w.protege.did, mentor: w.mentor.did, out: file });
    await w.run("accept", { file, mentor: w.mentor.did });
    await rejects(w.run("offer", { protege: w.protege.did, mentor: w.lowMentor.did }), /already has a mentorship/);
  } finally { w.cleanup(); }
});

test("accept refuses what the mentor should not sign: another mentor's offer, a file that is not an offer, a changed offer, an offer already countersigned; and the log's rules are passed on", async () => {
  const w = await world();
  try {
    const file = join(w.dir, "o.json");
    await w.run("offer", { protege: w.protege.did, mentor: w.mentor.did, out: file });
    await rejects(w.run("accept", { file, mentor: w.lowMentor.did }), /names .* as the mentor, not .*you do not countersign an offer made to someone else/);
    await rejects(w.run("accept", { file: join(w.dir, "missing.json"), mentor: w.mentor.did }), /is not an offer file/);
    const notJson = join(w.dir, "x.json"); writeFileSync(notJson, "{ nope");
    await rejects(w.run("accept", { file: notJson, mentor: w.mentor.did }), /is not an offer file/);
    const other = join(w.dir, "other.json"); writeFileSync(other, JSON.stringify({ type: "asp.mint/v0.2", issuer: w.protege.did, body: { to: w.mentor.did } }));
    await rejects(w.run("accept", { file: other, mentor: w.mentor.did }), /countersigns only a mentorship/);
    await rejects(w.run("accept", { file: file }), /asp bank mentor accept --file/);
    // a changed offer: the mentor's signature would be over something the protege did not sign; the log refuses it and nothing is appended
    const rec = JSON.parse(readFileSync(file, "utf8")); rec.body.note = "a different promise";
    const edited = join(w.dir, "edited.json"); writeFileSync(edited, JSON.stringify(rec));
    await assert.rejects(w.run("accept", { file: edited, mentor: w.mentor.did }));
    assert.equal((await mentorshipsOf(w.handle)).length, 0, "nothing was appended");
    // already countersigned
    const signed = cosign(JSON.parse(readFileSync(file, "utf8")), w.mentor);
    const both = join(w.dir, "both.json"); writeFileSync(both, JSON.stringify(signed));
    await rejects(w.run("accept", { file: both, mentor: w.mentor.did }), /already countersigned/);
    // the offer is from someone who is not the protege it names
    const forged = JSON.parse(readFileSync(file, "utf8")); forged.issuer = w.lowMentor.did;
    const f2 = join(w.dir, "forged.json"); writeFileSync(f2, JSON.stringify(forged));
    await rejects(w.run("accept", { file: f2, mentor: w.mentor.did }), /not by the protege/);
    // a mentor below tier 2: the log's rule is passed on as it is, and nothing is appended
    const low = join(w.dir, "low.json");
    await w.run("offer", { protege: w.protege.did, mentor: w.lowMentor.did, out: low });
    await assert.rejects(w.run("accept", { file: low, mentor: w.lowMentor.did }), (e: Error) => /mentor_tier|tier 2 or above/.test(e.message));
    assert.equal((await mentorshipsOf(w.handle)).length, 0);
  } finally { w.cleanup(); }
});

test("asp first-week lists the mentor and the tutorial job, each ticked once by a fact in the log and not before, with the command to run", async () => {
  const w = await world();
  try {
    const ids = async () => (await firstWeek(w.handle, w.protege.did)).filter((s) => s.done).map((s) => s.id);
    const steps = await firstWeek(w.handle, w.protege.did);
    const mentorStep = steps.find((s) => s.id === "mentor")!, tutorialStep = steps.find((s) => s.id === "tutorial")!;
    assert.ok(mentorStep && tutorialStep && !mentorStep.done && !tutorialStep.done);
    assert.match(mentorStep.next, /asp bank mentor offer --protege .* --mentor .*accept --file/);
    assert.match(tutorialStep.next, /\[tutorial\]/);
    assert.ok(!(await ids()).includes("mentor") && !(await ids()).includes("tutorial"));
    const file = join(w.dir, "o.json");
    await w.run("offer", { protege: w.protege.did, mentor: w.mentor.did, out: file });
    assert.ok(!(await ids()).includes("mentor"), "an offer alone is not a mentor");
    await w.run("accept", { file, mentor: w.mentor.did });
    assert.ok((await ids()).includes("mentor"));
    // a job that is not a tutorial does not tick the tutorial step; a house agent's tutorial contract does, once
    const mk = (purpose: string) => cosign(w.kit.mk("contract", w.house, { principal: w.house.did, performer: w.protege.did, bank: bankP.did, purpose, price: credit(100), verification: "deterministic", deadline: "2027-12-03T18:00:00Z", basis: { intent: hashOf("0"), offer: hashOf("1") } }, null, { subject: w.protege.did }), w.protege);
    await w.kit.put(mk("an ordinary job"));
    assert.ok(!(await ids()).includes("tutorial"));
    await w.kit.put(mk(`${TUTORIAL_LABEL} read a file and say what it does`));
    assert.equal((await ids()).filter((x) => x === "tutorial").length, 1);
    const out: string[] = [];
    await firstWeekCmd(w.protege.did, { log: w.handle, io: { out: (l) => out.push(l) } });
    assert.ok(out.some((l) => l.includes("[x] Have a mentor")) && out.some((l) => l.includes("[x] Take your tutorial job")));
    assert.match(out[0], /of 10 steps of the first week are done/);
    void BANK_DID;
  } finally { w.cleanup(); }
});

test("an unknown action prints the usage; show needs an agent", async () => {
  const w = await world();
  try {
    await assert.rejects(w.run("forge", {}), MentorUsage);
    await rejects(w.run("show", {}), /asp bank mentor show --agent/);
  } finally { w.cleanup(); }
});
