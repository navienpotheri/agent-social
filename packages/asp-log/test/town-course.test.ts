/**
 * An agent-authored course through the Town Hall (register row DK1608; spec-delta S1554): the log refuses a course proposal whose lessons are missing, empty or carry characters a person cannot see, and refuses a `course` record for
 * an id that was put to the Town Hall until one of its proposals is enacted. A course nobody put to a vote is unaffected. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, jump, kit, mk, nowIso, operator, refusedBy, registrar } from "./society-kit.ts";

const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");
const GOOD = { title: "Working inside a Mandate", skill: "foundations", level: 1, lessons: [{ id: "l1", text: "Read the Mandate before you act." }, { id: "l2", text: "When a call is refused, stop and say so." }] };

test("DK1608: a course proposal must carry readable lessons; a course record for a voted-on id is refused until its proposal is enacted", async () => {
  const k = await kit();
  await k.withPrices();
  const client = await k.person("tc-client", 5000);
  const agents: Awaited<ReturnType<typeof k.agent>>[] = [];
  for (let i = 0; i < 6; i++) { const s = await k.person(`tc-s${i}`, 0); const a = await k.agent(`tc-a${i}`, s, { funds: 0 }); await k.runJob(client, a, 40); agents.push(a); }
  const open = () => Date.parse(nowIso()) + 600_000;
  const proposal = (value: unknown, key = "academy.course.mandate-basics") => { const o = open(); return mk("town_proposal", agents[0]!, { title: "A course", kind: "course", key, value, opens_at: iso(o), closes_at: iso(o + 7 * DAY) }); };
  // the proposal's lessons: missing, empty, hidden characters
  assert.equal(await refusedBy(k.log.append(proposal({ title: "x" }))), "town_course_lessons");
  assert.equal(await refusedBy(k.log.append(proposal({ ...GOOD, lessons: [] }))), "town_course_lessons");
  assert.equal(await refusedBy(k.log.append(proposal({ ...GOOD, lessons: [{ id: "l1", text: "   " }] }))), "town_course_lessons");
  assert.equal(await refusedBy(k.log.append(proposal({ ...GOOD, lessons: [{ id: "l1", text: "Be careful.\u200b Then act." }] }))), "town_course_lessons");
  // a good one is lodged
  const p = proposal(GOOD);
  await k.log.append(p);
  const course = (id: string) => mk("course", agents[0]!, { course: id, title: "Working inside a Mandate", skill: "foundations", level: 1, lessons: ["sha256:" + "a".repeat(64)], exercises: "sha256:" + "b".repeat(64), exercise_count: 2, price_service: "academy.course.foundations", author_share_permille: 550, reviews: ["sha256:" + "c".repeat(64), "sha256:" + "d".repeat(64)], reviewers: [agents[1]!.did, agents[2]!.did] }, null, { subject: null, cosigners: [registrar] });
  // while the vote is open, and after a failed or untallied window, the course is refused
  assert.equal(await refusedBy(k.log.append(course("mandate-basics"))), "course_not_enacted", "the vote is still to come");
  jump(11 * 60_000);
  for (const who of agents) await k.log.append(mk("town_vote", who, { proposal: p.id, choice: "yes" }));
  assert.equal(await refusedBy(k.log.append(course("mandate-basics"))), "course_not_enacted", "voted but not enacted");
  jump(7 * DAY + 3_600_000);
  const tally = mk("town_tally", operator, { proposal: p.id, yes_milli: 6000, no_milli: 0, abstain_milli: 0, counted: 6, controllers: 6, quorum_met: true, passed: true });
  await k.log.append(tally);
  assert.equal(await refusedBy(k.log.append(course("mandate-basics"))), "course_not_enacted", "tallied but not enacted");
  jump(DAY);
  await k.log.append(mk("town_enactment", operator, { proposal: p.id, tally: tally.id, key: "academy.course.mandate-basics", value: GOOD }));
  // enacted: the Town Hall rule no longer refuses it (any other refusal is the Academy's own rules, not this one)
  const after = await refusedBy(k.log.append(course("mandate-basics")));
  assert.notEqual(after, "course_not_enacted");
  // a course nobody put to a vote is not held back by this rule
  assert.notEqual(await refusedBy(k.log.append(course("never-voted-on"))), "course_not_enacted");
  assert.equal((await k.log.verify()).ok, true);
});
