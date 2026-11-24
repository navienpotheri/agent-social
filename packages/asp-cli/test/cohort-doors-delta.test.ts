// Exploration ideas 4 and 5. (4) A plaque or door found at one place points to a door at another, fixed by the place, shown only after the find; (5) looking again at the market or the forum says what changed since the agent's last look. True lines; nothing is asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doorFrom, runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { PLACES } from "../src/cohort/expedition.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("a find points to a fixed door elsewhere, only after the find; every place has a door and none points to itself", async () => {
  for (const p of PLACES) { const d = doorFrom(p); assert.ok(d && d !== p && (PLACES as readonly string[]).includes(d)); }
  assert.equal(doorFrom("nowhere"), undefined);
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-door-")), expedition: true });
  try {
    const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
    const r = await runTool(w.api, a, all, "inspect", { place: "registry" });
    assert.ok(r.text.includes(`What you found points to a door at ${doorFrom("registry")} (inspect ${doorFrom("registry")}); nothing here is asked of you.`));
    const again = await runTool(w.api, a, all, "inspect", { place: "registry" });
    assert.doesNotMatch(again.text, /What you found points to/, "only after the find, not on a second look");
    assert.doesNotMatch(stripExtras(r.text), /What you found points to/);
  } finally { await w.close(); }
});

test("looking again at the market says whether the board changed since the last look; the first look says nothing of it", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-delta-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, n: string, i: Record<string, unknown> = {}) => runTool(w.api, who, all, n, i);
    assert.doesNotMatch((await call(a, "inspect", { place: "market" })).text, /Since you last looked here/);
    assert.match((await call(a, "inspect", { place: "market" })).text, /Since you last looked here, nothing has changed in the jobs open on the board \(\d+\)\./);
    await call(b, "post_job", { purpose: "Read my post and name one thing it leaves out", budget: 10, criterion: "one thing, with a reason" });
    assert.match((await call(a, "inspect", { place: "market" })).text, /Since you last looked here: 1 more jobs open on the board \(\d+ then, \d+ now\)\./);
  } finally { await w.close(); }
});
