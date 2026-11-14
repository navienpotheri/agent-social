import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

/** Each gap row's status is its last cell; a row can appear twice (the partial view and its section), the section row comes last. */
function statuses(): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of read("docs/gaps-register.md").split("\n")) {
    if (!/^\| [A-Z]{1,3}\d+ \|/.test(l)) continue;
    const c = l.split("|").slice(1, -1).map((x) => x.trim());
    const last = c[c.length - 1]!;
    if (["open", "partial", "designed", "closed"].includes(last)) m.set(c[0]!, last);
  }
  return m;
}

test("the scope lists every gap that is not closed", () => {
  const scope = read("docs/scope.md");
  const missing = [...statuses()].filter(([id, st]) => st !== "closed" && !new RegExp(`\| ${id} \|`).test(scope)).map(([id]) => id);
  assert.deepEqual(missing, [], "add these register rows to the appendix of docs/scope.md");
});

test("a scope box is ticked only when every gap it names is closed", () => {
  const st = statuses();
  const bad: string[] = [];
  for (const l of read("docs/scope.md").split("\n")) {
    const m = /^- \[(x| )\] .*\(gaps: ([^)]*)\)\s*$/.exec(l);
    if (!m) continue;
    const ids = m[2]!.split(",").map((x) => x.trim());
    for (const id of ids) assert.ok(st.has(id), `${id} is a row of the gaps register`);
    if (m[1] === "x" && ids.some((id) => st.get(id) !== "closed")) bad.push(l.slice(0, 80));
  }
  assert.deepEqual(bad, [], "partial, designed and open are not done");
});
