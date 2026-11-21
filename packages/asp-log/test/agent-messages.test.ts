/**
 * Direct messages between agents (register row DK1346; spec-delta S1595): a message is a signed, recorded act that carries the kind, the hash and the size of the text and no text; the log refuses a sender that is not an
 * agent, a message to oneself, an unknown recipient, a blocked sender and the daily limits; a reply must answer a message received; a block is signed by the agent or its sponsor and an unblock lifts it. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MESSAGES_PER_DAY, MESSAGES_PER_PAIR_PER_DAY } from "../src/index.ts";
import { jump, kit, mk, refusedBy, DAY, type Party } from "./society-kit.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function world(n = 3) {
  const k = await kit();
  const sponsor = await k.person("dm-sponsor");
  const agents: Party[] = [];
  for (let i = 0; i < n; i++) agents.push(await k.agent(`dm-agent-${i}`, i === 0 ? sponsor : await k.person(`dm-sponsor-${i}`)));
  const send = (from: Party, to: Party, text = "hello", over: Record<string, unknown> = {}) => mk("agent_message", from, { to: to.did, kind: "note", body_sha256: hash(text), bytes: Buffer.byteLength(text), ...over }, null, { subject: to.did });
  const block = (by: Party, blocked: Party, over: Record<string, unknown> = {}) => mk("message_block", by, { act: "block", blocked: blocked.did, ...over });
  return { k, sponsor, agents, send, block };
}

test("DK1346: a message is recorded without its text, counted for both agents, and a reply to it is accepted", async () => {
  const w = await world();
  const [a, b] = w.agents;
  const m = w.send(a, b, "can you review my plan?", { kind: "question" });
  await w.k.log.append(m);
  assert.equal(JSON.stringify((await w.k.log.get(m.id))?.record.body).includes("review my plan"), false, "the text is not in the log");
  assert.deepEqual([await w.k.log.messageCounts(a.did), await w.k.log.messageCounts(b.did)], [{ sent: 1, received: 0 }, { sent: 0, received: 1 }]);
  await w.k.log.append(w.send(b, a, "yes", { kind: "reply", reply_to: m.id }));
  assert.equal((await w.k.log.verify()).ok, true, "a replica replays the messages to the same counts");
});

test("DK1346: refused by name: a sender that is not an agent, itself, an unknown recipient, a reply to nothing received", async () => {
  const w = await world();
  const [a, b, c] = w.agents;
  const person = await w.k.person("dm-person");
  const asPerson = mk("agent_message", person, { to: a.did, kind: "note", body_sha256: hash("x"), bytes: 1 });
  assert.equal(await refusedBy(w.k.log.append(asPerson)), "message_sender_not_an_agent");
  assert.equal(await refusedBy(w.k.log.append(w.send(a, a))), "message_to_self");
  assert.equal(await refusedBy(w.k.log.append(mk("agent_message", a, { to: person.did, kind: "note", body_sha256: hash("x"), bytes: 1 }))), "message_unknown_recipient", "a person is not a recipient");
  assert.equal(await refusedBy(w.k.log.append(mk("agent_message", a, { to: "did:web:example.com:agents:nobody", kind: "note", body_sha256: hash("x"), bytes: 1 }))), "message_unknown_recipient");
  const m = w.send(a, b); await w.k.log.append(m);
  assert.equal(await refusedBy(w.k.log.append(w.send(c, a, "re", { kind: "reply", reply_to: m.id }))), "message_reply_unknown", "c did not receive that message");
  assert.equal(await refusedBy(w.k.log.append(w.send(a, b, "re", { kind: "reply", reply_to: m.id }))), "message_reply_unknown", "a sent it, it did not receive it");
});

test("DK1346: a blocked sender is refused, the agent's sponsor may block for it, a stranger may not, and an unblock lifts it", async () => {
  const w = await world();
  const [a, b] = w.agents;
  assert.equal(await refusedBy(w.k.log.append(w.block(a, b, { blocker: b.did }))), "block_wrong_issuer", "a is neither b nor b's sponsor");
  assert.equal(await refusedBy(w.k.log.append(w.block(b, b))), "block_self");
  await w.k.log.append(w.block(b, a));
  assert.equal(await refusedBy(w.k.log.append(w.send(a, b))), "message_blocked");
  await w.k.log.append(w.send(b, a, "you can still write to me"));
  assert.equal(await refusedBy(w.k.log.append(w.block(b, a, { act: "unblock", blocked: w.agents[2].did }))), "block_not_blocked");
  await w.k.log.append(w.block(b, a, { act: "unblock" }));
  await w.k.log.append(w.send(a, b, "thanks"));
  // the sponsor blocks for its agent
  const sponsorBlock = mk("message_block", w.sponsor, { act: "block", blocker: a.did, blocked: b.did });
  await w.k.log.append(sponsorBlock);
  assert.equal(await refusedBy(w.k.log.append(w.send(b, a))), "message_blocked", "the sponsor's block holds for its agent");
});

test("DK1346: ten a day to one recipient (a reply does not count) and sixty a day in all; a new day starts again", async () => {
  const w = await world(8);
  const [a, b, ...others] = w.agents;
  const first = w.send(b, a, "hi"); await w.k.log.append(first);
  for (let i = 0; i < MESSAGES_PER_PAIR_PER_DAY; i++) await w.k.log.append(w.send(a, b, `m${i}`));
  assert.equal(await refusedBy(w.k.log.append(w.send(a, b, "one more"))), "message_rate_pair");
  await w.k.log.append(w.send(a, b, "a reply is still allowed", { kind: "reply", reply_to: first.id }));
  let sent = MESSAGES_PER_PAIR_PER_DAY + 1;
  for (const o of others) for (let i = 0; i < MESSAGES_PER_PAIR_PER_DAY && sent < MESSAGES_PER_DAY; i++, sent++) await w.k.log.append(w.send(a, o, `n${sent}`));
  assert.equal(sent, MESSAGES_PER_DAY);
  assert.equal(await refusedBy(w.k.log.append(w.send(a, others[others.length - 1], "the sixty-first"))), "message_rate");
  jump(DAY);
  await w.k.log.append(w.send(a, b, "a new day"));
});
