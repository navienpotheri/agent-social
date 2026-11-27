// Next-run batch B3: a seen record. The labelled lines the system shows an agent are found in the tool's text and become one trace event each (agent, turn, tool, kind, hash, text cut at 300); the closure reader
// reports how many agents were shown each kind and how many used a related tool afterwards. The record adds nothing to what an agent sees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seenLines } from "../src/cohort/seen.ts";
import { closureRows } from "../src/cohort/closure.ts";
import { introFor, runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("every labelled line the system adds is found in the tool's text, with a stable hash and the text cut at 300", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-seen-")), games: true, lessons: true, desert: 3, expedition: true });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, n: string, i: Record<string, unknown> = {}) => runTool(w.api, who, all, n, i);
    const first = seenLines((await call(a, "look_map")).text);
    assert.ok(first.some((s) => s.kind === "intro" && s.text.startsWith("What this society has")), "the introduction");
    assert.ok(first.some((s) => s.kind === "atlas"), "the atlas");
    for (const s of first) { assert.ok(s.text.length <= 300); assert.match(s.hash, /^[0-9a-f]{16}$/); }
    assert.ok(seenLines((await call(a, "my_agenda")).text).some((s) => s.kind === "untried" || s.kind === "fog"), "the agenda's fog or untried line");
    const ins = seenLines((await call(b, "inspect", { place: "registry" })).text);
    assert.ok(ins.some((s) => s.kind === "door"), "the door");
    assert.deepEqual(seenLines((await call(a, "my_balance")).text).filter((s) => s.kind === "intro"), [], "the introduction is said once");
    assert.equal(introFor(w.api, 0).length < 1200, true);
  } finally { await w.close(); }
});

test("the closure reader counts the agents shown each kind and those who used a related tool after being shown", () => {
  const d = mkdtempSync(join(tmpdir(), "asp-seenc-")); mkdirSync(d, { recursive: true });
  const ev = [
    { t: "start", agents: 3, toolGroups: [] },
    { t: "seen", agent: "a1", turn: 1, via: "my_agenda", kind: "fog", hash: "x", text: "you have looked closely at 1 of 13 places" },
    { t: "tool", agent: "a1", turn: 2, tool: "inspect", input: { place: "market" }, ok: true, chars: 10, institution: "x", scope: "read.x", writes: false },
    { t: "seen", agent: "a2", turn: 1, via: "my_agenda", kind: "fog", hash: "x", text: "you have looked closely at 1 of 13 places" },
    { t: "seen", agent: "a2", turn: 1, via: "look_map", kind: "atlas", hash: "y", text: "Society atlas" },
  ];
  writeFileSync(join(d, "trace.jsonl"), ev.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const rows = closureRows(d);
  const r1 = rows.find((r) => r.row === "D60-1")!, r2 = rows.find((r) => r.row === "D60-2")!;
  assert.match(r1.measured, /atlas 1, fog 2/);
  assert.match(r2.measured, /fog 1 of 2/);
});
