/**
 * An agent sits a course end to end (register row DK1342): `asp academy lens sit` reads the free first lesson (no credits move), enrols (tuition moves mock credits by the price list's split), hands out the practice
 * tasks, grades the submitted artifact on held-out tasks drawn from the log head at the moment of the sitting, refuses a copied or unchanged answer, limits sittings a day, lets a failed sitting be retried with a
 * changed answer, and on a pass has the Registrar attest the completion and writes the lessons to memory through the lesson gate as one signed change with the sitting's Action as evidence. Fake keys only.
 * Credits are accounting entries, not money. The executors are scripted; no real model is involved (a live run with a real agent is a separate checklist item).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64urlEncode, publicKeyFromSeed } from "@agent-social/asp-core";
import { listLessons } from "@agent-social/asp-package";
import { registrar, treasury, type Party } from "../../asp-log/test/academy-kit.ts";
import { agentPackage, school } from "./lens-course-kit.ts";
import { academyCmd } from "../src/academy.ts";
import { courseSeeds, courseService, engineIds, loadCatalogue } from "../src/lens-courses/index.ts";
import { Ledger, SittingRefused, runSitting } from "../src/lens-courses/sitting.ts";
import { doNothingLessons, honestLessons, overbroadLessons } from "../src/lens-courses/reflection.ts";

const card = loadCatalogue(engineIds()).courses.find((c) => c.id === "C-L2-1")!;

/** A school, and an agent whose identity is the package's own key (so the same key signs its records and its memory change). */
async function world() {
  const { k, author, course } = await school(card);
  const { pkg, signer } = await agentPackage();
  const did = signer.kid.split("#")[0];
  const sponsor = await k.person("sit-sponsor");
  const me = { did, kid: signer.kid, seed: signer.seed, publicKey: publicKeyFromSeed(signer.seed) } as unknown as Party;
  await k.put(k.mk("passport", sponsor, { did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: [{ id: signer.kid, type: "Ed25519", public_key: b64urlEncode(me.publicKey) }] }, null, { subject: did }));
  await k.fund(me, 300);
  const job = await k.job(me, 100);
  const dir = mkdtempSync(join(tmpdir(), "asp-sit-"));
  const ledgerPath = join(dir, "lens-sittings.jsonl");
  const keys = new Map<string, any>([[did, me], [registrar.did, registrar]]);
  const log = { log: k.log, append: (r: unknown) => k.log.append(r as never) } as any;
  const run = async (flags: Record<string, unknown>, o: { noRegistrar?: boolean } = {}) => {
    const out: string[] = [];
    const signerFor = (d: string) => { if (o.noRegistrar && d === registrar.did) throw new Error("no key"); const s = keys.get(d); if (!s) throw new Error(`no key ${d}`); return s; };
    let code = 0, refused: string | undefined;
    try { code = await academyCmd("lens", ["sit", card.id], { log, io: { out: (l) => out.push(l) }, now: () => k.tick(), flags: { by: did, ...flags } as any, signerFor, ledgerPath }); } catch (e) { refused = (e as Error).message; code = 2; }
    return { code, text: out.join("\n"), refused };
  };
  const lens = async (sub: string[], flags: Record<string, unknown> = {}, o: { noRegistrar?: boolean } = {}) => {
    const out: string[] = [];
    const signerFor = (d: string) => { if (o.noRegistrar && d === registrar.did) throw new Error("no key"); const s = keys.get(d); if (!s) throw new Error(`no key ${d}`); return s; };
    let code = 0, refused: string | undefined;
    try { code = await academyCmd("lens", sub, { log, io: { out: (l) => out.push(l) }, now: () => k.tick(), flags: flags as any, signerFor, ledgerPath }); } catch (e) { refused = (e as Error).message; code = 2; }
    return { code, text: out.join("\n"), refused };
  };
  const file = (name: string, content: unknown) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(content)); return p; };
  return { k, author, course, pkg, did, me, job, run, lens, file, dir, ledgerPath };
}
const credits = (k: { log: { balance(d: string): Promise<number> } }, d: string) => k.log.balance(d);

test("the first lesson is read free: no credit moves and nothing is written to the log", async () => {
  const w = await world();
  const before = { bal: await credits(w.k, w.did), head: (await w.k.log.head()).seq };
  const r = await w.run({});
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /first lesson\s+read the ten logged failures/);
  assert.match(r.text, /free: no credits move/);
  assert.match(r.text, /tuition\s+30 mock credits/);
  assert.match(r.text, /at most 3 sittings a day/);
  assert.match(r.text, /not enrolled: asp academy lens sit C-L2-1/);
  assert.equal(await credits(w.k, w.did), before.bal);
  assert.equal((await w.k.log.head()).seq, before.head);
});

