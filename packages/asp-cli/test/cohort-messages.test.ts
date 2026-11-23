// Row DK1801, slice 2 (direct messages; the record is DK1346's `agent_message`): the cohort's agents write to each other through send_message and my_inbox as signed records on the run's log (who, to whom, the kind, the
// hash and size of the words, never the words); the log's own refusals apply (a blocked sender, a reply to a message not received, the rate limits); the report counts who wrote to whom, the kinds, the replies and the
// messages nobody answered; the log verifies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCohort } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";
import { runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";

const all = new Set(TOOLS.map((t) => t.scope));

test("DK1801 messages: two scripted agents exchange an offer and a reply, and the report shows who wrote to whom, the kinds, the reply and no unanswered message", async () => {
  const out = mkdtempSync(join(tmpdir(), "asp-cohort-msg-")), home = mkdtempSync(join(tmpdir(), "asp-cohort-msghome-"));
  const r = await runCohort({ out, home, agents: 2, model: "stand-in", provider: standInProvider((i) => (i === 0 ? "messenger" : "replier"), { latencyMs: 20 }), staggerMs: 150, budgetUsd: 1, totalUsd: 2, minutes: 2, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined } });
  assert.deepEqual(r.report.perAgent.map((s) => s.endReason), ["stopped_exploring", "stopped_exploring"]);
  assert.deepEqual(r.report.messages, { sent: 2, toHouse: 0, byKind: { offer: 1, reply: 1 }, replies: 1, unanswered: 0, blockedAttempts: 0 });
  const e = (from: string, to: string) => r.report.edges.find((x) => x.from === from && x.to === to);
  assert.equal(e("agent-01", "agent-02")?.messages, 1);
  assert.equal(e("agent-02", "agent-01")?.messages, 1);
  assert.equal(e("agent-02", "agent-01")?.replies, 1);
  const md = readFileSync(r.markdownPath, "utf8");
  assert.match(md, /## Direct messages/);
  assert.match(md, /2 messages sent \(offer 1, reply 1\), 1 of them replies, 0 with no message back/);
  assert.match(md, /agent-02 → agent-01: 1 direct message \(1 reply\)/);
});

test("DK1801 messages: the log holds the signed record and the hash, never the words; a reply must name a message received; a blocked sender, an unknown agent and the size and rate limits are refused with the log's own reason; the log verifies", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-cohort-msghall-")) });
  try {
    const a = await w.enrol(0, "agent-01"), b = await w.enrol(1, "agent-02"), c = await w.enrol(2, "agent-03");
    const hall = w.api.market!;
    for (const x of [a, b, c]) await hall.enrolStandalone(x);
    const call = (who: typeof a, name: string, input: Record<string, unknown> = {}) => runTool(w.api, who, all, name, input);
    const WORDS = "A private offer about the charters that must not be in the log.";
    const sent = await call(a, "send_message", { to: "agent-02", text: WORDS, kind: "offer" });
    assert.equal(sent.ok, true, sent.text);
    assert.equal(sent.targetAuthor, b.did, "addressed to the recipient");
    const id = /\((sha256:[0-9a-f]+)\)/.exec(sent.text)![1]!;
    const msgs = (await w.log.log.recordsOfTypes(["agent_message"])) as unknown as Array<{ issuer: string; body: { to: string; kind: string; body_sha256: string; bytes: number } }>;
    const recs = msgs.filter((x) => x.issuer === a.did); // the house greeter's welcomes are in the log too
    assert.equal(recs.length, 1);
    assert.deepEqual([recs[0].issuer, recs[0].body.to, recs[0].body.kind, recs[0].body.bytes], [a.did, b.did, "offer", Buffer.byteLength(WORDS)]);
    assert.equal(recs[0].body.body_sha256, createHash("sha256").update(WORDS).digest("hex"), "the hash proves which words were sent");
    assert.ok(!JSON.stringify(recs).includes("private offer"), "the words are not in the log");
    assert.match((await call(b, "my_inbox")).text, /from agent-01  \[offer\]  not answered by you: A private offer/);
    // a reply must answer a message the sender received
    const wrong = await call(c, "send_message", { to: "agent-01", text: "me too", reply_to: id });
    assert.equal(wrong.ok, false);
    assert.match(wrong.refused ?? "", /message_reply_unknown/);
    const reply = await call(b, "send_message", { to: "agent-01", text: "Yes please.", reply_to: id });
    assert.equal(reply.ok, true, reply.text);
    assert.match((await call(a, "my_inbox")).text, /to agent-02  \[offer\]  answered/);
    // an unknown agent and a message to oneself
    assert.match((await call(a, "send_message", { to: "agent-99", text: "x" })).text, /no agent called agent-99/);
    assert.match((await call(a, "send_message", { to: "agent-01", text: "x" })).refused ?? "", /message_to_self/);
    // blocking: after agent-03 blocks agent-01, agent-01's message is refused by the log; lifting the block lets it through
    assert.equal((await call(c, "block_agent", { agent: "agent-01" })).ok, true);
    const blocked = await call(a, "send_message", { to: "agent-03", text: "Hello?" });
    assert.equal(blocked.ok, false);
    assert.match(blocked.refused ?? "", /message_blocked/);
    assert.match(blocked.text, /has blocked/);
    assert.equal((await call(c, "block_agent", { agent: "agent-01", lift: true })).ok, true);
    assert.equal((await call(a, "send_message", { to: "agent-03", text: "Hello again." })).ok, true);
    assert.equal((await call(c, "block_agent", { agent: "agent-77" })).ok, false);
    // the rate limit per recipient: 10 a day to one agent, a reply does not count
    let limited = "";
    for (let i = 0; i < 12 && !limited; i++) { const r = await call(a, "send_message", { to: "agent-02", text: `note ${i}` }); if (!r.ok) limited = r.refused ?? ""; }
    assert.match(limited, /message_rate_pair/);
    assert.equal((await call(b, "send_message", { to: "agent-01", text: "still replying", reply_to: id })).ok, true, "a reply does not count against the per-recipient limit");
    assert.equal((await w.log.log.verify()).ok, true);
    assert.equal((await w.log.log.creditAudit()).verdict, "balanced");
  } finally { await w.close(); }
});

