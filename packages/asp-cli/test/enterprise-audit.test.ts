// Register row DK1369: the enterprise readiness audit is complete. Every checklist item of docs/enterprise-fleets.md has a status and the rows that carry it, every row cited exists, an item that is not built names a row
// (or is said to be not offered), and every enterprise row DK1353 to DK1387 appears. The owner has still to read it (the row stays partial until then).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const audit = read("docs/enterprise/readiness-audit.md");
const register = read("docs/gaps-register.md");
const known = (id: string) => new RegExp(`^\\| ${id} \\|`, "m").test(register);

const CHECKLIST = ["single sign-on", "Access control", "SIEM", "Policy as code", "key custody", "Network controls", "residency", "Retention and deletion", "Encryption at rest", "Compliance documents", "Service levels", "Billing", "API and SDK", "Webhooks", "quotas by plan", "Disaster recovery", "Multi-region", "Sandbox", "Procurement and legal terms", "Migration and export"];

test("DK1369: each of the 20 checklist items has a status and a row (or is said to be not offered), and the rows it cites exist", () => {
  const rows = [...audit.matchAll(/^\| (\d+|A\d+) \| (.+?) \| (built|partial|planned|not offered) \| (.*?) \|(?: (.*?) ?\|)$/gm)];
  assert.ok(rows.length >= 29, `${rows.length} items`);
  for (const item of CHECKLIST) assert.ok(rows.some((r) => r[2]!.toLowerCase().includes(item.toLowerCase())), `the checklist item "${item}" is in the audit`);
  for (const r of rows) {
    const cited = r[4]!.split(",").map((x) => x.trim()).filter((x) => x && x !== "none");
    if (r[3] === "not offered") assert.deepEqual(cited, [], `${r[1]}: a not-offered item cites no row`);
    else if (r[3] !== "built" || r[4]!.trim() !== "none") assert.ok(cited.length > 0, `${r[1]}: ${r[3]} needs a row`);
    for (const id of cited) assert.ok(known(id), `${r[1]}: ${id} is a register row`);
  }
});

test("DK1369: every enterprise row DK1353 to DK1387 is in the audit's table and in the register", () => {
  for (let n = 1353; n <= 1387; n++) {
    assert.ok(known(`DK${n}`), `DK${n} is a register row`);
    assert.ok(new RegExp(`^\\| DK${n} \\| (open|partial|closed|designed) \\|`, "m").test(audit), `DK${n} is in the audit's table`);
  }
});

test("DK1369: the audit says it claims no certification, and the one gap it found has its own row", () => {
  assert.match(audit, /Nothing here claims a certification/);
  assert.match(audit, /DK1411/);
  assert.ok(known("DK1411"));
  assert.match(register, /^\| DK1411 \| Encryption at rest/m);
});

test("DK1387: the compliance roadmap claims no certification, cites evidence that exists, and orders what may follow after funding", () => {
  const r = read("docs/enterprise/compliance-roadmap.md");
  assert.match(r, /No certification is held and none is claimed/);
  assert.match(r, /no outside security review/i);
  assert.doesNotMatch(r, /\b(?:we are|is|are) (?:SOC ?2|ISO ?27001)(?: Type [12])? (?:certified|compliant|audited)\b/i);
  const paths = [...r.matchAll(/\b((?:docs|packages|spec)\/[A-Za-z0-9_./-]+\.(?:md|ts|json)|SECURITY\.md)\b/g)].map((m) => m[1]!);
  assert.ok(paths.length >= 12, `${paths.length} paths cited`);
  for (const p of new Set(paths)) assert.ok(existsSync(new URL(p, root)), `${p} exists`);
  assert.ok(r.indexOf("An outside security review") < r.indexOf("SOC 2 Type 1"), "the review comes before SOC 2");
  assert.ok(r.indexOf("SOC 2 Type 1") < r.indexOf("ISO 27001 |"), "SOC 2 comes before ISO 27001");
});
