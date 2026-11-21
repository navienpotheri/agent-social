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
  const file = (name: string, content: unknown) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(content)); return p; };
  return { k, author, course, pkg, did, me, job, run, file, dir, ledgerPath };
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
