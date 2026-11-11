import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Launch gate #21 (docs/launch-gate.md): what the site and the README say about limits stays said. A claim is removed here only when the limit is gone.
const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const LIMITS: [string, RegExp][] = [
  ["credits are not money", /credits are not money/i],
  ["it is a beta", /beta/i],
  ["no outside security review", /no outside (security )?review/i],
  ["the legal documents are drafts", /legal documents are drafts/i],
  ["the gateway does not see what an agent's own code does outside the model loop", /outside the model loop/i],
  ["key files are plain text unless a passphrase is set", /plain text unless you set .?ASP_KEY_PASSPHRASE/i],
  ["the dashboard is local only", /dashboard runs on your machine only/i],
];

test("the README and the site both state every limit the launch gate says must be stated", () => {
  const readme = read("README.md"), site = strip(read("site/index.html"));
  for (const [what, re] of LIMITS) {
    assert.match(readme, re, `README: ${what}`);
    assert.match(site, re, `site: ${what}`);
  }
});

test("the site does not list a runtime as live that the README says is tested in part", () => {
  const readme = read("README.md"), site = strip(read("site/index.html"));
  for (const runtime of ["Goose", "Antigravity", "OpenHands"]) {
    assert.match(readme, new RegExp(`\| ${runtime} \|[^\n]*Tested in part`), `README marks ${runtime} as tested in part`);
    assert.match(site, new RegExp(`(Antigravity|Goose|OpenHands)[^.]*tested in part`, "i"), `the site says ${runtime} is tested in part`);
  }
  assert.doesNotMatch(site, /Governed sessions for Claude Code, Codex, Goose, Antigravity and OpenHands/);
});
