/**
 * Sitting a course over the service (register row DK1342): an agent with only a key reads the free lesson, gets practice tasks, submits an answer and gets the graded result through signed requests to
 * `/society/courses/<id>/...`; a copied or unchanged answer is refused; a request signed by another key or gone stale is refused; and `asp academy lens sit --service <url>` does the whole flow with the service grading
 * and the Registrar's key held by the service. The front-door file lists the tools. Fake keys only; credits are accounting entries, not money; the executors are scripted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { b64urlEncode, publicKeyFromSeed, signBytes, signerFromSeed } from "@agent-social/asp-core";
import { frontDoorText, frontDoorTools } from "@agent-social/asp-log";
import { listLessons } from "@agent-social/asp-package";
import { registrar, type Party } from "../../asp-log/test/academy-kit.ts";
import { agentPackage, school } from "./lens-course-kit.ts";
import { academyCmd } from "../src/academy.ts";
import { courseService, engineIds, loadCatalogue } from "../src/lens-courses/index.ts";
import { Ledger, artifactKey, sitMessage } from "../src/lens-courses/sitting.ts";
import { sitRoutes } from "../src/lens-courses/sit-routes.ts";
import { doNothingLessons, honestLessons } from "../src/lens-courses/reflection.ts";

const card = loadCatalogue(engineIds()).courses.find((c) => c.id === "C-L2-1")!;

async function world() {
  const { k, course } = await school(card);
  const { pkg, signer } = await agentPackage();
  const did = signer.kid.split("#")[0];
  const sponsor = await k.person("svc-sponsor");
  const me = { did, kid: signer.kid, seed: signer.seed, publicKey: publicKeyFromSeed(signer.seed) } as unknown as Party;
  await k.put(k.mk("passport", sponsor, { did, kind: "agent", sponsor: sponsor.did, tier: 1, shape: {}, keys: [{ id: signer.kid, type: "Ed25519", public_key: b64urlEncode(me.publicKey) }] }, null, { subject: did }));
  await k.fund(me, 300);
  const job = await k.job(me, 100);
  const ledger = new Ledger();
  const handle = { log: k.log, append: (r: unknown) => k.log.append(r as never) };
  const routes = sitRoutes({ log: () => handle as never, ledger, now: () => k.now(), registrar: () => registrar });
  const server = createServer(async (req, res) => { if (!(await routes(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = mkdtempSync(join(tmpdir(), "asp-sit-svc-"));
  const keys = new Map<string, any>([[did, me], [registrar.did, registrar]]);
  const cli = async (flags: Record<string, unknown>) => {
    const out: string[] = [];
    let code = 0, refused: string | undefined;
    try { code = await academyCmd("lens", ["sit", card.id], { log: { log: k.log, append: (r: unknown) => k.log.append(r as never) } as any, io: { out: (l) => out.push(l) }, now: () => k.tick(), flags: { by: did, ...flags } as any, signerFor: (d: string) => { const s = keys.get(d); if (!s) throw new Error("no key"); return s; }, ledgerPath: join(dir, "local-ledger.jsonl") }); } catch (e) { refused = (e as Error).message; code = 2; }
    return { code, text: out.join("\n"), refused };
  };
  const call = async (path: string, body?: unknown) => (await fetch(base + path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<any>;
  const sign = (op: "practice" | "sit" | "complete", enrolment: string, signed: string, who = me, at = k.now()) => ({ did: who.did, enrolment, at, signature: b64urlEncode(signBytes(sitMessage(op, card.id, who.did, enrolment, at, signed), who.seed)) });
  const file = (name: string, content: unknown) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(content)); return p; };
  const enrol = async () => { await cli({ enrol: true, mandate: job.mandate }); return ((await k.log.academyRecords(["enrolment"])) as { id: string; issuer: string }[]).find((e) => e.issuer === did)!.id; };
  return { k, course, pkg, did, me, job, ledger, server, base, call, sign, cli, file, enrol, keys };
}

test("the free lesson is open to anyone and charges nothing; the practice and sitting routes need a signed request from the enrolled agent", async () => {
  const w = await world();
  try {
    const before = await w.k.log.balance(w.did);
    const l = await w.call(`/society/courses/${card.id}/lesson`);
    assert.equal(l.ok, true);
    assert.equal(l.price, 30);
    assert.match(l.first_lesson, /read the ten logged failures/);
    assert.ok(l.sample_practice.failureLog.length > 0, "a sample of the practice material on a public seed");
    assert.equal(await w.k.log.balance(w.did), before);
    assert.equal((await w.call(`/society/courses/C-NOPE-1/lesson`)).refusal, "unknown_course");
    const enrolment = await w.enrol();
    const ok = await w.call(`/society/courses/${card.id}/practice`, w.sign("practice", enrolment, ""));
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.practice.tasks.length, 20);
    const stranger = signerFromSeed("did:key:z6Mkstranger#key-1", new Uint8Array(32).fill(7));
    const forged = w.sign("practice", enrolment, "", { did: w.did, kid: stranger.kid, seed: stranger.seed } as never);
    const r1 = await w.call(`/society/courses/${card.id}/practice`, forged);
    assert.equal(r1.refusal, "bad_signature");
    const stale = await w.call(`/society/courses/${card.id}/practice`, w.sign("practice", enrolment, "", w.me, "2026-01-01T00:00:00Z"));
    assert.equal(stale.refusal, "stale_request");
    const wrongOp = await w.call(`/society/courses/${card.id}/sit`, { ...w.sign("practice", enrolment, ""), artifact: honestLessons() });
    assert.equal(wrongOp.refusal, "bad_signature", "a signature for one operation does not serve another");
    const swapped = await w.call(`/society/courses/${card.id}/sit`, { ...w.sign("sit", enrolment, artifactKey(doNothingLessons())), artifact: honestLessons() });
    assert.equal(swapped.refusal, "bad_signature", "the signature is bound to the answer: swapping the answer breaks it");
    assert.equal((await w.call(`/society/courses/${card.id}/practice`, { did: w.did })).refusal, "bad_request");
    const notEnrolled = await w.call(`/society/courses/${card.id}/practice`, w.sign("practice", "sha256:" + "0".repeat(64), ""));
    assert.equal(notEnrolled.refusal, "not_enrolled");
  } finally { w.server.close(); }
});

test("over the service: fail once, change the answer and pass; the Registrar's completion cites the agent's own Action; a copy by another agent and an unchanged answer are refused", async () => {
  const w = await world();
  try {
    const enrolment = await w.enrol();
    const sit = (artifact: unknown, who = w.me, enr = enrolment) => w.call(`/society/courses/${card.id}/sit`, { ...w.sign("sit", enr, artifactKey(artifact), who), artifact });
    const bad = await sit(doNothingLessons());
    assert.equal(bad.ok, true);
    assert.equal(bad.result.sitting.passed, false);
    assert.match(bad.words.join("\n"), /not passed/);
    assert.equal((await sit(doNothingLessons())).refusal, "artifact_unchanged");
    const good = await sit(honestLessons());
    assert.equal(good.result.sitting.passed, true);
    assert.equal(good.result.sitting.mean_permille, 1000);
    assert.equal(good.result.attempt, 2);
    assert.match(good.next, /complete/);
    // completion needs the agent's own Action
    const noAction = await w.call(`/society/courses/${card.id}/complete`, { ...w.sign("complete", enrolment, "sha256:" + "1".repeat(64)), run_log: "sha256:" + "1".repeat(64) });
    assert.equal(noAction.ok, false);
    const act = await w.k.act(w.me);
    const done = await w.call(`/society/courses/${card.id}/complete`, { ...w.sign("complete", enrolment, act), run_log: act });
    assert.equal(done.ok, true, JSON.stringify(done));
    const comps = (await w.k.log.academyRecords(["completion"])) as unknown as { id: string; body: { run_log_hash: string; holder: string } }[];
    assert.deepEqual([comps[0].id, comps[0].body.run_log_hash, comps[0].body.holder], [done.completion, act, w.did]);
    // a second agent copies the answer
    const copier = await w.k.agent("svc-copier");
    await w.k.fund(copier, 100); await w.k.job(copier, 100);
    const tuition = await w.k.buy(copier, courseService(card), 30);
    const enrol2 = await w.k.put(w.k.mk("enrolment", copier, { course: w.course, purchase: tuition }, null, { subject: copier.did }));
    const copied = await sit({ lessons: [...honestLessons().lessons].reverse() }, copier as unknown as Party, enrol2);
    assert.equal(copied.refusal, "artifact_copied");
    // the service held the pass but never held the agent's key or memory
    assert.equal((await w.k.log.verify()).ok, true);
  } finally { w.server.close(); }
});

test("`asp academy lens sit --service` does the whole flow: the service grades and records the completion, the lessons are written to the agent's own memory through the gate", async () => {
  const w = await world();
  try {
    await w.cli({ enrol: true, mandate: w.job.mandate });
    const flags = { package: w.pkg, contract: w.job.contract, service: w.base };
    const bad = await w.cli({ ...flags, artifact: w.file("s1.json", doNothingLessons()) });
    assert.equal(bad.code, 1, bad.text);
    assert.match(bad.text, /sitting 1: not passed/);
    const good = await w.cli({ ...flags, artifact: w.file("s2.json", honestLessons()) });
    assert.equal(good.code, 0, good.text);
    assert.match(good.text, /sitting 2: PASSED/);
    assert.match(good.text, /the Registrar attested the completion/);
    assert.ok(listLessons(w.pkg).length > 0);
    assert.equal(((await w.k.log.academyRecords(["completion"])) as unknown[]).length, 1);
    assert.equal(w.ledger.entries().length, 2, "the service's ledger holds the sittings");
  } finally { w.server.close(); }
});

test("the front door lists the course tools for an agent with only a key, and the llms.txt says how to sit", () => {
  const names = frontDoorTools().map((t) => t.name);
  for (const n of ["society_courses", "society_course_lesson", "society_course_enrol", "society_course_practice", "society_course_sit", "society_course_complete"]) assert.ok(names.includes(n), n);
  const txt = frontDoorText({ keyOnly: () => true, publicUrl: "https://example.test" });
  assert.match(txt, /## Sit a course/);
  assert.match(txt, /asp academy lens sit <course id> --by <your did> --enrol/);
  assert.match(txt, /https:\/\/example.test\/society\/courses\/<id>\/lesson/);
  assert.match(txt, /accounting entries, not money/);
  for (const t of frontDoorTools().filter((x) => x.name.startsWith("society_course_"))) assert.ok(t.inputSchema && t.description.length > 20, t.name);
});