test("enrolling moves tuition by the price list's split (learner -30, author +6, Treasury +4), hands out practice tasks, and a second enrol charges nothing", async () => {
  const w = await world();
  const b = { me: await credits(w.k, w.did), author: await credits(w.k, w.author.did), treasury: await credits(w.k, treasury.did) };
  const r = await w.run({ enrol: true, mandate: w.job.mandate });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /enrolled in C-L2-1 .*tuition 30 mock credits paid/);
  assert.match(r.text, /practice tasks for C-L2-1/);
  assert.match(r.text, /"failureLog"/);
  assert.equal(b.me - (await credits(w.k, w.did)), 30);
  assert.equal((await credits(w.k, w.author.did)) - b.author, 6);
  assert.equal((await credits(w.k, treasury.did)) - b.treasury, 4);
  const again = await w.run({ enrol: true, mandate: w.job.mandate });
  assert.match(again.text, /already enrolled/);
  assert.equal(b.me - (await credits(w.k, w.did)), 30, "no second tuition");
  assert.equal((await w.k.log.creditAudit()).verdict, "balanced");
});

test("an agent enrols, sits and fails once, changes its answer and passes later: the Registrar attests, the lessons enter memory as one signed change that cites the sitting's Action", async () => {
  const w = await world();
  await w.run({ enrol: true, mandate: w.job.mandate });
  const flags = { package: w.pkg, contract: w.job.contract };
  const bad = await w.run({ ...flags, artifact: w.file("a1.json", doNothingLessons()) });
  assert.equal(bad.code, 1, bad.text);
  assert.match(bad.text, /sitting 1: not passed/);
  assert.match(bad.text, /\d of 5 runs missed the gate/);
  assert.match(bad.text, /you may sit again with a changed answer \(2 sitting\(s\) left today/);
  assert.deepEqual(listLessons(w.pkg), [], "a failed sitting writes nothing to memory");
  const completions = async () => ((await w.k.log.academyRecords(["completion"])) as unknown[]).length;
  assert.equal(await completions(), 0);
  const same = await w.run({ ...flags, artifact: w.file("a1b.json", doNothingLessons()) });
  assert.match(same.text, /refused \(artifact_unchanged\)/);
  const broad = await w.run({ ...flags, artifact: w.file("a2.json", overbroadLessons()) });
  assert.equal(broad.code, 1);
  assert.match(broad.text, /sitting 2: not passed/);
  const good = await w.run({ ...flags, artifact: w.file("a3.json", honestLessons()) });
  assert.equal(good.code, 0, good.text);
  assert.match(good.text, /sitting 3: PASSED; mean 100%/);
  assert.match(good.text, /error bar 0%/);
  assert.match(good.text, /the Registrar attested the completion/);
  assert.match(good.text, /lesson\(s\) written to memory as one signed change/);
  assert.equal(await completions(), 1);
  const lessons = listLessons(w.pkg);
  assert.ok(lessons.length > 0);
  const comp = (await w.k.log.academyRecords(["completion"])) as unknown as { body: { run_log_hash: string; holder: string } }[];
  assert.equal(comp[0].body.holder, w.did);
  const lessonFile = readFileSync(join(w.pkg, "memory", "lessons", "c-l2-1-3-1.md"), "utf8");
  assert.ok(lessonFile.includes(`run:${comp[0].body.run_log_hash}`), "the admitted lesson cites the sitting's Action");
  const act = (await w.k.log.get(comp[0].body.run_log_hash)) as { record: { type: string; issuer: string } };
  assert.deepEqual([act.record.type, act.record.issuer], ["asp.action/v0.2", w.did]);
  const late = await w.run({ ...flags, artifact: w.file("a4.json", { lessons: ["when change=deploy then wait"] }) });
  assert.match(late.text, /refused \((not_enrolled|already_completed)\)/);
  assert.equal((await w.k.log.verify()).ok, true);
});

test("a copied answer is refused: the lessons another agent already gave, reordered and re-cased, never reach the grader", async () => {
  const w = await world();
  await w.run({ enrol: true, mandate: w.job.mandate });
  const mine = honestLessons();
  const ok = await w.run({ package: w.pkg, contract: w.job.contract, artifact: w.file("m.json", mine) });
  assert.equal(ok.code, 0, ok.text);
  const copier = await w.k.agent("copier");
  await w.k.fund(copier, 100);
  await w.k.job(copier, 100);
  const tuition = await w.k.buy(copier, courseService(card), 30);
  const enrol = await w.k.put(w.k.mk("enrolment", copier, { course: w.course, purchase: tuition }, null, { subject: copier.did }));
  const reordered = { lessons: [...mine.lessons].reverse().map((x) => x.toUpperCase().replace(/ /g, "  ")) };
  const env = { reader: w.k.log as never, ledger: new Ledger(w.ledgerPath), now: () => w.k.tick() };
  await assert.rejects(() => runSitting(card, { holder: copier.did, enrolment: enrol, artifact: reordered }, env), (e: unknown) => e instanceof SittingRefused && e.code === "artifact_copied" && /another agent already gave/.test(e.message));
  assert.equal(new Ledger(w.ledgerPath).entries().filter((x) => x.holder === copier.did).length, 0, "the refused answer was never graded or recorded as a sitting");
});

test("DK1402: a near copy of another agent's answer (one word changed) is refused before grading, and an honest answer with the same rules and its own reasons is graded", async () => {
  const w = await world();
  await w.run({ enrol: true, mandate: w.job.mandate });
  const ok = await w.run({ package: w.pkg, contract: w.job.contract, artifact: w.file("m.json", honestLessons()) });
  assert.equal(ok.code, 0, ok.text);
  assert.ok((new Ledger(w.ledgerPath).entries()[0].shingles ?? []).length > 8, "the ledger keeps word-triple hashes of the answer, not its words");
  assert.ok(!readFileSync(w.ledgerPath, "utf8").includes("migration under a draining queue"), "no lesson text is in the ledger");
  const enrolAs = async (name: string) => {
    const p = await w.k.agent(name);
    await w.k.fund(p, 100); await w.k.job(p, 100);
    const tuition = await w.k.buy(p, courseService(card), 30);
    const enrol = await w.k.put(w.k.mk("enrolment", p, { course: w.course, purchase: tuition }, null, { subject: p.did }));
    return { p, enrol };
  };
  const env = { reader: w.k.log as never, ledger: new Ledger(w.ledgerPath), now: () => w.k.tick() };
  const near = { lessons: honestLessons().lessons.map((l, i) => (i === 0 ? l.replace("loses", "drops") : l)) };
  const c1 = await enrolAs("near-copier");
  await assert.rejects(() => runSitting(card, { holder: c1.p.did, enrolment: c1.enrol, artifact: near }, env), (e: unknown) => e instanceof SittingRefused && e.code === "artifact_copied" && /near copy/.test(e.message));
  assert.equal(new Ledger(w.ledgerPath).entries().filter((x) => x.holder === c1.p.did).length, 0, "a near copy is never graded or recorded as a sitting");
  const own = { lessons: ["when change=migrate and queue=draining then wait: queue items vanish mid-move", "when change=deploy and day=fri and env=prod then backup_first: nobody is around to roll it back", "when change=restart and load=high then drain_first: connections die under load", "when change=config and env=prod then review: prod config errors are costly"] };
  const r = await runSitting(card, { holder: c1.p.did, enrolment: c1.enrol, artifact: own }, env);
  assert.equal(r.attempt, 1, "an answer of its own is graded");
  // a holder may change its own earlier answer a little and sit again: only another agent's answer is a copy
  const c2 = await enrolAs("reviser");
  const first = { lessons: ["when env=prod then review because prod is risky and a bad change there reaches every user at once"] };
  await runSitting(card, { holder: c2.p.did, enrolment: c2.enrol, artifact: first }, env);
  const revised = { lessons: ["when env=prod then review because prod is risky and a bad change there reaches every user at once today"] };
  const again = await runSitting(card, { holder: c2.p.did, enrolment: c2.enrol, artifact: revised }, env);
  assert.equal(again.attempt, 2, "a holder's own near-identical answer is graded");
  // a very short answer is not measured for near copies (below NEAR_COPY_MIN_SHINGLES word triples): one word changed at the end is a new answer
  const c3 = await enrolAs("short-one"), c4 = await enrolAs("short-two");
  const nineWords = { lessons: ["when env=prod then review because prod is risky"] };
  await runSitting(card, { holder: c3.p.did, enrolment: c3.enrol, artifact: nineWords }, env);
  const tail = { lessons: ["when env=prod then review because prod is dangerous"] };
  assert.equal((await runSitting(card, { holder: c4.p.did, enrolment: c4.enrol, artifact: tail }, env)).attempt, 1, "7 word triples are under the minimum: graded");
});

test("DK1402: the word-triple minimum applies to both answers: a short answer that is the start of a longer one, and a longer one that contains a short one, are each graded, not refused as copies", async () => {
  const nine = { lessons: ["when env=prod then review because prod is risky today"] };       // 9 words, 7 triples: under the minimum
  const ten = { lessons: ["when env=prod then review because prod is risky today indeed"] };  // 10 words, 8 triples: the first 7 are the short one's
  for (const [first, second] of [[ten, nine], [nine, ten]] as const) {
    const w = await world();
    await w.run({ enrol: true, mandate: w.job.mandate });
    const env = { reader: w.k.log as never, ledger: new Ledger(w.ledgerPath), now: () => w.k.tick() };
    const enrolAs = async (name: string) => {
      const p = await w.k.agent(name);
      await w.k.fund(p, 100); await w.k.job(p, 100);
      const tuition = await w.k.buy(p, courseService(card), 30);
      return { p, enrol: await w.k.put(w.k.mk("enrolment", p, { course: w.course, purchase: tuition }, null, { subject: p.did })) };
    };
    const a = await enrolAs("min-a"), b = await enrolAs("min-b");
    await runSitting(card, { holder: a.p.did, enrolment: a.enrol, artifact: first }, env);
    assert.equal((await runSitting(card, { holder: b.p.did, enrolment: b.enrol, artifact: second }, env)).attempt, 1, "the answers share 7 of 8 triples, and one of them is under the minimum: graded");
  }
});

test("sittings are limited to three a day on one enrolment, each on fresh seeds; the fourth waits", async () => {
  const w = await world();
  await w.run({ enrol: true, mandate: w.job.mandate });
  const flags = { package: w.pkg, contract: w.job.contract };
  for (let i = 1; i <= 3; i++) assert.equal((await w.run({ ...flags, artifact: w.file(`l${i}.json`, { lessons: [`when change=deploy and day=mon then wait because attempt ${i}`] }) })).code, 1);
  const seeds = new Set(new Ledger(w.ledgerPath).entries().map((e) => courseSeeds(card.id, w.did, e.attempt, e.anchor, 1)[0]));
  assert.equal(seeds.size, 3, "each sitting is on fresh seeds (the attempt is part of the seed, and the anchor is the log head at that moment)");
  const fourth = await w.run({ ...flags, artifact: w.file("l4.json", honestLessons()) });
  assert.match(fourth.text, /refused \(too_many_today\)/);
  assert.match(fourth.text, /at most 3/);
});

test("refusals in words: not enrolled, a missing package or evidence, an artifact that is not JSON, a course nobody published", async () => {
  const w = await world();
  const a = w.file("x.json", honestLessons());
  const flags = { package: w.pkg, contract: w.job.contract };
  assert.match((await w.run({ ...flags, artifact: a })).text, /refused \(not_enrolled\)/);
  await w.run({ enrol: true, mandate: w.job.mandate });
  assert.match((await w.run({ contract: w.job.contract, artifact: a })).refused ?? "", /--package/);
  assert.match((await w.run({ package: w.pkg, artifact: a })).refused ?? "", /--run-log|--contract/);
  const bad = join(w.dir, "bad.json"); writeFileSync(bad, "not json");
  assert.match((await w.run({ ...flags, artifact: bad })).refused ?? "", /not JSON/);
  assert.match((await w.run({ by: undefined })).refused ?? "", /asp academy lens sit/);
  const none = await (async () => { const out: string[] = []; try { await academyCmd("lens", ["sit", "C-L2-9"], { log: { log: w.k.log, append: async () => ({ id: "x" }) } as any, io: { out: (l) => out.push(l) }, now: () => w.k.tick(), flags: { by: w.did } as any, signerFor: () => w.me as any }); } catch (e) { return (e as Error).message; } return out.join("\n"); })();
  assert.match(none, /not a course in the catalogue/);
});

test("a passing sitting on a machine without the Registrar's key is graded and written to memory, and says plainly that the completion awaits the Registrar", async () => {
  const w = await world();
  await w.run({ enrol: true, mandate: w.job.mandate });
  const r = await w.run({ package: w.pkg, contract: w.job.contract, artifact: w.file("h.json", honestLessons()) }, { noRegistrar: true });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /completion awaits the Registrar/);
  assert.equal(((await w.k.log.academyRecords(["completion"])) as unknown[]).length, 0);
  assert.ok(listLessons(w.pkg).length > 0);
});

