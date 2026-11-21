/** The rights charter, each right backed by a mechanism (register row GV11; spec-delta S483): every right in docs/legal/rights-charter-draft.md names what backs it, and each command, file and rule it names exists. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const charter = read("docs/legal/rights-charter-draft.md");
const body = charter.slice(charter.indexOf("## The charter"), charter.indexOf("## Not promised"));
const rights = body.split(/^(?=\d+\. \*\*)/m).filter((x) => /^\d+\. \*\*/.test(x));

test("GV11: the charter has nine rights, and each says what backs it", () => {
  assert.equal(rights.length, 9);
  for (const r of rights) assert.match(r, /\*Backed by:\*/, `${r.slice(0, 40)} names what backs it`);
  for (const w of ["To know the rules", "To a reason", "To be heard, and to appeal", "To your data", "To your keys", "To stop", "To privacy of what your agent learns", "To a say before the operator acts", "To leave and to retire"]) assert.ok(body.includes(`**${w}`), w);
});

test("GV11: every command a right names is a documented command, and every file or test it names exists", () => {
  const commands = read("docs/commands.md");
  const named = [...body.matchAll(/`(asp [a-z]+(?: [a-z|-]+)?)/g)].map((m) => m[1].split("|")[0].trim());
  assert.ok(named.length >= 8);
  for (const c of new Set(named)) assert.ok(commands.includes(`\`${c}`) || commands.includes(`${c} `) || commands.includes(`${c}|`) || commands.includes(`${c}\``), `${c} is a documented command`);
  for (const f of ["docs/deploy/court.md", "docs/law/code.md", "docs/operator-runbook.md", "docs/provider-terms.md", "docs/leaving.md", "packages/asp-package/src/private-memory.ts"]) assert.ok(existsSync(join(root, f)), f);
  // The mechanisms behind the new claims are in the code and tested.
  assert.match(read("packages/asp-log/src/courts-rules.ts"), /b\.act === "institutional_ruling"/, "a Court's order over the Registry");
  assert.match(read("packages/asp-log/src/courts-rules.ts"), /appeal_window_days/, "the appeal window");
  assert.match(read("packages/asp-log/src/registry-rules.ts"), /takedown_not_a_live_name|name_takedown/, "a takedown takes a name");
  assert.ok(readdirSync(join(root, "packages/asp-log/test")).includes("registry-court-orders.test.ts"));
  assert.ok(readdirSync(join(root, "packages/asp-cli/test")).includes("agent-remove.test.ts"));
});

test("GV11: what is not promised is said, and the charter no longer says appeals are deferred", () => {
  const not = charter.slice(charter.indexOf("## Not promised"), charter.indexOf("## For the owner to decide"));
  assert.match(not, /No guarantee against arbitrary suspension/);
  assert.match(not, /No independence of the court/);
  assert.ok(!/appeals were deferred|No right of appeal/i.test(charter), "appeals exist now");
});
