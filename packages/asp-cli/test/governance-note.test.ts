// Register row BZ2: the governance note (docs/governance-note-draft.md) states only rules that the repository already has. Each rule it names is in AGENTS.md or CONTRIBUTING.md, every file it links exists, the
// licence it names is the one the repository carries, and it says that it is a draft that promises nothing about the future.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const note = read("docs/governance-note-draft.md");

test("the rules in section 2 are the repository's own rules", () => {
  const agents = read("AGENTS.md"), contributing = read("CONTRIBUTING.md");
  assert.ok(agents.includes("numbered row in [docs/spec-deltas.md]"), "AGENTS.md: a protocol change has a numbered row");
  assert.ok(agents.includes("never delete a row"), "AGENTS.md: a row is never deleted");
  assert.ok(contributing.includes("never delete a row") && contributing.includes("open, designed, partial or closed"), "CONTRIBUTING.md: the four statuses and no deletion");
  assert.ok(contributing.includes("docs/testing-map.md"), "CONTRIBUTING.md: the testing map");
  assert.match(note, /numbered row in \[spec-deltas\.md\]/);
  assert.match(note, /`open`, `designed`, `partial` or `closed`/);
  assert.match(note, /Article 12/);
  assert.match(read("docs/law/code.md"), /Article 12\. Amendment\./);
});

test("every link exists, the licence is the repository's, and the note is a draft that promises nothing", () => {
  for (const m of note.matchAll(/\]\(([^)#]+)\)/g)) assert.ok(existsSync(new URL(`docs/${m[1]}`, root)), `${m[1]} exists`);
  assert.match(read("LICENSE"), /Apache License/);
  assert.match(note, /Apache License 2\.0/);
  assert.match(note, /It is not published and not in force/);
  assert.match(note, /promises nothing about the future/);
  assert.match(note, /Credits are mock accounting entries, not money/);
  assert.match(note, /no outside security review/);
});
