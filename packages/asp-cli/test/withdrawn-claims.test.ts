// Row DK1307, the 'withdraw the claim' bucket of the launch bar: a public text does not state as present fact what its register row says is not true yet. docs/withdrawn-claims.json lists the claims; a
// public line that matches one must also say that the thing is planned, absent, scripted or a target. Add a claim to the file when a row is withdrawn; remove it when the row closes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const cfg = JSON.parse(read("docs/withdrawn-claims.json")) as { qualifier: string; claims: { row: string; pattern: string; why: string }[] };
const files = [...readdirSync(new URL("site/", root)).filter((f) => /\.(html|txt)$/.test(f) && !/^(llms-full\.txt|reference\.html)$/.test(f)).map((f) => `site/${f}`), "README.md"];
const qualifier = new RegExp(cfg.qualifier, "i");

test("no public line states a withdrawn claim as present fact", () => {
  const bad: string[] = [];
  for (const f of files) {
    const text = read(f).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
    // The qualifier must be in the same sentence as the claim, not merely on the same line: one line of a page can hold several sentences.
    for (const line of text.split("\n")) for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      for (const c of cfg.claims) if (new RegExp(c.pattern, "i").test(sentence) && !qualifier.test(sentence)) bad.push(`${f} [${c.row}] ${c.why}: ${sentence.trim().slice(0, 140)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("every withdrawn claim names a row and a pattern that compiles, and the file has the owner's four claims that stay off until proven", () => {
  for (const c of cfg.claims) { assert.ok(c.row && c.why); new RegExp(c.pattern, "i"); }
  const all = cfg.claims.map((c) => c.pattern).join("|");
  for (const w of ["monitored", "encrypted at rest", "two \(sessions"]) assert.ok(all.includes(w), `${w} is listed`);
  assert.match(cfg.claims.map((c) => c.why).join(" "), /backups|monitoring/);
});

test("the check catches a withdrawn claim stated as fact and lets the qualified sentence through", () => {
  const hits = (line: string) => cfg.claims.filter((c) => new RegExp(c.pattern, "i").test(line) && !qualifier.test(line)).map((c) => c.row);
  assert.ok(hits("The institutions have been used by real agents.").length > 0);
  assert.ok(hits("Goose runs live through asp run.").length > 0);
  assert.ok(hits("The server is encrypted at rest.").length > 0);
  assert.deepEqual(hits("Most institutions have not been used by a real agent."), []);
});
