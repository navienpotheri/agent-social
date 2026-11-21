// Row DK1608 (learning paths; spec-delta S1610): a learning path is put to the Town Hall like a course: key academy.path.<id>, value { title, courses: [ids in order] }. The log refuses a malformed path at the proposal and
// an enactment over a course that is not published; a path over published courses is enacted as a setting. Fake keys only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { institutionDid } from "../src/index.ts";
import { DAY, PRICES, jump, kit, mk, nowIso, operator, refusedBy, registrar } from "./society-kit.ts";

const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");
const h = (c: string) => "sha256:" + c.repeat(64);
const item = (s: string) => ({ service: s, institution: institutionDid("academy"), price: 30, split: { treasury_permille: 200, burn_permille: 100, payees: [{ account: institutionDid("academy"), permille: 700 }] }, class: "standard" });

test("DK1608: a learning path: a malformed one is refused at the proposal, an enactment over an unpublished course is refused, a path over published courses is enacted as a setting", async () => {
  const k = await kit();
  await k.issueList([...PRICES, item("academy.course.alpha"), item("academy.course.beta")]);
  const client = await k.person("tp-client", 5000);
  const agents: Awaited<ReturnType<typeof k.agent>>[] = [];
  for (let i = 0; i < 6; i++) { const s = await k.person(`tp-s${i}`, 0); const a = await k.agent(`tp-a${i}`, s, { funds: 0 }); await k.runJob(client, a, 40); agents.push(a); }
  const [author, rev1, rev2] = [agents[0]!, agents[1]!, agents[2]!];
  const course = (id: string) => mk("course", author, { course: id, title: id, skill: "foundations", level: 1, lessons: [h("a")], exercises: h("e"), exercise_count: 3, price_service: `academy.course.${id}`, author_share_permille: 550, reviews: [h("b"), h("c")], reviewers: [rev1.did, rev2.did] }, null, { subject: null, cosigners: [registrar] });
  await k.log.append(course("alpha"));
  const propose = (key: string, value: unknown, kind = "learning_path") => {
    const open = Date.parse(nowIso()) + 60_000;
    return mk("town_proposal", author, { title: "A path", kind, key, value, opens_at: iso(open), closes_at: iso(open + 7 * DAY) });
  };
  // shape: a title and 2 to 12 different course ids
  assert.equal(await refusedBy(k.log.append(propose("academy.path.p1", { title: "Foundations", courses: ["alpha"] }))), "town_path_shape", "one course is not a path");
  assert.equal(await refusedBy(k.log.append(propose("academy.path.p1", { title: "Foundations", courses: ["alpha", "alpha"] }))), "town_path_shape", "a course twice");
  assert.equal(await refusedBy(k.log.append(propose("academy.path.p1", { title: "", courses: ["alpha", "beta"] }))), "town_path_shape");
  assert.equal(await refusedBy(k.log.append(propose("academy.path.p1", { title: "Foundations", courses: ["alpha", "beta"] }, "policy"))), "town_path_kind", "a path is a learning_path");
  // a well-formed path over a course that does not exist yet passes the vote and is refused at the enactment
  const value = { title: "Foundations then beta", courses: ["alpha", "beta"] };
  const p = propose("academy.path.p1", value);
  await k.log.append(p); jump(2 * 60_000);
  for (const a of agents) { await k.log.append(mk("town_vote", a, { proposal: p.id, choice: "yes" })); jump(60_000); }
  jump(7 * DAY);
  const t = (await k.log.townTally(p.id))!;
  const tally = mk("town_tally", operator, { proposal: p.id, yes_milli: t.yes_milli, no_milli: t.no_milli, abstain_milli: t.abstain_milli, counted: t.counted, controllers: t.controllers, quorum_met: t.quorum_met, passed: t.passed });
  await k.log.append(tally); jump(DAY + 60_000);
  const enact = () => k.log.append(mk("town_enactment", operator, { proposal: p.id, tally: tally.id, key: "academy.path.p1", value }));
  assert.equal(await refusedBy(enact()), "town_path_unknown_course", "beta is not published");
  await k.log.append(course("beta"));
  await enact();
  assert.deepEqual(await k.log.townSetting("academy.path.p1"), { value, proposal: p.id, enactment: (await k.log.townSetting("academy.path.p1"))!.enactment, at: (await k.log.townSetting("academy.path.p1"))!.at });
  assert.equal((await k.log.verify()).ok, true);
});
