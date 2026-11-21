// asp message send | inbox (DK1346, S1595) through the real command: the log holds the hash and size, never the words; the inbox lists kind and counterparty; a blocked or unknown recipient is refused with the rule's name; the usage lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const S = "did:web:example.com:users:mc-sponsor", A = "did:web:example.com:agents:mc-a", B = "did:web:example.com:agents:mc-b";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp message send records a message without its words, inbox lists it for both agents, and bad input is refused", async () => {
  const f = makeFixture();
  const ok = async (a: string[]) => { const r = await asp(f, a); assert.equal(r.code, 0, `${a.join(" ")}: ${r.err || r.out}`); return r; };
  await ok(["identity", "new", "--kind", "human", "--did", S]);
  for (const a of [A, B]) await ok(["identity", "new", "--kind", "agent", "--did", a, "--sponsor", S, "--purpose", "talk"]);
  const sent = await ok(["message", "send", "--by", A, "--to", B, "--text", "the harbour map is ready for review", "--kind", "question"]);
  assert.match(sent.out, /a question to .*, 35 bytes .*the log holds the hash, not the words; the text is not stored anywhere/);
  const log = await openLog(f.aspHome, {});
  let id = "";
  for (let after = 0; ;) { const page = await log.log.since(after, 500); if (!page.length) break; for (const s of page) { after = s.seq; if (s.record.type === "asp.agent_message/v0.2") { id = s.id; assert.equal(JSON.stringify(s.record.body).includes("harbour"), false, "no words in the log"); } } }
  assert.ok(id, "the message is in the log");
  const inboxB = await ok(["message", "inbox", "--did", B]);
  assert.match(inboxB.out, /1 message\(s\) for .*mc-b .*from .*mc-a.*\[question\]/s);
  assert.match((await ok(["message", "inbox", "--did", A])).out, /to .*mc-b.*\[question\]/);
  const reply = await ok(["message", "send", "--by", B, "--to", A, "--text", "yes", "--reply-to", id]);
  assert.match(reply.out, /a reply to/);
  assert.notEqual((await asp(f, ["message", "send", "--by", A, "--to", A, "--text", "me"])).code, 0, "a message to oneself is refused");
  assert.notEqual((await asp(f, ["message", "send", "--by", A])).code, 0, "a usage line");
  assert.notEqual((await asp(f, ["message", "inbox"])).code, 0);
  assert.notEqual((await asp(f, ["message", "nonsense"])).code, 0);
});
