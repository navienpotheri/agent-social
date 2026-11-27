// Register rows DK1383, DK1377, DK1380, DK1363, DK1368 (drafts): the procurement pack is traceable (every answer cites evidence that exists), names no price and claims no certification; the subprocessors list
// matches the Privacy Notice; the data-sharing choice is stated as it is (not optional today, private option coming); the enterprise page is a draft whose claims are on the list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const PACK = ["docs/procurement/README.md", "docs/procurement/security-questionnaire.md", "docs/procurement/data-flow.md", "docs/procurement/subprocessors.md", "docs/procurement/residency.md", "docs/legal/dpa-draft.md", "docs/legal/enterprise-terms-draft.md", "docs/enterprise/plans.md", "site/enterprise.html"];

test("the security questionnaire has 39 answers, each with evidence that exists (or is not applicable)", () => {
  const q = read("docs/procurement/security-questionnaire.md");
  const answers = [...q.matchAll(/^(\d+)\. \*\*(.+?)\*\* (.+)$/gm)];
  assert.equal(answers.length, 39, "39 questions");
  for (const m of answers) {
    const body = m[3]!;
    if (/^Not applicable/.test(body)) continue;
    const ev = /Evidence: (.+?)\.?$/.exec(body);
    assert.ok(ev, `Q${m[1]} cites evidence`);
    for (const path of ev![1]!.split(",").map((x) => x.trim().replace(/\.$/, "")).filter(Boolean)) assert.ok(existsSync(new URL(path, root)), `Q${m[1]}: ${path} exists`);
  }
});

test("the pack names no price, claims no certification and says it is AI-reviewed, not a lawyer's", () => {
  const price = /(?:USD|₹|€|\$|Rs\.?)\s?\d[\d,]*(?:\.\d+)?\s?(?:a|per|\/)\s?(?:month|year|agent|seat)/i;
  const cert = /\b(?:we are|is|are) (?:SOC ?2|ISO ?27001)(?: Type [12])? (?:certified|compliant|audited)\b/i;
  for (const f of PACK) {
    const t = read(f).replace(/<script[\s\S]*?<\/script>/g, "");
    assert.doesNotMatch(t, price, `${f} names a price`);
    assert.doesNotMatch(t, cert, `${f} claims a certification`);
  }
  for (const f of ["docs/procurement/README.md", "docs/legal/dpa-draft.md", "docs/legal/enterprise-terms-draft.md"]) assert.match(read(f), /no lawyer has read/i, `${f} says no lawyer has read it`);
  assert.match(read("docs/procurement/security-questionnaire.md"), /No certification is held or claimed/);
});

test("the subprocessors are the ones in the Privacy Notice, and the data-flow diagram and the residency statement name them and Mumbai", () => {
  const privacy = read("docs/legal/privacy.md"), sub = read("docs/procurement/subprocessors.md");
  for (const [name, re] of [["Google Cloud", /Google Cloud/], ["Mumbai", /Mumbai/], ["Resend", /Resend/]] as const) {
    assert.match(privacy, re, `the Privacy Notice names ${name}`);
    assert.match(sub, re, `the subprocessors list names ${name}`);
  }
  assert.match(read("docs/procurement/data-flow.md"), /Mumbai/);
  assert.match(read("docs/procurement/data-flow.md"), /Resend/);
  assert.match(read("docs/procurement/residency.md"), /one server in Mumbai, India/i);
});

test("the data-sharing choice is stated as it is: not optional today, the private option coming, in the DPA, the terms, the questionnaire and the enterprise page", () => {
  for (const f of ["docs/legal/dpa-draft.md", "docs/legal/enterprise-terms-draft.md", "docs/procurement/security-questionnaire.md", "site/enterprise.html"]) {
    const t = read(f).replace(/<[^>]+>/g, " ");
    assert.match(t, /not optional/i, `${f} says it is not optional`);
    assert.match(t, /coming/i, `${f} says the private option is coming`);
  }
  assert.match(read("docs/legal/dpa-draft.md"), /72 hours/);
});

test("the enterprise page is an unpublished draft that says what is coming and is not in the sitemap until approved", () => {
  const html = read("site/enterprise.html");
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /waits for the owner's approval/);
  assert.match(html, /Not yet built[\s\S]*Not built:/);
  const claims = JSON.parse(read("docs/site-claims.json")) as { approved: boolean; pages: string[] };
  assert.ok(claims.pages.includes("site/enterprise.html"));
  if (!claims.approved) assert.ok(!/enterprise\.html/.test(read("site/sitemap.xml")), "not in the sitemap while a draft");
});
