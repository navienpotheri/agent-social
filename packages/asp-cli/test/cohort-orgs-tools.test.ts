// Organisations Phase A, the tools over the simulation ledger: org_found, org_invest (the pool opens it), org_join, org_pay and org_close_period by an officer only, org_look, the house closing periods at the market hour, the report section labelled as a ledger beside the log, the statistics share, the introduction paragraph only with --orgs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { longIntro } from "../src/cohort/intro-long.ts";
import { statsOf } from "../src/cohort/stats.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("found, invest to open, join, an officer pays and closes, a non-officer cannot, the house closes at the market hour, the report and the statistics show it", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-orgt-")), orgs: true, dayCycle: true, dayMs: 8 * 60_000 });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02"), c = await w.enrol(2, "agent-03");
    for (const x of [a, b, c]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, n: string, i: Record<string, unknown> = {}) => runTool(w.api, who, all, n, i);
    assert.match((await call(a, "org_found", { name: "Bakery", pool_target: 30 })).text, /Founded org-1/);
    assert.match((await call(a, "org_invest", { org: "org-1", amount: 20 })).text, /Invested 20/);
    assert.match((await call(b, "org_invest", { org: "org-1", amount: 10 })).text, /OPEN, with a treasury/);
    assert.equal((await call(c, "org_join", { org: "org-1", role: "employee", wage: 4 })).ok, true);
    assert.equal((await call(c, "org_pay", { org: "org-1", to: "agent-03", amount: 3, kind: "wage" })).ok, false, "only an officer pays");
    assert.equal((await call(b, "org_pay", { org: "org-1", to: "agent-03", amount: 3, kind: "wage" })).ok, true, "the second officer (the largest other shareholder) may pay: one sleeping officer does not stall it");
    assert.match((await call(a, "org_close_period", { org: "org-1" })).text, /Period closed/);
    const look = (await call(c, "org_look", {})).text; assert.match(look, /Phase A organisation ledger \(a simulation ledger beside the log, not in the log\)/); assert.match(look, /org-1 "Bakery": open/);
    assert.equal(w.api.orgs!.conserved(), true); assert.equal(w.api.orgs!.verifyJournal(), true);
    const d = w.api.dayCycle!; d.now = () => 9 / 24 * 8 * 60_000 + 10; await d.due(0, d.now());
    assert.ok(w.api.orgs!.orgs.get("org-1")!.period >= 2, "the house closed a period at the market hour");
    assert.match(w.api.orgs!.render(), /\| org-1 Bakery \| open /); assert.match(w.api.orgs!.render(), /\(conserved\)/);
    const s = await statsOf(w.api); assert.ok(s!.orgShare > 0 && s!.orgShare < 1);
  } finally { await w.close(); }
});
test("the introduction names the organisations only in a run that has them", async () => {
  const on = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-orgi-")), orgs: true }), off = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-orgj-")) });
  try {
    assert.match(longIntro(on.api, 0, {}), /ORGANISATIONS\. org_found starts an organisation/); assert.doesNotMatch(longIntro(off.api, 0, {}), /ORGANISATIONS|org_found/);
    assert.match((await runTool(off.api, await off.enrol(0, "agent-01"), all, "org_look", {})).text, /There are no organisations/);
  } finally { await on.close(); await off.close(); }
});
