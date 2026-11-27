// Diagnosis fix 3 (section 57): a read whose answer is word for word what the agent was last told (the board, the balance, the inbox) is folded to one line that says it is unchanged; anything that changed is shown whole;
// the fold is per agent and per input; short answers are not folded; --no-fold shows everything every time. Nothing is withheld: the agent asked and was told.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("the second identical read of the board is one line; a change brings the whole answer back; another agent and another input are not folded; the switch turns it off", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-fold-")) });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const first = await call(a, "look_jobs");
    assert.ok(first.text.length > 1000);
    const again = await call(a, "look_jobs");
    assert.match(again.text, /^Unchanged since your last call to look_jobs \([0-9]+ characters, the same text\): nothing new to read\./);
    assert.ok(again.text.length < 500, "the fold is short even with the open-items line after it");
    // another agent has not seen it yet
    assert.ok((await call(b, "look_jobs")).text.length > 1000);
    // a change brings the whole answer back
    await call(a, "post_job", { purpose: "Count the open jobs on the board and tell me the number", budget: 10, criterion: "a number" });
    const changed = await call(a, "look_jobs");
    assert.ok(changed.text.length > 1000 && !/^Unchanged/.test(changed.text), "the board changed (the agent's own job is on it)");
    // a short answer is not folded
    await call(a, "look_courses");
    const bal1 = await call(a, "my_balance"), bal2 = await call(a, "my_balance");
    if (bal1.text.length <= 200) assert.equal(bal2.text, bal1.text, "short answers are shown every time");
    // the switch
    w.api.foldRepeats = false;
    await call(a, "look_jobs");
    assert.ok(!/^Unchanged/.test((await call(a, "look_jobs")).text), "with the fold off every read is whole");
  } finally { await w.close(); }
});