test("DK1403: `asp academy lens complete-pending` gives the Registrar's completion to a passed sitting that cites the agent's own Action, once, on the machine that holds the Registrar's key; without the key it refuses", async () => {
  const w = await world();
  await w.run({ enrol: true, mandate: w.job.mandate });
  const action = await w.k.put(w.k.mk("action", w.me, { contract: w.job.contract, scopes_used: [], summary: "sat a course" }, null, { subject: w.job.contract }));
  const r = await w.run({ package: w.pkg, "run-log": action, artifact: w.file("p.json", honestLessons()) }, { noRegistrar: true });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /completion awaits the Registrar/);
  assert.equal(((await w.k.log.academyRecords(["completion"])) as unknown[]).length, 0);
  const noKey = await w.lens(["complete-pending"], {}, { noRegistrar: true });
  assert.equal(noKey.code, 2);
  assert.match(noKey.refused ?? "", /needs the Registrar's key/);
  const batch = await w.lens(["complete-pending"]);
  assert.equal(batch.code, 0, batch.text);
  assert.match(batch.text, /completion sha256:[0-9a-f]+ for .* in C-L2-1/);
  assert.match(batch.text, /1 completion\(s\) attested, 0 skipped/);
  const done = (await w.k.log.academyRecords(["completion"])) as unknown as Array<{ body: { holder: string } }>;
  assert.deepEqual(done.map((c) => c.body.holder), [w.did]);
  const again = await w.lens(["complete-pending"]);
  assert.match(again.text, /no passed sitting waits for a completion/);
  assert.equal(((await w.k.log.academyRecords(["completion"])) as unknown[]).length, 1, "once");
  assert.equal((await w.k.log.verify()).ok, true);
});

