// A gate (found 2026-11-22: merges committed with unresolved conflict markers in the owner's rehearsal script, cli.ts, the cohort runner and a test, and `tsc` failed): no tracked file under packages, scripts, docs,
// site, spec, python or conformance has a line that begins with a conflict marker of git ("<" or ">" seven times and a space). The markers are built here so that this file does not contain them itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const open = "<".repeat(7) + " ", close = ">".repeat(7) + " ";
const DIRS = ["packages", "scripts", "docs", "site", "spec", "python", "conformance"];
const TEXT = /\.(ts|mjs|js|json|md|ps1|sh|py|html|css|txt|yml|yaml|toml|service)$/i;

test("no tracked file has an unresolved conflict marker at the start of a line", () => {
  const files = execFileSync("git", ["ls-files", "-z", "--", ...DIRS], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter((f) => f && TEXT.test(f));
  assert.ok(files.length > 500, `${files.length} tracked text files are checked`);
  const hits: string[] = [];
  for (const f of files) {
    const url = new URL(f, root);
    let size = 0; try { size = statSync(url).size; } catch { continue; }   // a file deleted in the working tree
    if (size > 8_000_000) continue;
    const lines = readFileSync(url, "utf8").split(/\r?\n/);
    lines.forEach((l, i) => { if (l.startsWith(open) || l.startsWith(close)) hits.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(hits, [], "unresolved conflict markers");
});

test("the gate sees a marker: a line built from the two prefixes is caught by the same test", () => {
  assert.ok((open + "HEAD").startsWith(open) && (close + "branch").startsWith(close));
  assert.equal("a line <<<<<<< in the middle".startsWith(open), false, "only the start of a line counts");
});
