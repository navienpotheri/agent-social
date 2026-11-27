// Exploration idea 3 (the society atlas): the map's text ends with how many agents have looked closely at each place and which is least visited, counted from the agents' own calls; a script reading the map's own text does not see it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atlasLine, runTool, stripExtras, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("the atlas counts the agents per place and names the least visited as a fact; look_map carries it", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-atlas-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, n: string, i: Record<string, unknown> = {}) => runTool(w.api, who, all, n, i);
    for (const x of [a, b]) await call(x, "inspect", { place: "registry" });
    await call(a, "inspect", { place: "academy" });
    const line = atlasLine(w.api);
    assert.match(line, /registry 2, courts 0/);
    assert.match(line, /academy 1/);
    assert.match(line, /Least visited: courts, treasury, .* \(0\)\.$/);
    const m = (await call(a, "look_map")).text;
    assert.match(m, /Society atlas \(counted from the log\)/);
    assert.doesNotMatch(stripExtras(m), /Society atlas/);
  } finally { await w.close(); }
});