test("DK1403: a failed sitting and a pass that cited no Action leave nothing for the batch to complete", async () => {
  const w = await world();
  await w.run({ enrol: true, mandate: w.job.mandate });
  const action = await w.k.put(w.k.mk("action", w.me, { contract: w.job.contract, scopes_used: [], summary: "sat a course" }, null, { subject: w.job.contract }));
  const failed = await w.run({ package: w.pkg, "run-log": action, artifact: w.file("f.json", doNothingLessons()) }, { noRegistrar: true });
  assert.notEqual(failed.code, 0, "an empty answer does not pass");
  const viaContract = await w.run({ package: w.pkg, contract: w.job.contract, artifact: w.file("g.json", honestLessons()) }, { noRegistrar: true });
  assert.equal(viaContract.code, 0, viaContract.text);
  const none = await w.lens(["complete-pending"]);
  assert.match(none.text, /no passed sitting waits for a completion/, "a pass reported through --contract has no Action id in the ledger, so the batch leaves it to `asp academy complete`");
  assert.equal(((await w.k.log.academyRecords(["completion"])) as unknown[]).length, 0);
});

test("through the real command line: `asp academy lens sit <id> --by <did>` reads the free lesson, an answer without enrolling is refused in words", async () => {
  const { makeFixture } = await import("./fixture.ts");
  const { main } = await import("../src/cli.ts");
  const f = makeFixture();
  const out: string[] = [], err: string[] = [];
  const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root } as never;
  assert.equal(await main(["academy", "lens", "sit", "C-L2-1", "--by", "did:web:example.com:agents:x"], io), 0, err.join("\n"));
  assert.match(out.join("\n"), /free: no credits move/);
  const a = join(f.root, "a.json"); writeFileSync(a, JSON.stringify(honestLessons()));
  out.length = 0; err.length = 0;
  assert.notEqual(await main(["academy", "lens", "sit", "C-L2-1", "--by", "did:web:example.com:agents:x", "--artifact", a], io), 0);
  assert.match(err.join("\n") + out.join("\n"), /refused \(not_enrolled\)/);
  out.length = 0;
  assert.equal(await main(["academy", "lens", "sit", "C-L2-1", "--by", "did:web:example.com:agents:x", "--json"], io), 0);
  assert.equal(JSON.parse(out.join("\n")).course, "C-L2-1");
});
