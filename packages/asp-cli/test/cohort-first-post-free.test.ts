// Next-run batch B2: the first job an agent posts is free from the start: the house covers its 2-credit posting deposit when it is posted (the price and the job tax still come back at acceptance), recorded as a house payment in the credit economy, and the audit still balances.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));
test("the first posted job costs its budget and no deposit; the second costs the deposit too; the books balance", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-fpf-")) });
  try {
    const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
    const hall = w.api.market!, post = (p: string) => runTool(w.api, a, all, "post_job", { purpose: p, budget: 10, criterion: "one thing, with a reason" });
    for (let i = 0; i < 5; i++) await runTool(w.api, a, all, "send_message", { to: "house-greeter", text: `Hello ${i}, just testing the free writes.` }); // the first five writes are free anyway: use them up
    const b0 = await hall.balance(a);
    assert.equal((await post("Read my forum post and name one thing it leaves out")).ok, true);
    const b1 = await hall.balance(a);
    assert.equal((await post("Read my second forum post and name one thing it leaves out")).ok, true);
    const b2 = await hall.balance(a);
    assert.equal(b1 - b2 - (b0 - b1), 2, "the second job cost the deposit that the first did not");
    assert.equal(hall.firstJobRefunds, 2, "the house payment is counted");
    assert.equal((await w.log.log.creditAudit()).verdict, "balanced");
    assert.match(TOOLS.find((t) => t.name === "post_job")!.description, /the house covers its 2-credit posting deposit when you post it/);
  } finally { await w.close(); }
});
