/** The vulnerability and legal-request process (register row T8; spec-delta S410): written, linked from SECURITY.md, and tied to files and commands that exist. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

test("T8: the process names the steps and targets for a report and for a legal request, and every file it points at exists", () => {
  const doc = read("docs/security-process.md");
  for (const h of ["Acknowledge", "Triage", "Fix", "Disclose"]) assert.match(doc, new RegExp(`\| \d\. ${h} `), h);
  assert.match(doc, /7 days/); assert.match(doc, /critical 30 days, high 60 days/);
  for (const w of ["Log it", "Check it", "Answer narrowly", "Tell the user", "A takedown demand", "Count them"]) assert.ok(doc.includes(w), w);
  assert.match(doc, /No outside security review has happened/);
  const links = [...doc.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]).filter((l) => !/^https?:/.test(l));
  assert.ok(links.length >= 6);
  for (const l of links) assert.ok(existsSync(join(root, "docs", l)) || existsSync(join(root, l)), `${l} exists`);
  for (const f of ["packages/asp-log", "packages/asp-package/src/gateway"]) assert.ok(existsSync(join(root, f)), f);
});

test("T8: SECURITY.md points at the process, and what the doc says the service cannot hand over matches the privacy notice", () => {
  assert.match(read("SECURITY.md"), /docs\/security-process\.md/);
  const privacy = read("docs/legal/privacy.md");
  assert.match(privacy, /we hold ciphertext and cannot read it/);
  assert.match(read("docs/security-process.md"), /ciphertext and cannot read it/);
  assert.match(read("docs/security-process.md"), /never held/);
});
