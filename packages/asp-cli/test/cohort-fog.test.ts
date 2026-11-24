// Exploration idea 1 (fog of war): a true line in the agenda and in the open items: how many of the places this agent has looked at closely, counted from its own inspect calls, and which not yet. Nothing is asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fogLine, runTool, TOOLS } from "../src/cohort/tools.ts";
import { PLACES } from "../src/cohort/expedition.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("the agenda and the open items count the places looked at closely and name the rest; the count is the agent's own; at all of them the line goes", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-fog-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, n: string, i: Record<string, unknown> = {}) => runTool(w.api, who, all, n, i);
    assert.match(fogLine(w.api, a.did)!, new RegExp(`looked closely at 0 of ${PLACES.length} places`));
    await call(a, "inspect", { place: "registry" }); await call(a, "inspect", { place: "academy" }); await call(b, "inspect", { place: "courts" });
    assert.match(fogLine(w.api, a.did)!, new RegExp(`looked closely at 2 of ${PLACES.length} places .*not yet: courts, `), "counted for this agent only");
    assert.doesNotMatch(fogLine(w.api, a.did)!, /not yet:.*(registry|academy)/);
    assert.match((await call(a, "my_agenda")).text, /you have looked closely at 2 of 13 places/);
    const r = (await call(a, "inspect", { place: "market" })).text;
    assert.match(r, /Open to you now: .*you have looked closely at 3 of 13 places/);
    assert.doesNotMatch((await call(a, "my_balance")).text, /looked closely at 3 of/, "shown when the count changes, not on every call");
    for (const p of PLACES) await call(a, "inspect", { place: p });
    assert.equal(fogLine(w.api, a.did), undefined);
  } finally { await w.close(); }
});
