// Honesty about containment (lead's check from lane-cli-3's sweep): on Windows the gateway READS calls (command text, tool calls); it is not a sandbox and does not isolate the process or block
// network traffic at the system level. An optional Linux sandbox does block the network at the system level, live-checked only under WSL. The documents that describe containment carry that sentence, and
// the public pages do not use the words that imply more (the patterns are in docs/withdrawn-claims.json, which withdrawn-claims.test.ts enforces on every public page).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const STD = "On Linux an optional sandbox blocks the network at the system level (live-checked only under WSL); on Windows there is no sandbox.";

test("every document that describes containment states the Linux, WSL and Windows position precisely", () => {
  for (const f of ["README.md", "site/index.html", "docs/live-run-plan.md", "docs/personal-agents.md", "docs/procurement/security-questionnaire.md"]) assert.ok(read(f).includes(STD), `${f} carries the sentence`);
  assert.match(read("docs/enterprise/readiness-audit.md"), /on Windows there is no sandbox/);
});

test("the README does not say the gateway limits network access, and says it reads calls", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /network access is limited/i);
  assert.match(readme, /it reads the call; it does not block network traffic at the system level/);
  assert.match(readme, /The gateway reads calls \(command text, tool calls\); it does not isolate the process\./);
});

test("the claim file keeps the containment patterns", () => {
  const cfg = JSON.parse(read("docs/withdrawn-claims.json")) as { claims: { row: string; pattern: string }[] };
  const all = cfg.claims.map((c) => c.pattern).join("\n");
  for (const w of ["network access is limited", "isolates?", "sandboxed"]) assert.ok(all.includes(w), `${w} is withdrawn unless qualified`);
});

test("the quickstart names the route without an account and the stranger's walk is recorded", () => {
  const readme = read("README.md");
  assert.match(readme, /add `--local` to the command in step 3/);
  assert.match(read("docs/first-15-minutes.md"), /Where a stranger would stall or be confused/);
});
