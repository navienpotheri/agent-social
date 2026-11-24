// Exploration idea 2 (a discoveries feed): every find the system recorded is one house line; others' finds since the agent was last shown the feed come as at most three lines, newest first, once; an agent's own find is not shown to itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoveryLog, runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("a find by another agent is shown once to the others, newest first, three at most, and the extra line does not reach a script that reads the tool's text", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-disc-")), expedition: true });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02"), c = await w.enrol(2, "agent-03");
    for (const x of [a, b, c]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, n: string, i: Record<string, unknown> = {}) => runTool(w.api, who, all, n, i);
    await call(a, "my_balance"); // a first look: nothing found yet
    for (const p of ["registry", "courts", "treasury", "market", "shops"]) await call(b, "inspect", { place: p });
    const log = discoveryLog(w.api);
    const doors = log.entries.length; assert.ok(doors > 0, "the registry plaque was recorded");
    const seen = (await call(a, "my_balance")).text;
    if (doors > 0) {
      assert.match(seen, /Since you last looked, others found \(the house's record, nothing here is asked of you\): agent-02 found /);
      assert.ok((seen.match(/agent-02 found/g) ?? []).length <= 3, "three at most");
      assert.doesNotMatch((await call(a, "my_balance")).text, /Since you last looked/, "once");
      assert.doesNotMatch((await call(b, "my_balance")).text, /Since you last looked/, "not shown to the one who found it");
      assert.doesNotMatch(stripExtras(seen), /Since you last looked/, "a script reads the tool's own text");
    } else assert.equal(seen.includes("Since you last looked"), false);
    assert.ok(log.entries.every((e) => e.handle === "agent-02" && /^agent-02 found /.test(e.text)), "every entry is written by the system, from the call");
  } finally { await w.close(); }
});
