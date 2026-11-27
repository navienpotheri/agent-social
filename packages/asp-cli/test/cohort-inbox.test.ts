// Row DK1346 (cohort): direct messages between agents are signed records in the log (send_message), with an inbox (my_inbox), blocks, a size limit and a rate limit already; the gap that is closed here: an unread count in the
// open items, delivery counted (recorded as sent), and a report that says how many messages were delivered, read and answered, between agents and from the house.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderMessageDelivery } from "../src/cohort/talk.ts";
import { openItems, runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("an unread count is in the open items until the agent reads its inbox; a message is delivered as it is sent, read when seen, answered when a later message names it", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-inb-")) });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const base = await hall.messageStats();
    const sent = await call(a, "send_message", { to: "agent-02", text: "Would you compare notes?", kind: "question" });
    const id = /sha256:[0-9a-f]+/.exec(sent.text)![0];
    const unreadB = async (): Promise<number> => Number(/(\d+) unread message/.exec((await openItems(w.api, b)).join("; "))?.[1] ?? 0);
    const before = await unreadB();
    assert.ok(before >= 1, "the greeter's welcome and agent-01's message are unread");
    let s = await hall.messageStats();
    assert.equal(s.delivered, base.delivered + 1, "delivered as it was sent");
    assert.equal(s.toAgents.delivered, 1);
    assert.equal(s.toAgents.read, 0);
    await call(b, "my_inbox");
    assert.equal(await unreadB(), 0, "reading the inbox clears the unread count");
    assert.ok(!(await openItems(w.api, b)).some((x) => /unread message/.test(x)));
    s = await hall.messageStats();
    assert.equal(s.toAgents.read, 1);
    assert.equal(s.toAgents.answered, 0);
    await call(b, "send_message", { to: "agent-01", text: "Gladly.", reply_to: id });
    s = await hall.messageStats();
    assert.deepEqual([s.toAgents.delivered, s.toAgents.read, s.toAgents.answered], [2, 1, 1]);
    assert.match((await openItems(w.api, a)).join("; "), /1 unread message \(my_inbox\)|[0-9]+ unread messages \(my_inbox\)/, "the reply is unread for agent-01");
  } finally { await w.close(); }
});

test("the report line says delivered, read and answered, for all messages and for those written by agents", async () => {
  assert.equal(renderMessageDelivery({ delivered: 5, read: 3, answered: 2, toAgents: { delivered: 2, read: 1, answered: 1 } }), "## What became of the direct messages\n\n5 direct messages were delivered (each is a signed record in the log from the moment it is sent): 3 read by the agent it was sent to (seen in my_inbox) and 2 answered by a later message that names it. Of the messages written by agents rather than the house: 2 delivered, 1 read, 1 answered. An agent's open items count its unread messages. These are counts of one run.\n\n");
  const o = { out: mkdtempSync(join(tmpdir(), "asp-inb2-out-")), home: mkdtempSync(join(tmpdir(), "asp-inb2-home-")), agents: 2, model: "stand-in", provider: standInProvider((i) => ["talker", "answerer"][i]!, { latencyMs: 4 }), staggerMs: 300, budgetUsd: 2, totalUsd: 4, minutes: 3, priceIn: 1, priceOut: 5, maxTurns: 30, io: { out: () => undefined } } as CohortOptions;
  const md = readFileSync((await runCohort(o)).markdownPath, "utf8");
  assert.match(md, /## What became of the direct messages\n\n[0-9]+ direct messages? (was|were) delivered .*Of the messages written by agents rather than the house: [1-9][0-9]* delivered, [0-9]+ read, [0-9]+ answered\./s);
});
