// Owner decisions Q21 and Q22 (2026-11-21): the line is "the accountability layer for AI agents", and "securing" returns only after an outside security review; no page says agents become
// more aligned until the study has a result with an interval (a line that mentions it must say that no such claim is made).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const PAGES = [...readdirSync(new URL("site/", root)).filter((f) => /\.(html|txt)$/.test(f)).map((f) => `site/${f}`), "README.md"];

test("the home page says the accountability layer for AI agents, and no public page says 'securing AI agents' or 'trust layer for securing'", () => {
  const home = read("site/index.html");
  assert.match(home, /<title>Agent Social: the accountability layer for AI agents<\/title>/);
  assert.match(home, /<h1>The accountability layer for AI agents/);
  for (const p of PAGES) assert.doesNotMatch(read(p), /securing AI agents|trust layer for securing/i, `${p} does not use the old line`);
});

test("no public page claims that agents become more aligned; a line that mentions it says that no such claim is made", () => {
  for (const p of PAGES) {
    for (const line of read(p).split("\n")) {
      if (/\b(more|better|safer) aligned\b|\balignment (improves|improved)\b/i.test(line)) assert.match(line, /no claim|not (yet )?(shown|claim)|does not exist/i, `${p}: ${line.slice(0, 120)}`);
    }
  }
});
