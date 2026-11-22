/**
 * Eval scenarios as records (register row DK1221, from DK800; spec-delta S1610): hashes only, a known author, one for each skill and task hash, and a held-out scenario is the Registrar's and is not listed to anyone else.
 * Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGISTRAR_DID } from "../src/index.ts";
import { kit, mk, party, refusedBy, operator, type Party } from "./society-kit.ts";

test("DK1221: an author writes a scenario of hashes; a held-out one is the Registrar's, and not listed to the author", async () => {
  const k = await kit();
  const author = await k.person("es-author");
  const registrar = party(REGISTRAR_DID);
  const scn = (by: Party, over: Record<string, unknown> = {}) => mk("eval_scenario", by, { skill: "foundations", task_sha256: "1".repeat(64), check_sha256: "2".repeat(64), difficulty: 3, ...over }, null, { subject: null });
  const open = await k.log.append(scn(author));
  assert.equal(await refusedBy(k.log.append(scn(author, { check_sha256: "3".repeat(64) }))), "eval_scenario_known", "one for each skill and task");
  assert.equal(await refusedBy(k.log.append(scn(author, { task_sha256: "4".repeat(64), held_out: true }))), "eval_held_out_not_registrar", "an author does not write the held-out set");
  const held = await k.log.append(scn(registrar, { task_sha256: "5".repeat(64), held_out: true }));
  const forAuthor = await k.log.evalScenarios("foundations", author.did);
  assert.deepEqual(forAuthor.map((x) => x.id), [open.id], "the author sees the open scenario only");
  assert.deepEqual((await k.log.evalScenarios("foundations")).map((x) => x.id), [open.id], "nobody in particular sees none of the held-out set");
  assert.deepEqual((await k.log.evalScenarios("foundations", REGISTRAR_DID)).map((x) => x.id).sort(), [open.id, held.id].sort(), "the Registrar sees both");
  assert.deepEqual((await k.log.evalScenarios("foundations", operator.did)).length, 2, "and so does the operator");
  assert.deepEqual(await k.log.evalScenarios("other-skill", REGISTRAR_DID), []);
  assert.equal((await k.log.verify()).ok, true);
});
