/**
 * Trust per model and version (register row DK1711): a swap of the model behind an agent is detected from the Actions' model names and digests and the agent is held until it passes a re-examination; the per-model figures
 * equal a count taken from the log; a model with few runs shows its counts and no rate; house agents are left out; the Registry route serves the table. Synthetic records and a test log; fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosign, type AspRecord } from "@agent-social/asp-core";
import { EventLog, MIN_RUNS_FOR_RATE, modelTrust } from "../src/index.ts";
import { publicReply } from "../src/public-pages.ts";
import { alice, bank, coder, memory, rec, registerParties } from "./harness.ts";

let n = 0;
const R = (type: string, issuer: string, body: Record<string, unknown>, at: string, subject: string | null = null): AspRecord => ({ type: `asp.${type}/v0.2`, id: `sha256:${String(++n).padStart(64, "0")}`, issuer, actor: issuer, subject, body, prev: null, issued_at: at, sig: {} as never });
const at = (d: number, h = 10) => `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`;
const act = (agent: string, m: { name: string; provider?: string; digest?: string }, when: string) => R("action", agent, { contract: "sha256:" + "9".repeat(64), scopes_used: [], summary: "run", metrics: { models: [m] } }, when);
const A = (i: number) => `did:web:example.com:agents:mt-${i}`;
const GPT = { name: "gpt-x", provider: "api.openai.com" }, CLAUDE = { name: "claude-y", provider: "api.anthropic.com" };

test("DK1711: a seeded swap is detected (a new model, and the same name on different weights), and the agent is held until it passes a re-examination", () => {
  const recs = [
    act(A(1), GPT, at(1)), act(A(1), GPT, at(2)),
    act(A(1), { ...GPT, digest: "fingerprint:fp_1" }, at(3)),            // a digest appears: not a change
    act(A(1), { ...GPT, digest: "fingerprint:fp_2" }, at(4)),            // the same name on different weights: a swap
    act(A(2), GPT, at(1)), act(A(2), CLAUDE, at(5)),                      // a new model: a swap
    act(A(3), GPT, at(1)), act(A(3), GPT, at(6)),                         // no swap
  ];
  const t = modelTrust(recs);
  assert.deepEqual(t.swaps.map((s) => [s.agent, s.at]), [[A(1), at(4)], [A(2), at(5)]]);
  assert.match(t.swaps[0]!.from + t.swaps[0]!.to, /fp_1.*fp_2/);
  assert.deepEqual(t.holds.map((h) => [h.agent, h.reexam]), [[A(1), "pending"], [A(2), "pending"]], "held until a re-examination");
  assert.ok(!t.holds.some((h) => h.agent === A(3)), "an agent that did not change model is not held");
  // A passed exam of its own after the swap ends the hold; a failed one, another agent's, and one before the swap do not.
  const exam = (holder: string, passed: boolean, when: string) => R("exam_result", "did:web:asp.local:registry", { exam: "sha256:" + "8".repeat(64), holder, score_permille: 900, pass_mark_permille: 700, passed, attempt: 1, variant: "a", seed: "s", sitting: "x", run_log_hash: "h", missed_categories: [] }, when);
  const after = modelTrust([...recs, exam(A(1), false, at(7)), exam(A(2), true, at(8)), exam(A(1), true, at(2))]);
  assert.deepEqual(after.holds.map((h) => [h.agent, h.reexam]), [[A(1), "pending"], [A(2), "passed"]], "only a pass of its own after the swap clears the hold");
  assert.equal(modelTrust([...recs, exam(A(1), true, at(9))]).holds[0]!.reexam, "passed");
});

test("DK1711: the figures by model are counts from the records, with the agents and runs behind them; slashes, refusals, drift and quarantines count under the model that was running", () => {
  const recs: AspRecord[] = [];
  const P = "did:web:example.com:users:client";
  // 40 runs by 4 agents on GPT, 10 runs by one agent on CLAUDE.
  for (let i = 0; i < 40; i++) recs.push(act(A(1 + (i % 4)), GPT, at(1 + (i % 20), 8)));
  for (let i = 0; i < 10; i++) recs.push(act(A(9), CLAUDE, at(2, 9)));
  const slashed = R("contract", P, { principal: P, performer: A(1), price: { value: 10 } }, at(3));
  recs.push(slashed, R("settlement", "did:web:asp.local:bank", { contract: slashed.id, basis: "ruling", bond_slashed: { value: 3 } }, at(4)));
  recs.push(R("refusal", A(2), { call: "x" }, at(5)), R("refusal", A(2), { call: "y" }, at(5, 11)), R("refusal", A(9), { call: "z" }, at(5)));
  recs.push(R("clinic_diagnosis", "did:web:asp.local:clinic", { agent: A(3), severity: "warn" }, at(6)));
  recs.push(R("quarantine", "did:web:asp.local:clinic", { members: [A(9)], level: "observe" }, at(7)));
  const t = modelTrust(recs);
  const gpt = t.models.find((m) => m.name === "gpt-x")!, claude = t.models.find((m) => m.name === "claude-y")!;
  assert.deepEqual([gpt.agents, gpt.runs, gpt.slashes, gpt.refusals, gpt.drift, gpt.quarantines], [4, 40, 1, 2, 1, 0]);
  assert.deepEqual([claude.agents, claude.runs, claude.slashes, claude.refusals, claude.drift, claude.quarantines], [1, 10, 0, 1, 0, 1]);
  // A model with enough runs shows a rate per 100 runs; one with fewer shows its counts and no rate.
  assert.ok(gpt.runs >= MIN_RUNS_FOR_RATE && claude.runs < MIN_RUNS_FOR_RATE);
  assert.deepEqual(gpt.per100, { slashes: 2.5, refusals: 5, drift: 2.5, quarantines: 0 });
  assert.equal(claude.per100, null, "a small sample is not read as a rate");
  assert.equal(t.models[0]!.name, "gpt-x", "the busiest first");
  // House agents are left out of every figure.
  const without = modelTrust(recs, { houseAgents: new Set([A(9)]) });
  assert.equal(without.models.find((m) => m.name === "claude-y"), undefined);
  assert.match(t.note, /not that a model is safe or aligned/);
});

test("DK1711: on a real log the table equals a count from the log's own records, and the Registry route serves it", async () => {
  const log = new EventLog(await memory.make());
  await registerParties(log);
  const contract = cosign(rec("contract", alice, { principal: alice.did, performer: coder.did, bank: bank.did, purpose: "Fix", price: { value: 0, unit: "credit" }, verification: "deterministic", deadline: "2026-10-03T18:00:00Z", basis: { intent: "sha256:" + "0".repeat(64), offer: "sha256:" + "1".repeat(64) } }, null, coder.did), coder);
  await log.append(contract);
  await log.append(rec("bond", coder, { contract: contract.id, backer: coder.did, amount: { value: 0, unit: "credit" }, escrow: { payer: alice.did, amount: { value: 0, unit: "credit" } }, slashing_conditions: ["lost_dispute"] }, contract.id, contract.id));
  const bond = (await log.recordsOfTypes(["bond"]))[0]!;
  await log.append(rec("mandate", alice, { contract: contract.id, purpose: "Fix", floor: "asp.floor/v1", scopes: ["repo.read"], forbidden_means: [], spend: { cap: 0, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 1 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2026-10-04T00:00:00Z", revocable: true }, bond.id, coder.did));
  const run = (m: { name: string; provider?: string; digest?: string }, s: string) => rec("action", coder, { contract: contract.id, scopes_used: ["repo.read"], summary: s, metrics: { models: [m] } }, null, contract.id);
  for (let i = 0; i < 3; i++) await log.append(run({ name: "gpt-x", provider: "api.openai.com" }, `run ${i}`));
  await log.append(run({ name: "claude-y", provider: "api.anthropic.com" }, "swapped"));
  const t = await log.modelTrust();
  const actions = await log.recordsOfTypes(["action"]);
  const counted = (name: string) => actions.filter((a) => ((a.body as { metrics?: { models?: { name: string }[] } }).metrics?.models ?? []).some((m) => m.name === name)).length;
  assert.equal(t.models.find((m) => m.name === "gpt-x")!.runs, counted("gpt-x"));
  assert.equal(t.models.find((m) => m.name === "claude-y")!.runs, counted("claude-y"));
  assert.equal(t.models.find((m) => m.name === "claude-y")!.per100, null, "one run: no rate");
  assert.deepEqual(t.holds.map((h) => [h.agent, h.reexam]), [[coder.did, "pending"]], "the swap holds the agent");
  const json = await publicReply(log, "/registry/models", false);
  assert.equal(json?.status, 200);
  assert.deepEqual(Object.keys((json as { json: { result: object } }).json.result).sort(), ["holds", "minRunsForRate", "models", "note", "swaps"]);
  const html = await publicReply(log, "/registry/models", true);
  const page = (html as { html: string }).html;
  assert.match(page, /Trust per model and version/);
  assert.match(page, /<th scope="row">gpt-x/);
  assert.match(page, /fewer than 30 runs: counts only, no rate/, "a small sample shows no rate");
  assert.match(page, /held: tier not restored until it passes a re-examination/);
  assert.match(page, /not that a model is safe or aligned/);
  assert.equal((await log.verify()).ok, true);
});
