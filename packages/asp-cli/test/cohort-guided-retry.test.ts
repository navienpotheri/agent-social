// ENG23 flake (found under the full gate): the scripted guided agent offered on one job only; when another agent had taken that job first its walk ended at "no contract" and it lost the later stops (5 of 7 reached).
// A refused offer is now followed by an offer on the next job and the later steps keep their order, so what other agents or the clock do to the board cannot change how many stops it reaches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { standInProvider } from "../src/cohort/provider.ts";

const board = JSON.stringify({ result: [1, 2, 3].map((n) => ({ job: `J${n}`, budget: 5, purpose: "A house job" })) });
async function walk(refusals: number): Promise<string[]> {
  const p = standInProvider(() => "guided", { latencyMs: 0 });
  const names: string[] = [], offers: string[] = [];
  let last = "start", offered = 0;
  for (let i = 0; i < 25; i++) {
    const r = await p.complete({ system: "", messages: [{ role: "user", content: last }], tools: [], agentIndex: 0 } as never);
    const u = r.blocks.find((b) => b.type === "tool_use") as { name: string; input: Record<string, unknown> } | undefined;
    if (!u) break;
    names.push(u.name);
    if (u.name === "look_jobs") last = board;
    else if (u.name === "offer_on_job") { offers.push(String(u.input.job)); last = offered++ < refusals ? "Refused: that job is taken." : "Offer accepted: the contract is sha256:" + "ab".repeat(32); }
    else last = "ok";
    if (u.name === "stop_exploring") break;
  }
  assert.deepEqual(offers, ["J1", "J2", "J3"].slice(0, Math.min(3, refusals + 1)), "each refused offer is followed by one on the next job");
  return names.filter((n) => n !== "offer_on_job");
}

test("the guided script reaches the same steps in the same order whether its first jobs were taken or not; with every job taken it stops, saying so", async () => {
  const clean = await walk(0);
  assert.deepEqual(await walk(1), clean);
  assert.deepEqual(await walk(2), clean);
  assert.ok(clean.includes("deliver_job") && clean.includes("course_enrol") && clean[clean.length - 1] === "stop_exploring");
  const none = await walk(3);
  assert.equal(none[none.length - 1], "stop_exploring");
  assert.ok(!none.includes("deliver_job"), "with every job taken there is nothing to deliver");
});
