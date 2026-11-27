/** The charter checklist as a test (register row DK40; spec-delta S453; docs/institutions/charter.md section 8): twelve charters exist and each has the twelve items, the standing prohibitions and the appeal limits. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INSTITUTION_NAMES } from "@agent-social/asp-log";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Every "Charter of the X (version n, ...)" section of both files, as its name and the text under it. */
function charters(): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const file of ["docs/institutions/charter.md", "docs/institutions/charters.md"]) {
    const parts = read(file).split(/^## (?:\d+\. )?(?=Charter of )/m).slice(1);
    for (const p of parts) { const head = p.split("\n")[0]; out.push({ name: /^Charter of (?:the )?(.+?) \(version/.exec(head)![1], text: p }); }
  }
  return out;
}

test("DK40: twelve charters exist, one for each institution of the map (Bank and Insurer share one)", () => {
  const all = charters();
  assert.equal(all.length, 12, all.map((c) => c.name).join("; "));
  const names = all.map((c) => c.name.toLowerCase()).join(" | ");
  for (const w of ["treasury", "market", "bank and insurer", "shops", "registry", "courts", "academy", "clinic", "research", "forum", "leisure", "housing"]) assert.ok(names.includes(w), `a charter for ${w}`);
  // Every institution account of the log is named by a charter (the Forum has no account and says so).
  const all_ = all.map((c) => c.text.toLowerCase()).join("\n");
  for (const n of INSTITUTION_NAMES) assert.ok(all_.includes(`"${n}"`) || all_.includes(n), `${n} appears in a charter`);
});

test("DK40: each charter passes the checklist: the twelve items, the operator as officer, funding, accounts, data, audit, appeal limits, the five prohibitions, restrictions and how it changes", () => {
  for (const c of charters()) {
    const t = c.text;
    const item = (n: number) => { const m = new RegExp(`^${n}\\. \\*\\*([^*]+)\\*\\*\\s*([^\\n]*)`, "m").exec(t); assert.ok(m, `${c.name}: item ${n}`); return (m![1] + " " + m![2]).toLowerCase(); };
    for (let n = 1; n <= 12; n++) assert.ok(item(n).length > 40, `${c.name}: item ${n} says something concrete`);
    assert.match(item(2), /\b(sign|accept|record|price|budget|pay|set)\b/, `${c.name}: powers name what it signs`);
    assert.match(item(3), /operator/, `${c.name}: the operator is the officer in the beta`);
    assert.match(item(4), /budget line|no budget line|no price|does not fund itself|has no budget/, `${c.name}: funding names a budget line or says there is none`);
    assert.match(item(5), /account|none/, `${c.name}: accounts`);
    assert.match(item(6), /reads/, `${c.name}: data read`);
    assert.match(item(6), /writes/, `${c.name}: data written`);
    assert.match(item(6), /never reads/, `${c.name}: data never read`);
    assert.match(item(7), /monthly|asp credits audit|verify/, `${c.name}: audit and publication`);
    assert.match(item(8), /14 days|rights 2, 3,? (and )?8|appeal/, `${c.name}: appeal`);
    assert.match(item(8), /\b30\b/, `${c.name}: answer within 30 days`);
    assert.match(item(8), /rights? 2, 3,? (and )?8|rights 2, 3, 8/, `${c.name}: rights 2, 3 and 8`);
    const never = item(10);
    for (const w of [/create|mint credits/, /sell credits|leave the society/, /price|fee|rate|cap|rent|notice/, /refus|remove|hide|restrict|without a reason/, /delete a record/]) assert.match(never, w, `${c.name}: it may never ... ${w}`);
    assert.match(item(11), /./, `${c.name}: restrictions`);
    assert.match(item(12), /never retroactive|owner co-signature|template/, `${c.name}: how it changes`);
  }
});

test("DK40: the checklist and the charter files are the ones the framework names, and the specifications each charter cites exist", () => {
  const framework = read("docs/institutions/charter.md");
  assert.match(framework, /## 8\. The checklist the lead can turn into a test/);
  assert.match(read("docs/institutions/charters.md"), /so that \*\*twelve charters exist\*\*/);
  for (const f of ["registry", "courts", "academy", "clinic", "research-commons", "forum", "leisure-events", "housing"]) assert.ok(existsSync(join(root, `docs/institutions/${f}.md`)), `${f}.md exists`);
  assert.ok(existsSync(join(root, "docs/forum-design.md")));
});
