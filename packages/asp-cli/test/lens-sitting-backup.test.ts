/**
 * The ledger of sittings and its backup (register row DK1401): the ledger is a service file, not a signed record, so the copy check is only as good as the file. This pins what that choice means: a copy of another
 * agent's answer is refused against the ledger as it is; against a ledger that was lost, the same copy is graded (the ledger forgets, which is the stated limit); against a ledger restored from a backup copy taken
 * after the first agent's sitting, the same copy is refused again; and a backup is a plain copy of the file (it holds hashes and scores only, no lesson text). Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { school } from "./lens-course-kit.ts";
import { courseService, engineIds, loadCatalogue } from "../src/lens-courses/index.ts";
import { Ledger, SittingRefused, runSitting } from "../src/lens-courses/sitting.ts";
import { honestLessons } from "../src/lens-courses/reflection.ts";

const card = loadCatalogue(engineIds()).courses.find((c) => c.id === "C-L2-1")!;

test("DK1401: a copy is refused against the ledger, graded against a lost ledger, and refused again once the ledger is restored from a backup copy", async () => {
  const { k, course } = await school(card);
  const dir = mkdtempSync(join(tmpdir(), "asp-sitting-backup-"));
  const ledgerPath = join(dir, "lens-sittings.jsonl");
  const backupPath = join(dir, "lens-sittings.backup.jsonl");
  const enrolAs = async (name: string) => {
    const p = await k.agent(name);
    await k.fund(p, 100); await k.job(p, 100);
    const tuition = await k.buy(p, courseService(card), 30);
    const enrol = await k.put(k.mk("enrolment", p, { course, purchase: tuition }, null, { subject: p.did }));
    return { p, enrol };
  };
  const env = () => ({ reader: k.log as never, ledger: new Ledger(ledgerPath), now: () => k.tick() });
  // The first agent sits with its own answer: the ledger now knows it.
  const first = await enrolAs("sb-first");
  const mine = honestLessons();
  await runSitting(card, { holder: first.p.did, enrolment: first.enrol, artifact: mine }, env());
  assert.equal(new Ledger(ledgerPath).entries().length, 1);
  // A backup is a plain copy of the file, and holds hashes and scores only.
  copyFileSync(ledgerPath, backupPath);
  assert.ok(!readFileSync(backupPath, "utf8").includes("migration under a draining queue"), "no lesson text in the backup");
  // 1. Against the ledger as it is: the reordered copy is refused before grading.
  const copier = await enrolAs("sb-copier");
  const reordered = { lessons: [...mine.lessons].reverse().map((x) => x.toUpperCase().replace(/ /g, "  ")) };
  await assert.rejects(() => runSitting(card, { holder: copier.p.did, enrolment: copier.enrol, artifact: reordered }, env()), (e: unknown) => e instanceof SittingRefused && e.code === "artifact_copied");
  // 2. The ledger is lost: the same copy is graded. This is the limit the register states, not a hidden one.
  rmSync(ledgerPath);
  assert.equal(existsSync(ledgerPath), false);
  assert.equal(new Ledger(ledgerPath).entries().length, 0, "a lost file forgets every sitting");
  const graded = await runSitting(card, { holder: copier.p.did, enrolment: copier.enrol, artifact: reordered }, env());
  assert.equal(graded.attempt, 1, "against a lost ledger the copy is graded");
  // 3. Restored from the backup taken after the first sitting: a second copier is refused again, and the restored file is the first agent's line alone.
  writeFileSync(ledgerPath, readFileSync(backupPath));
  assert.equal(new Ledger(ledgerPath).entries().length, 1);
  const copier2 = await enrolAs("sb-copier-2");
  const near = { lessons: mine.lessons.map((l, i) => (i === 0 ? l.replace("loses", "drops") : l)) };
  await assert.rejects(() => runSitting(card, { holder: copier2.p.did, enrolment: copier2.enrol, artifact: near }, env()), (e: unknown) => e instanceof SittingRefused && e.code === "artifact_copied", "a near copy is refused against the restored ledger");
});

test("DK1401: the nightly file backup takes every file beside the tokens file, so the service's ledger of sittings (tokens.json.lens-sittings.jsonl) is in it", () => {
  const script = readFileSync(new URL("../../../docs/deploy/setup-server.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const tar = script.split("\n").find((l) => l.includes("asp-files-")) ?? "";
  assert.match(tar, /ls -d tokens\.json\*/, "every tokens.json.* sidecar is archived with tokens.json");
  const serve = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
  assert.match(serve, /SittingLedger\(v\.tokens \? `\$\{v\.tokens\}\.lens-sittings\.jsonl`/, "the service's ledger is a sidecar of the tokens file, which the backup pattern covers");
});
