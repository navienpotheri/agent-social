// Diagnosis fix 5 (section 57): a refusal that the field guide has advice for ends with where to read it (inspect research-commons), only when the guide is offered to that agent and has an entry for that rule; a fact, nothing asked.
// In the 2026-11-24 run nobody opened the guide and 8 of 10 agents met the same refusal more than once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIRST_25_RUN, buildGuide } from "../src/cohort/field-guide.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("a refusal with advice in the guide ends with the pointer; one without, or to an agent not offered the guide, does not", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-gp-")) });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const bad = { title: "t".repeat(130), text: "x", tags: [] };
    assert.doesNotMatch((await runTool(w.api, a, all, "forum_post", bad)).text, /field guide/, "no guide in this run: no pointer");
    w.api.fieldGuide = { guide: buildGuide(FIRST_25_RUN, FIRST_25_RUN.source, 8), offered: (n: number) => n === 0 } as never;
    const r = await runTool(w.api, a, all, "forum_post", bad);
    assert.equal(r.ok, false);
    assert.match(r.text, /Nothing was done; try again within them\.( You have met this refusal \(bad_input\) \d+ times this run\.)? The house field guide has advice on this refusal \(inspect research-commons\)\.$/);
    assert.doesNotMatch((await runTool(w.api, b, all, "forum_post", bad)).text, /field guide/, "not offered to agent-02: no pointer");
    const unknown = await runTool(w.api, a, all, "not_a_tool", {});
    assert.doesNotMatch(unknown.text, /field guide/, "a rule the guide has no entry for gets no pointer");
    assert.equal((r.text.match(/field guide/g) ?? []).length, 1, "said once");
  } finally { await w.close(); }
});
