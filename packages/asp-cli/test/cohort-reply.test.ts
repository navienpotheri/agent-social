// Row ENG76: in the real 15-agent run 11 agents each sent kind "reply" without the id it answered. The send_message tool can no longer be called in that shape: a reply is made by giving the id it answers (reply_to),
// there is no kind "reply" to choose, and the old shape gets a plain refusal that names the kinds there are; a message that names a message it answers is accepted as a reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defOf, runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("there is no kind 'reply' to pick; the description says how to answer; a message that gives reply_to is a reply; the old shape is refused plainly; a note works", async () => {
  const def = defOf("send_message")!;
  const props = def.input_schema.properties as Record<string, { enum?: string[]; description?: string }>;
  assert.deepEqual(props.kind!.enum, ["note", "question", "offer", "notice"]);
  assert.match(def.description, /To answer a message, give reply_to \(its id from my_inbox\) and nothing else is needed\./);
  assert.match(props.reply_to!.description!, /giving it makes your message a reply/);
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-reply-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02");
    for (const x of [a, b]) await w.api.market!.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    // the old shape of the real run: kind reply, no id
    const old = await call(a, "send_message", { to: "house-greeter", kind: "reply", text: "I read the charters and did a job." });
    assert.equal(old.ok, false);
    assert.match(old.text, /kind is one of note, question, offer, notice/);
    assert.match(old.text, /Nothing was done; try again within them\./);
    // a note, then a reply that names it
    const note = await call(a, "send_message", { to: "agent-02", text: "Would you like to do a job together?" });
    assert.equal(note.ok, true, note.text);
    assert.match(note.text, /^Sent: a note to agent-02/);
    const id = /sha256:[0-9a-f]+/.exec(note.text)![0];
    const reply = await call(b, "send_message", { to: "agent-01", text: "Yes, gladly.", reply_to: id });
    assert.equal(reply.ok, true, reply.text);
    assert.match(reply.text, /^Sent: a reply to agent-01/);
    // naming a message it answers while also choosing a kind still makes a reply
    const both = await call(b, "send_message", { to: "agent-01", text: "And on Friday.", kind: "note", reply_to: id });
    assert.match(both.text, /^Sent: a reply to agent-01/);
    // the greeter's welcome can be answered the same way
    const welcome = (await w.api.market!.inbox(a)).find((m) => m.from === "house-greeter")!;
    assert.match((await call(a, "send_message", { to: "house-greeter", text: "Thank you.", reply_to: welcome.id })).text, /^Sent: a reply to house-greeter/);
    assert.match((await call(a, "my_inbox")).text, /answered/);
  } finally { await w.close(); }
});
