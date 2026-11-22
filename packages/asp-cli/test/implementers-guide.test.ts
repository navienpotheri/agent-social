// Register row T5: the implementer's guide (docs/implementers-guide.md). Every file it names exists, every vector file in conformance/vectors is described in it and every file it describes exists, the commands
// it gives are documented commands, and it says plainly what has not been done (no outside developer has followed it, no third implementation, no published package).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const guide = read("docs/implementers-guide.md");

test("every link and every path in the guide exists", () => {
  const missing: string[] = [];
  for (const m of guide.matchAll(/\]\(([^)#]+)\)/g)) { const t = m[1]!; if (!/^https?:/.test(t) && !existsSync(new URL(`docs/${t}`, root))) missing.push(t); }
  for (const m of guide.matchAll(/`((?:packages|python|conformance)\/[A-Za-z0-9_./-]+)`/g)) if (!existsSync(new URL(m[1]!, root))) missing.push(m[1]!);
  assert.deepEqual(missing, []);
});

test("the vector files in the guide are exactly the vector files of the repository", () => {
  const onDisk = readdirSync(new URL("conformance/vectors/", root)).filter((f) => f.endsWith(".json")).sort();
  const described = [...guide.matchAll(/^\| `([a-z-]+\.json)` \|/gm)].map((m) => m[1]!).sort();
  assert.deepEqual(described, onDisk);
});

test("the commands in the guide are documented and the scripts exist", () => {
  const commands = read("docs/commands.md");
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  for (const m of guide.matchAll(/npm run ([a-z-]+)(?=[\s`]|$)/g)) if (m[1] !== "asp") assert.ok(m[1]! in pkg.scripts, `npm run ${m[1]} is a script`);
  for (const m of guide.matchAll(/npm run asp -- ((?:serve token|serve|gateway)\b)/g)) assert.ok(commands.includes(`asp ${m[1]}`), `asp ${m[1]} is documented`);
  assert.match(commands, /asp serve --sandbox --db local:<new dir>/);
});

test("the guide says plainly what has not been done", () => {
  assert.match(guide, /No outside developer has followed this guide yet/);
  assert.match(guide, /There is no third implementation, and neither SDK is published as a package/);
  assert.match(guide, /Credits are mock accounting entries, not money/);
  assert.match(guide, /no outside security review/);
});
