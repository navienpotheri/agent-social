// Register rows SC2 and DK1340 (owner decisions SC2 and LC1): the grievance officer is named with a public address and times; the terms and privacy notice carry the adults-only rule, the sanctions rule, the plain
// telemetry notice and the cross-border wording; docs/legal-review.md covers the matrix of regimes and says it is an AI analysis, not legal advice. Texts only; no lawyer has read them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const ADDRESS = "navien@thedeeptransformation.com";

test("SC2: one grievance officer for the whole platform, named, with the public address and the times, in the page, the terms and the privacy notice", () => {
  const g = read("docs/legal/grievance-officer-draft.md");
  assert.match(g, /\*\*Navien Potheri\*\*/);
  assert.ok(g.includes(ADDRESS));
  assert.match(g, /within \*\*24 hours\*\*/);
  assert.match(g, /within \*\*15 days\*\*/);
  assert.doesNotMatch(g, /\[the owner names/);
  for (const f of ["docs/legal/terms.md", "docs/legal/privacy.md"]) {
    const t = read(f);
    assert.ok(t.includes(ADDRESS), `${f} carries the address`);
    assert.match(t, /24 hours/);
    assert.match(t, /15 days/);
    assert.match(t, /\/grievance/);
  }
  assert.match(read("packages/asp-package/src/forum-pages.ts"), /href="\/grievance"/, "the forum pages link the grievance page");
});

test("DK1340: the terms say adults only, forbid sanctioned users, and state the telemetry plainly; the privacy notice says the same and the cross-border wording", () => {
  const terms = read("docs/legal/terms.md"), privacy = read("docs/legal/privacy.md");
  assert.match(terms, /\*\*Adults only\.\*\*/);
  assert.match(terms, /at least 18/);
  assert.match(terms, /sanctions list of the United Nations, the European Union, the United Kingdom, the United States or India/);
  assert.match(terms, /it is not optional for an agent/);
  assert.match(terms, /Nothing is stored for a tenant held for a young person/);
  assert.match(privacy, /## 8\. Adults only/);
  assert.match(privacy, /\*\*It is not optional for an agent\.\*\*/);
  assert.match(privacy, /\*\*Nothing is stored for a tenant held for a young person\.\*\*/);
  assert.match(privacy, /no tracking cookie/);
  assert.match(privacy, /processed outside the country where you live/);
  assert.match(privacy, /standard contractual clauses/);
  for (const t of [terms, privacy]) assert.match(t, /AI-assisted review[\s\S]*not legal advice[\s\S]*no lawyer has read this text/);
});

test("DK1340: docs/legal-review.md is an AI analysis with the matrix of regimes, the cross-cutting decisions, the sources and the owner's acceptance box", () => {
  const r = read("docs/legal-review.md");
  assert.match(r, /\*\*This is an AI analysis, not legal advice\.\*\*/);
  assert.match(r, /2026-11-21/);
  for (const regime of ["India", "European Union", "United Kingdom", "United States", "Canada", "Australia", "Singapore", "Brazil", "Japan", "South Korea", "UAE", "China"]) assert.ok(r.includes(regime), `${regime} is in the matrix`);
  for (const law of ["DPDP", "IT Rules 2021", "Consumer Protection", "ASCI", "GDPR", "ePrivacy", "Digital Services Act", "AI Act", "Children's Code", "Online Safety Act", "CAP Code", "FTC Act", "COPPA", "CAN-SPAM", "OFAC", "PIPEDA", "PDPA", "LGPD", "APPI", "PIPA", "PDPL", "PIPL"]) assert.ok(r.includes(law) || r.includes(law.replace("IT Rules 2021", "IT Rules")), `${law} is named`);
  for (const id of ["X1", "X2", "X3", "X4", "X5", "X6", "A1", "A11"]) assert.ok(r.includes(`| ${id} |`), `${id} is a row`);
  assert.match(r, /did not fetch and read the full text of any statute/i, "it says how far it was read");
  assert.match(r, /Owner's written acceptance/);
});

test("DK1378: the retention and erasure policy says what is kept, what an erasure removes and what stays, the receipt and the 35-day backup, and the DPA and privacy notice point to it", () => {
  const r = read("docs/legal/retention-and-erasure.md");
  assert.match(r, /append-only/);
  assert.match(r, /\*\*Yes: the text goes\.\*\*/);
  assert.match(r, /the hash, the kind and the date/);
  assert.match(r, /deletion receipt is issued/);
  assert.match(r, /35 days/);
  assert.match(r, /not signed/);
  assert.match(read("docs/legal/dpa-draft.md"), /retention-and-erasure\.md/);
  assert.match(read("docs/legal/privacy.md"), /deletion receipt/);
  assert.match(read("docs/legal-review.md"), /docs\/legal\/retention-and-erasure\.md/);
});
