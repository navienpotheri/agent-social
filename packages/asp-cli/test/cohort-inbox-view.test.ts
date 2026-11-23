// Diagnosis fix 2 (section 57): the inbox is a short list: messages from agents first, then the house's notes, newest first, each cut at 300 characters with the id to read it whole, a house note already read as one short line, at
// most eight shown and the rest counted; every message is still there and readable whole. In the 2026-11-24 run my_inbox was 31% of the result characters and was cut so that the newest messages were in the unseen part.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CUT, SHOWN, renderInbox, type InboxMsg } from "../src/cohort/inbox.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const m = (i: number, from: string, to: string, text: string, answered = false): InboxMsg => ({ id: `sha256:${String(i).padStart(4, "0")}${"a".repeat(20)}`, from, to, kind: "note", at: `2026-11-24T10:00:${String(i).padStart(2, "0")}Z`, text, answered });
const all = new Set(TOOLS.map((t) => t.scope));

test("agents' messages first, then the house's, newest first; long text cut with the id; an already read house note is one short line; at most eight, the rest counted", () => {
  const msgs = [m(1, "house-greeter", "me", "Welcome. ".repeat(60)), m(2, "house-guide-1", "me", "Where you start: the Registry. The Registry gives each agent an identity."), m(3, "agent-02", "me", "Shall we do the partner job together? ".repeat(12)), m(4, "me", "agent-02", "Yes."), m(5, "agent-03", "me", "Hello from agent 3.")];
  const v = renderInbox("me", msgs, new Set([msgs[1]!.id]));
  const lines = v.text.split("\n");
  assert.match(lines[0]!, /^sha256:0005\S+  from agent-03  \[note\]  not answered by you: Hello from agent 3\.$/, "the newest message from an agent is first");
  assert.match(lines[1]!, /to agent-02  \[note\]  not answered yet: Yes\./, "my own message to an agent is among the agent messages, newest first");
  assert.match(lines[2]!, /from agent-02/);
  assert.ok(lines[2]!.includes(`... (my_inbox with id ${msgs[2]!.id} shows it whole)`), "cut with the id");
  assert.ok(lines[2]!.length < CUT + 200);
  assert.ok(lines.findIndex((l) => /to agent-02/.test(l)) < lines.findIndex((l) => /from house-greeter/.test(l)), "all agent messages come before the house's");
  assert.match(lines.find((l) => /house-guide-1/.test(l))!, /^sha256:0002\S{0,5}\.\.\.  from house-guide-1  \[note\]  already read: Where you start: the Registry\. The Registry gives each agent\.\.\.$/, "a house note already read is one short line");
  assert.deepEqual(v.shown.includes(msgs[1]!.id), false);
  const many = Array.from({ length: 12 }, (_, i) => m(i + 1, "house-greeter", "me", "note"));
  const big = renderInbox("me", many, new Set());
  assert.equal(big.text.split("\n").length, SHOWN + 1);
  assert.match(big.text, /\n4 older messages not shown \(my_inbox with an id shows any message whole\)\.$/);
  assert.equal(renderInbox("me", [], new Set()).text, "You have no messages yet.");
  assert.equal(renderInbox("me", msgs, new Set(), msgs[0]!.id).text, `${msgs[0]!.id}  from house-greeter  [note]  not answered by you: ${"Welcome. ".repeat(60).replace(/\s+/g, " ")}`, "the whole message by id");
  assert.match(renderInbox("me", msgs, new Set(), "nope").text, /There is no message with that id/);
});

test("through the tool: a long house welcome is cut, the peer's message is on top and whole, reading by id shows the whole welcome, and the result stays short", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-inv2-")) });
  try {
    const hall = w.api.market!;
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    for (let i = 0; i < 3; i++) await call(b, "send_message", { to: "agent-01", text: `Message ${i} from agent-02: shall we compare notes about the jobs on the board?` });
    // the proxy that labels what another party wrote may join the lines with spaces: the checks do not depend on line breaks
    const first = (await call(a, "my_inbox")).text.split("\n\n")[0]!;
    assert.ok(first.indexOf("Message 2 from agent-02") < first.indexOf("Message 1 from agent-02") && first.indexOf("Message 1 from agent-02") < first.indexOf("Welcome, agent-01"), "agents' messages newest first, then the house's");
    assert.ok(first.length < 2500, `${first.length} characters`);
    const wid = /(sha256:[0-9a-f]{64})  from house-greeter  \[notice\]  not answered by you: Welcome, agent-01/.exec(first)![1]!;
    assert.match((await call(a, "my_inbox", { id: wid })).text, /Welcome, agent-01\. I am the house greeter/);
    // read once: the next look folds the house notes it showed
    assert.match((await call(a, "my_inbox")).text, /already read: Welcome, agent-01/);
  } finally { await w.close(); }
});
