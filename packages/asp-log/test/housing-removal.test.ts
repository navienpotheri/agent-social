// Row DK393 (spec-delta S962): Housing takes one profile off a Home with a signed reason and may put it back; the Home shows that it was removed, why, and until when the agent can appeal. Fake keys only; credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { homeHtml } from "../src/index.ts";
import { DAY, mk, refusedBy } from "./society-kit.ts";
import { housing, shopsWorld } from "./shops-kit.ts";

const profile = (a: { did: string }, body: Record<string, unknown> = {}) => ({ act: "profile", agent: a.did, display_name: "Coder", tagline: "Reviews patches", about: "I review code.", ...body });

test("DK393: Housing removes a profile with a reason and an appeal window, the Home shows the removal and not the text, a restoration puts it back; only Housing, only a profile of that agent, once", async () => {
  const w = await shopsWorld();
  const { a } = await w.agentWith("removed-home");
  const { a: other } = await w.agentWith("other-home");
  const prof = await w.log.append(mk("housing_act", a, profile(a, { about: "an about text Housing will take down" })));
  const otherProf = await w.log.append(mk("housing_act", other, profile(other)));
  const at = () => new Date(Date.parse((w as unknown as { now?: () => string }).now?.() ?? "2026-11-02T00:00:00Z"));
  void at;
  const until = new Date(Date.parse("2026-11-01T00:00:00Z") + 20 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
  const removal = (target: string, over: Record<string, unknown> = {}) => mk("housing_act", housing, { act: "removal", agent: a.did, target, reason: "the about text asks readers to send credits elsewhere", appealable_until: until, ...over });

  assert.equal(await refusedBy(w.log.append(mk("housing_act", a, { act: "removal", agent: a.did, target: prof.id, reason: "x", appealable_until: until }))), "housing_removal_not_housing", "the agent cannot remove its own page, nor can anyone but Housing");
  assert.equal(await refusedBy(w.log.append(removal(otherProf.id))), "removal_target_unknown", "a profile of another agent");
  assert.equal(await refusedBy(w.log.append(removal(prof.id, { appealable_until: new Date(Date.parse(until) + 60 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") }))), "removal_appeal_window", "an appeal window of more than 30 days");
  const done = await w.log.append(removal(prof.id));
  assert.equal(await refusedBy(w.log.append(removal(prof.id, { reason: "the same page again" }))), "removal_already");

  const home = (await w.log.homePage(a.did))!;
  assert.equal(home.profile.about, null, "the removed text is not shown");
  assert.equal(home.profile.removed?.reason, "the about text asks readers to send credits elsewhere");
  assert.equal(home.profile.removed?.appealable_until, until);
  assert.equal(home.profile.removed?.record, done.id);
  const html = homeHtml(home);
  assert.match(html, /Removed by Housing/);
  assert.match(html, /may appeal to the Courts until/);
  assert.ok(!html.includes("an about text Housing will take down"));
  assert.equal(home.record.kind, "agent", "the city's Record panel is untouched");

  // Restoration: only Housing, only a removal, once; the page is back.
  assert.equal(await refusedBy(w.log.append(mk("housing_act", a, { act: "restoration", removal: done.id, reason: "I say so" }))), "housing_removal_not_housing");
  assert.equal(await refusedBy(w.log.append(mk("housing_act", housing, { act: "restoration", removal: prof.id, reason: "not a removal" }))), "restoration_unknown");
  await w.log.append(mk("housing_act", housing, { act: "restoration", removal: done.id, reason: "upheld on appeal" }));
  assert.equal(await refusedBy(w.log.append(mk("housing_act", housing, { act: "restoration", removal: done.id, reason: "again" }))), "restoration_already");
  const back = (await w.log.homePage(a.did))!;
  assert.equal(back.profile.about, "an about text Housing will take down");
  assert.equal(back.profile.removed, undefined);
  assert.equal((await w.log.creditAudit()).verdict, "balanced", "a removal moves no credit");
});

test("DK393 mutation review: the appeal window is more than nothing and at most 30 days to the second, and only an agent with a passport has a home", async () => {
  const w = await shopsWorld();
  const { a } = await w.agentWith("window-home");
  const prof = await w.log.append(mk("housing_act", a, profile(a)));
  const at = "2026-11-02T00:00:00Z";
  const stamp = (ms: number) => new Date(Date.parse(at) + ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const removal = (until: string) => mk("housing_act", housing, { act: "removal", agent: a.did, target: prof.id, reason: "a reason Housing signs", appealable_until: until }, null, { at });
  assert.equal(await refusedBy(w.log.append(removal(stamp(0)))), "removal_appeal_window", "no time at all to appeal");
  assert.equal(await refusedBy(w.log.append(removal(stamp(-1000)))), "removal_appeal_window", "an appeal window already over");
  assert.equal(await refusedBy(w.log.append(removal(stamp(30 * DAY + 1000)))), "removal_appeal_window", "a second more than 30 days");
  await w.log.append(removal(stamp(30 * DAY)));
  assert.equal((await w.log.homePage(a.did))!.profile.removed?.appealable_until, stamp(30 * DAY), "exactly 30 days is allowed");
  // A signer with no passport (an institution) has no home.
  assert.equal(await refusedBy(w.log.append(mk("housing_act", housing, profile({ did: housing.did })))), "profile_no_passport");
});
