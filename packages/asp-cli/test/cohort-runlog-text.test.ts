// Next-run batch B4: the run log keeps more of what agents were shown (a tool result up to 4,000 characters in a society run, 1,200 elsewhere) and keeps the call id whole, so that a call and its result pair by id even when several calls
// were made at once (an id such as toolu_... had been masked as a secret, so every id read "[redacted]").
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunRecorder } from "@agent-social/asp-package";

const lines = (p: string): Array<{ kind: string; data: Record<string, unknown> }> => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
test("ids stay whole so calls pair with results; a tool result keeps 4,000 characters in a society run and 1,200 by default; other text keeps 1,200", () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-rl-")), a = join(dir, "a.ndjson"), b = join(dir, "b.ndjson");
  const ids = ["toolu_01ABCdefGHIjklMNOpqrSTUv", "toolu_01ZYXwvuTSRqponMLKjihGFE"], big = "x".repeat(3000);
  for (const [path, rec] of [[a, new RunRecorder(a, 1200, undefined, 4000)], [b, new RunRecorder(b)]] as const) {
    for (const id of ids) rec.event("tool_call", { tool: "look_jobs", id, input: "{}" });
    for (const id of [...ids].reverse()) rec.event("tool_result", { id, text: big });
    rec.event("model_request", { prompt: big });
    void path;
  }
  for (const [path, keep] of [[a, 3000], [b, 1215]] as const) {
    const ev = lines(path), calls = ev.filter((e) => e.kind === "tool_call"), results = ev.filter((e) => e.kind === "tool_result");
    assert.deepEqual(calls.map((e) => e.data.id), ids);
    assert.deepEqual(results.map((e) => e.data.id), [...ids].reverse(), "the results carry their own ids, in any order");
    for (const r of results) assert.ok(String(r.data.text).length >= (keep === 3000 ? 3000 : 1200) && String(r.data.text).length <= (keep === 3000 ? 3010 : 1240), `${String(r.data.text).length}`);
    assert.ok(String(ev.find((e) => e.kind === "model_request")!.data.prompt).length < 1240, "other text keeps 1,200");
  }
});
