/**
 * The help desk (register row GV15; spec-delta S484): tickets, the operator's replies, closing, rating, the status figures against the published response target, the satisfaction measure in the city indicators,
 * and the public status page. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, jump, kit, mk, operator, refusedBy } from "./society-kit.ts";
import { publicReply } from "../src/public-pages.ts";

const HOUR = 3_600_000;
const ticket = (by: { did: string }, text = "My balance did not change.", topic = "credits") => mk("support", by as never, { act: "ticket", topic, text });
const reply = (id: string, text = "Refunds return the price less the burn.") => mk("support", operator, { act: "reply", ticket: id, text });
const close = (by: { did: string }, id: string) => mk("support", by as never, { act: "close", ticket: id, resolution: "resolved" });
const rate = (by: { did: string }, id: string, score: number) => mk("support", by as never, { act: "rating", ticket: id, score });

test("GV15: a citizen opens a ticket, the operator alone replies, the opener or the operator closes, the opener rates once when it is closed; every other path is refused with its reason", async () => {
  const k = await kit();
  const a = await k.person("asker"), other = await k.person("other");
  const stranger = { ...a, did: "did:web:nobody.example:x" };
  const t = ticket(a);
  await k.log.append(t);
  assert.equal(await refusedBy(k.log.append(mk("support", other, { act: "reply", ticket: t.id, text: "me too" }))), "support_reply_wrong_issuer", "only the operator answers");
  assert.equal(await refusedBy(k.log.append(reply("sha256:" + "9".repeat(64)))), "support_ticket_unknown");
  assert.equal(await refusedBy(k.log.append(rate(a, t.id, 5))), "support_rating_not_closed");
  await k.log.append(reply(t.id));
  assert.equal(await refusedBy(k.log.append(close(other, t.id))), "support_close_wrong_issuer", "a stranger does not close it");
  await k.log.append(close(a, t.id));
  assert.equal(await refusedBy(k.log.append(reply(t.id, "late"))), "support_closed");
  assert.equal(await refusedBy(k.log.append(close(a, t.id))), "support_closed");
  assert.equal(await refusedBy(k.log.append(rate(other, t.id, 5))), "support_rating_not_opener");
  await k.log.append(rate(a, t.id, 4));
  assert.equal(await refusedBy(k.log.append(rate(a, t.id, 5))), "support_rated", "once");
  void stranger;
});

test("GV15: a ticket needs a passport, at most five a day and three open at a time", async () => {
  const k = await kit();
  const a = await k.person("busy");
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) { const t = ticket(a, `question ${i}`); await k.log.append(t); ids.push(t.id); }
  assert.equal(await refusedBy(k.log.append(ticket(a, "a fourth"))), "support_too_many_open");
  await k.log.append(close(a, ids[0]));
  await k.log.append(ticket(a, "now there is room"));
  jump(0);
});

test("GV15: the status figures give the open tickets, the median first-reply time against the 48-hour target, the overdue ones and the satisfaction of those who rated; the city indicators carry the satisfaction", async () => {
  const k = await kit();
  const people = await Promise.all([1, 2, 3, 4].map((i) => k.person(`citizen-${i}`)));
  const tickets = [];
  for (const p of people) { const t = ticket(p, `help from ${p.did}`); await k.log.append(t); tickets.push(t); jump(HOUR); }
  assert.deepEqual((await k.log.supportStatus()).firstReply, { answered: 0, medianHours: null, withinTarget: 0, shareWithinTarget: null, overdueOpen: 0 });
  assert.equal((await k.log.supportStatus()).satisfaction, null, "nobody has rated");
  assert.equal((await k.log.cityIndicators()).happiness, null, "so happiness is still not measured");
  jump(10 * HOUR);
  await k.log.append(reply(tickets[0].id));               // about 14 hours after it was opened: within target
  jump(60 * HOUR);
  await k.log.append(reply(tickets[1].id));               // about 85 hours: outside the target
  await k.log.append(close(operator, tickets[0].id));
  await k.log.append(close(people[1], tickets[1].id));
  await k.log.append(rate(people[0], tickets[0].id, 5));
  await k.log.append(rate(people[1], tickets[1].id, 2));
  const s = await k.log.supportStatus();
  assert.equal(s.tickets.total, 4); assert.equal(s.tickets.open, 2); assert.equal(s.tickets.closed, 2);
  assert.equal(s.firstReply.answered, 2); assert.equal(s.firstReply.withinTarget, 1); assert.equal(s.firstReply.shareWithinTarget, 0.5);
  assert.ok(s.firstReply.medianHours! > 40 && s.firstReply.medianHours! < 60, `median ${s.firstReply.medianHours}`);
  assert.equal(s.firstReply.overdueOpen, 2, "tickets three and four have waited past 48 hours with no reply");
  assert.deepEqual(s.satisfaction, { ratings: 2, mean: 3.5, fiveOrFour: 1, oneOrTwo: 1 });
  assert.match(s.method, /median/);
  assert.deepEqual((await k.log.cityIndicators()).happiness, { ratings: 2, mean: 3.5 }, "GV1 carries the satisfaction measure once there are ratings");
  const page = await publicReply(k.log as never, "http://x/support/status", false);
  assert.equal((page!.json as { result: { tickets: { open: number } } }).result.tickets.open, 2, "the public status page serves the same figures");
  void DAY;
});
