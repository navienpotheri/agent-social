// Row ENG84 (c), the contradiction-finding task: two short documents KNOWN to contradict each other on two rules (the length of a free comment, the number of free writes); the house job asks an agent to name both rules and
// both numbers; the answer is checked by rule, with what is missing named; the current fixture's numbers are the ones this society really has. Scripted only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FREE_WRITES } from "../src/cohort/market.ts";
import { FORUM_FORM } from "@agent-social/asp-package";
import { REPO_DOCS } from "../src/cohort/hard-jobs.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("the current fixture states the rules as they are; the draft is known to differ on exactly two", () => {
  assert.match(REPO_DOCS["policy-current"]!.text, new RegExp(`a comment is free up to ${FORUM_FORM.shortCommentChars}[^0-9]`));
  assert.match(REPO_DOCS["policy-current"]!.text, new RegExp(`first ${FREE_WRITES} writes cost nothing`));
  const words = (s: string): string[] => s.split(/(?<=[.])\s+/);
  const a = words(REPO_DOCS["policy-current"]!.text), b = words(REPO_DOCS["policy-draft"]!.text);
  assert.equal(a.length, b.length);
  assert.equal(a.filter((x, i) => x !== b[i]).length, 2, "two sentences differ and the others are the same");
});

test("the task: a delivery that names one disagreement is refused with the other named as missing; both, with their numbers, pass", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-ctr-")), hardJobs: true });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"); await hall.enrolStandalone(a);
    const call = (name: string, input: Record<string, unknown> = {}) => runTool(w.api, a, all, name, input);
    assert.match((await call("repo_read", { doc: "policy-draft" })).text, /comment is free up to 120/);
    const job = (await hall.openJobList(a, 100)).find((j) => j.purpose.includes("policy-current and policy-draft"))!;
    const c = /contract is (sha256:[0-9a-f]+)/.exec((await call("offer_on_job", { job: job.job, price: job.budget, plan: "I will compare them" })).text)![1]!;
    assert.match((await call("deliver_job", { contract: c, summary: "They differ on the number of free writes: 5 in one, 3 in the other." })).text, /name the first disagreement: the length of a free comment, with both numbers/);
    assert.match((await call("deliver_job", { contract: c, summary: "They differ on the length of a free comment: 90 in the current one, 120 in the draft." })).text, /name the second disagreement: the number of free writes, with both numbers/);
    assert.equal((await call("deliver_job", { contract: c, summary: "A free comment is 90 characters in the current rules and 120 in the draft; the free writes are 5 in the current rules and 3 in the draft." })).ok, true);
  } finally { await w.close(); }
});
