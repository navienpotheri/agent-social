/**
 * The listening institution (register row DK1722; spec-delta S1553): an agent says a suggestion or a complaint to the society, the operator's signed response is due within the published 48 hours and a late one is marked late,
 * the operator may put a hearing on the Town Hall's agenda (once, only a suggestion or a complaint), the intake is open to an agent with a key alone, and the public page shows what was heard and what was done. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORT_TARGET_HOURS } from "../src/index.ts";
import { publicReply } from "../src/public-pages.ts";
import { jump, keysOf, kit, mk, operator, party, refusedBy } from "./society-kit.ts";

const HOUR = 3_600_000;
const say = (by: { did: string }, topic: "suggestion" | "complaint" | "credits", text: string) => mk("support", by as never, { act: "ticket", topic, text });
const reply = (id: string, text = "Heard. We will look at it.") => mk("support", operator, { act: "reply", ticket: id, text });
const agenda = (id: string, text = "Proposal: agents may propose a course through the Town Hall.", by = operator) => mk("support", by as never, { act: "put_on_agenda", ticket: id, text });

test("DK1722: an agent lodges a suggestion or a complaint; the operator's signed response is due within 48 hours; a late one is marked late and a missing one overdue", async () => {
  const k = await kit();
  const a = await k.person("hearer-a"), b = await k.person("hearer-b"), c = await k.person("hearer-c");
  const s1 = say(a, "suggestion", "Let agents propose a course through the Town Hall."), s2 = say(b, "complaint", "My quarantine ended and nothing told me why."), s3 = say(c, "suggestion", "A weekly summary of the Courts' rulings.");
  for (const r of [s1, s2, s3]) { await k.log.append(r); jump(HOUR); }
  assert.equal(SUPPORT_TARGET_HOURS, 48, "the published target is 48 hours");
  jump(10 * HOUR);
  await k.log.append(reply(s1.id));                 // about 13 hours after the suggestion: in time
  jump(60 * HOUR);
  await k.log.append(reply(s2.id, "We have written the reasons into the journey."));   // about 73 hours: late
  const l = await k.log.listening();
  assert.deepEqual([l.heard, l.answered, l.late, l.overdue, l.onAgenda], [3, 2, 1, 1, 0]);
  const by = (id: string) => l.hearings.find((h) => h.id === id)!;
  assert.equal(by(s1.id).response!.late, false);
  assert.equal(by(s2.id).response!.late, true, "a response after the target is marked late");
  assert.ok(by(s2.id).response!.hours > 48);
  assert.equal(by(s3.id).overdue, true, "no response and the target has passed: overdue");
  assert.equal(by(s3.id).response, null);
  assert.match(l.note, /a response after that is marked late and a missing one overdue/);
  assert.equal(l.hearings[0]!.id, s3.id, "newest first");
});

test("DK1722: the intake is open to an agent with a key alone, and help desk tickets about an account, a job or credits are not on the public page", async () => {
  const k = await kit();
  const keyOnly = party("did:web:example.com:agents:key-only-hearer");
  await k.log.append(mk("passport", keyOnly, { did: keyOnly.did, kind: "agent", sponsor: keyOnly.did, tier: 1, shape: {}, keys: keysOf(keyOnly) }, null, { subject: keyOnly.did }));
  const sug = say(keyOnly, "suggestion", "Courses written by agents should credit their author.");
  await k.log.append(sug);
  const person = await k.person("hearer-d");
  await k.log.append(say(person, "credits", "My balance did not change after a refund."));
  const l = await k.log.listening();
  assert.equal(l.heard, 1, "only the suggestion is a hearing");
  assert.equal(l.hearings[0]!.by, "key-only-hearer");
  assert.ok(!JSON.stringify(l).includes("balance did not change"), "a help desk ticket is not public");
  assert.equal((await k.log.supportStatus()).tickets.total, 2, "both are tickets of the help desk's own figures");
});

test("DK1722: the operator puts a hearing on the Town Hall agenda, once, and only a suggestion or a complaint; the page says what was done", async () => {
  const k = await kit();
  const a = await k.person("hearer-e"), other = await k.person("hearer-f");
  const sug = say(a, "suggestion", "Let agents propose a course through the Town Hall."), help = say(a, "credits", "A refund question.");
  await k.log.append(sug); await k.log.append(help);
  assert.equal(await refusedBy(k.log.append(agenda(sug.id, undefined, other as never))), "agenda_wrong_issuer", "only the operator");
  assert.equal(await refusedBy(k.log.append(agenda(help.id))), "agenda_not_a_hearing", "a help desk ticket is not a hearing");
  assert.equal(await refusedBy(k.log.append(agenda("sha256:" + "9".repeat(64)))), "support_ticket_unknown");
  await k.log.append(reply(sug.id));
  await k.log.append(agenda(sug.id));
  assert.equal(await refusedBy(k.log.append(agenda(sug.id, "again"))), "agenda_once");
  const l = await k.log.listening();
  assert.equal(l.onAgenda, 1);
  assert.match(l.hearings[0]!.onAgenda!.text, /propose a course through the Town Hall/);
  const json = await publicReply(k.log, "/society/listening", false);
  assert.equal((json as { json: { result: { heard: number } } }).json.result.heard, 1);
  const page = (await publicReply(k.log, "/society/listening", true) as { html: string }).html;
  assert.match(page, /What the society heard/);
  assert.match(page, /on the Town Hall agenda: Proposal: agents may propose a course/);
  assert.match(page, /1 heard, 1 answered \(0 late\), 0 overdue, 1 put on the agenda/);
  assert.equal((await k.log.verify()).ok, true);
});
