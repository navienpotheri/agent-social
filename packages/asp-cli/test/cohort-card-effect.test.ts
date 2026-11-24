// The learning-gain study, step 1 (ENG129): `asp academy card-effect` with the stand-in provider: a cost line before any call, three arms (or the control only with --headroom), a table per course with a bootstrap interval, raw answers written, a dollar cap that stops the study.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { bootstrapDiff, estimate, placeboText, treatmentText } from "../src/cohort/card-effect.ts";

const run = async (args: string[]): Promise<{ code: number; out: string }> => {
  const home = mkdtempSync(join(tmpdir(), "asp-ce-home-")), lines: string[] = [];
  const io: Io = { out: (l) => lines.push(l), err: (l) => lines.push(l), env: { ASP_HOME: home }, cwd: home };
  return { code: await main(["academy", "card-effect", "--provider", "stand-in", ...args], io), out: lines.join("\n") };
};
test("the arms, the cost line, the table with an interval and the raw files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-ce-out-"));
  const r = await run(["--courses", "C-L9-1,C-L2-1", "--n", "3", "--seed", "7", "--out", dir]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Cost: 2 courses x 3 samples x 3 arms = 18 model calls/);
  assert.ok(r.out.indexOf("Cost:") < r.out.indexOf("| Course |"), "the cost is printed before the table");
  assert.match(r.out, /\| C-L9-1 Passing a message another agent can use \| 3 \| [\d.]+ \| [\d.]+ \| [\d.]+ \| [+-]?[\d.]+ \(-?[\d.]+ to -?[\d.]+\) \|/);
  const raw = JSON.parse(readFileSync(join(dir, "card-effect-samples.json"), "utf8")) as { samples: { arm: string; course: string }[] };
  assert.equal(raw.samples.length, 18);
  assert.deepEqual([...new Set(raw.samples.map((s) => s.arm))].sort(), ["control", "placebo", "treatment"]);
  assert.ok(existsSync(join(dir, "card-effect.md")));
});
test("--headroom runs only the control arm; a dollar cap stops the study", async () => {
  const h = await run(["--courses", "C-L9-1", "--n", "2", "--headroom"]);
  assert.match(h.out, /1 course x 2 samples x 1 arm = 2 model calls/);
  assert.match(h.out, /\| C-L9-1 .* \| 2 \| [\d.]+ \| n\/a \| n\/a \| n\/a \|/);
  const capped = await run(["--courses", "C-L9-1", "--n", "5", "--total-usd", "0"]);
  assert.match(capped.out, /The dollar cap \(\$0\.00\) was reached: the study stops here\./);
});
test("the placebo has the length of the treatment and says nothing of the course; the interval of equal samples is a point; the estimate bounds the calls", () => {
  const t = treatmentText("C-L9-1"), p = placeboText(t.length);
  assert.equal(p.length, t.length); assert.ok(t.includes("Part 1 of 4") && !p.includes("Part 1"));
  assert.deepEqual(bootstrapDiff([5, 5, 5], [5, 5, 5], "x"), [0, 0]);
  assert.ok(estimate({ courses: ["a", "b"], n: 10, headroom: false, model: "claude-haiku-5-5" }).calls === 60);
});
