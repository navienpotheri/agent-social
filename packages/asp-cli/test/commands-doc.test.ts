import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATALOGUE, catalogueCommands, commandReference, referenceText } from "../../../conformance/generate-command-reference.ts";
import { main, type Io } from "../src/cli.ts";

const root = new URL("../../../", import.meta.url);

test("docs/commands.md is the command reference: regenerate it with npm run commands when the catalogue or the reference comment changes", () => {
  assert.equal(readFileSync(new URL("docs/commands.md", root), "utf8"), commandReference(), "docs/commands.md is out of date: run npm run commands");
});

test("every command the CLI dispatches is in the catalogue, and every catalogue row has a description", () => {
  const src = readFileSync(new URL("packages/asp-cli/src/cli.ts", root), "utf8");
  const dispatched = new Set([...src.matchAll(/if \(cmd === "([a-z-]+)"/g)].map((m) => m[1]));
  const listed = catalogueCommands();
  const missing = [...dispatched].filter((c) => !listed.has(c));
  assert.deepEqual(missing, [], `the CLI has commands the catalogue does not list: ${missing.join(", ")}`);
  for (const g of CATALOGUE) for (const [c, d] of g.rows) assert.ok(c.startsWith("asp") && d.length > 12, `${c} has a one-line description`);
});

test("the reference page holds what `asp help all` prints", async () => {
  const out: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: () => {}, env: {}, cwd: process.cwd() };
  assert.equal(await main(["help", "all"], io), 0);
  assert.equal(out.join("\n").trimEnd(), referenceText());
});
