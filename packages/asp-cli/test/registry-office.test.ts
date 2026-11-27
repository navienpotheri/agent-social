/** The Registry office and its published service level (register row IS2; spec-delta S472): each number in docs/institutions/registry-office.md is the code's, and each function the page lists has a command, a rule or a test behind it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPEAL_WINDOW_MS, HEARING_MS, INTERIM_MAX_MS, LAPSE_AFTER_MS, NAME_GRACE_MS, NAME_TERM_MS, RENEWAL_WINDOW_MS, MAX_NAMES_PER_AGENT, MAX_NAMES_PER_SPONSOR } from "../../asp-log/src/registry.ts";
import { SPONSOR_PASSPORTS_PER_DAY } from "@agent-social/asp-log";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const DAY = 86_400_000;

test("IS2: every commitment in the service level table is the code's number", () => {
  const doc = read("docs/institutions/registry-office.md");
  const row = (label: RegExp) => { const line = doc.split(String.fromCharCode(10)).find((l) => label.test(l)); assert.ok(line, `a row for ${label}`); const m = /([0-9]+) days/.exec(line!); assert.ok(m, `days in ${line}`); return Number(m![1]) * DAY; };
  assert.equal(row(/The holder of a reported name is heard for/), HEARING_MS);
  assert.equal(row(/A takedown can be appealed for/), APPEAL_WINDOW_MS);
  assert.equal(row(/An interim suspension lasts at most/), INTERIM_MAX_MS);
  assert.equal(row(/A name is held for/), NAME_TERM_MS);
  assert.equal(row(/A lapsed name stays held for its holder for/), NAME_GRACE_MS);
  assert.equal(row(/A renewal opens before it is due/), RENEWAL_WINDOW_MS);
  assert.equal(row(/An identity lapses after its due date/), LAPSE_AFTER_MS);
  assert.equal(row(/An appeal to the Registrar is answered within/), 30 * DAY, "the answer time is the charter's");
  assert.match(read("docs/institutions/charters.md"), /holder may appeal to the Registrar within 14 days and is answered with reasons within 30 days/);
  assert.match(doc, new RegExp(`one live name for each agent, five for each sponsor`));
  assert.equal(MAX_NAMES_PER_AGENT, 1); assert.equal(MAX_NAMES_PER_SPONSOR, 5);
  assert.match(doc, new RegExp(`at most ${SPONSOR_PASSPORTS_PER_DAY} new agent passports a sponsor a day`));
});

test("IS2: each function of the office has something behind it: a command, a rule or a test that runs it", () => {
  const commands = read("docs/commands.md");
  assert.match(commands, /asp identity recover <did>/);
  assert.match(commands, /asp identity recovery-check <did>/);
  for (const f of ["packages/asp-log/test/registry-civil.test.ts", "packages/asp-log/test/registry-levels.test.ts", "packages/asp-log/test/registry-court-orders.test.ts", "packages/asp-log/src/registry-rules.ts"]) assert.ok(existsSync(join(root, f)), f);
  const civil = read("packages/asp-log/test/registry-civil.test.ts");
  for (const w of ["impersonation", "renewal", "suspension", "name rules"]) assert.match(civil, new RegExp(w, "i"), `a test for ${w}`);
  assert.match(read("packages/asp-log/test/registry-levels.test.ts"), /identity levels/);
  assert.match(read("docs/institutions/registry-office.md"), /certified is not available in the beta/);
});