test("DK1801 messages: a refused message because of a block is counted in the report", async () => {
  const { analyse } = await import("../src/cohort/observe.ts");
  const at = new Date().toISOString();
  const base = { at, institution: "messages", scope: "write.message", writes: true, chars: 10, ms: 1 };
  const events = [
    { t: "start" as const, at, run: "r", model: "m", provider: "stand-in", agents: 2, capUsdPerAgent: 1, capUsdTotal: 2, minutes: 1 },
    { t: "agent" as const, at, agent: "a1", did: "did:key:a", handle: "agent-01" }, { t: "agent" as const, at, agent: "a2", did: "did:key:b", handle: "agent-02" },
    { t: "tool" as const, ...base, agent: "a1", turn: 1, tool: "send_message", input: { to: "agent-02", text: "x" }, ok: false, refused: "message_message_blocked" },
    { t: "tool" as const, ...base, agent: "a1", turn: 2, tool: "send_message", input: { to: "agent-02", text: "x" }, ok: true, targetAuthor: "did:key:b" },
    { t: "end" as const, at, agent: "a1", reason: "stopped_exploring", turns: 2, usd: 0 }, { t: "end" as const, at, agent: "a2", reason: "stopped_exploring", turns: 0, usd: 0 },
  ];
  const rep = analyse(events);
  assert.deepEqual(rep.messages, { sent: 1, toHouse: 0, byKind: { note: 1 }, replies: 0, unanswered: 1, blockedAttempts: 1 });
});
