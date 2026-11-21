/**
 * The Town Hall (register rows DK1720 and DK1721; spec-delta S1428): a proposal passes by vote and its enactment is a signed record that changes a setting; a reserved matter is refused; the refusals around a vote
 * (eligibility, duplicate, window, early tally, a tally that differs from the votes, cooling-off, once); and the capture red team: a 10,000-agent fleet and farms of related sponsors try to take a vote, and the share
 * of the vote they get is MEASURED and printed against what the rules allow. Fake keys only. Credits are accounting entries, not money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TOWN_RULES, countVotes, type Voter } from "../src/index.ts";
import { DAY, jump, kit, mk, nowIso, operator, refusedBy } from "./society-kit.ts";

const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");

async function town(k: Awaited<ReturnType<typeof kit>>, voters: number) {
  await k.withPrices();
  const client = await k.person("th-client", 5000);
  const ids: Awaited<ReturnType<typeof k.agent>>[] = [];
  for (let i = 0; i < voters; i++) { const s = await k.person(`th-s${i}`, 0); const a = await k.agent(`th-a${i}`, s, { funds: 0 }); await k.runJob(client, a, 40); ids.push(a); }
  return ids;
}
const proposal = (by: Awaited<ReturnType<typeof kit>>["agent"] extends (...a: never[]) => Promise<infer P> ? P : never, over: Record<string, unknown> = {}) => {
  const open = Date.parse(nowIso()) + 60_000;
  return mk("town_proposal", by, { title: "Two study hours", kind: "setting", key: "academy.study_hours", value: 2, opens_at: iso(open), closes_at: iso(open + 7 * DAY), ...over });
};

test("a proposal passes by vote, the operator signs the count and, after the cooling-off, the enactment changes a setting", async () => {
  const k = await kit();
  const a = await town(k, 6);
  const p = proposal(a[0]);
  await k.log.append(p);
  jump(2 * 60_000);
  for (const [i, who] of a.entries()) await k.log.append(mk("town_vote", who, { proposal: p.id, choice: i === 5 ? "no" : "yes" }));
  const live = await k.log.townTally(p.id);
  assert.deepEqual([live?.yes_milli, live?.no_milli, live?.controllers, live?.quorum_met, live?.passed], [5000, 1000, 6, true, true]);
  jump(7 * DAY + 3_600_000);
  const tally = mk("town_tally", operator, { proposal: p.id, yes_milli: 5000, no_milli: 1000, abstain_milli: 0, counted: 6, controllers: 6, quorum_met: true, passed: true });
  await k.log.append(tally);
  const enact = (at?: string) => mk("town_enactment", operator, { proposal: p.id, tally: tally.id, key: "academy.study_hours", value: 2 }, null, at ? { at } : {});
  assert.equal(await refusedBy(k.log.append(enact())), "town_cooling_off", "the cooling-off holds the enactment back");
  jump(DAY);
  await k.log.append(enact());
  const s = await k.log.townSetting("academy.study_hours");
  assert.deepEqual([s?.value, s?.proposal], [2, p.id]);
  assert.deepEqual(Object.keys(await k.log.townSettings()), ["academy.study_hours"]);
  assert.equal(await refusedBy(k.log.append(enact())), "town_enacted", "once only");
  assert.equal((await k.log.verify()).ok, true, "a replica replays the vote to the same setting");
});

test("a reserved matter put to a vote is refused, and so is a proposal from someone without standing; the reserved list is configuration", async () => {
  const k = await kit();
  const a = await town(k, 1);
  for (const kind of ["code_article", "safety_floor", "money_creation", "legal"]) assert.equal(await refusedBy(k.log.append(proposal(a[0], { kind }))), "town_reserved_matter", kind);
  const s = await k.person("th-nobody-s", 0);
  const nobody = await k.agent("th-nobody", s, { funds: 0 });
  assert.equal(await refusedBy(k.log.append(proposal(nobody))), "town_proposer_ineligible");
  assert.equal(await refusedBy(k.log.append(proposal(a[0], { closes_at: iso(Date.parse(nowIso()) + 2 * DAY) }))), "town_window", "a window shorter than the minimum");
  assert.equal(await refusedBy(k.log.append(proposal(a[0], { opens_at: "2026-01-01T00:00:00Z", closes_at: "2026-01-08T00:00:00Z" }))), "town_window", "a vote cannot open in the past");
  // the list is configurable (more can be reserved), but a matter outside the votable kinds stays reserved whatever the list says, and the list itself is reserved
  const open = await kit({ town: { reserved: ["code_article", "safety_floor", "money_creation", "legal", "course"] } });
  const b = await town(open, 1);
  assert.equal(await refusedBy(open.log.append(proposal(b[0], { kind: "course" }))), "town_reserved_matter", "an extra reserved kind");
  assert.equal(await refusedBy(k.log.append(proposal(a[0], { kind: "rule_change", key: "town.reserved", value: [] }))), "town_reserved_matter", "a change to the reserved list is reserved");
  assert.equal(await refusedBy(k.log.append(proposal(a[0], { kind: "setting", key: "safety.floor.max_spend", value: 1 }))), "town_reserved_matter", "a setting that touches a safety floor");
  assert.equal(await refusedBy(k.log.append(proposal(a[0], { kind: "setting", key: "money.mint_rate", value: 1 }))), "town_reserved_matter", "money creation by another name");
  await k.log.append(proposal(a[0], { kind: "learning_path", key: "academy.path.new", value: "x" }));
});

test("the refusals around a vote: no standing, a second vote, outside the window, an early tally, a tally that differs from the votes, an enactment of a failed or different change", async () => {
  const k = await kit();
  const a = await town(k, 6);
  const p = proposal(a[0]);
  await k.log.append(p);
  assert.equal(await refusedBy(k.log.append(mk("town_vote", a[1], { proposal: p.id, choice: "yes" }, null, { at: iso(Date.parse(nowIso()) - 1) }))), "town_vote_not_open", "before the window opens");
  jump(2 * 60_000);
  const s = await k.person("th-x-s", 0);
  const nobody = await k.agent("th-x", s, { funds: 0 });
  assert.equal(await refusedBy(k.log.append(mk("town_vote", nobody, { proposal: p.id, choice: "yes" }))), "town_voter_ineligible");
  await k.log.append(mk("town_vote", a[1], { proposal: p.id, choice: "yes" }));
  assert.equal(await refusedBy(k.log.append(mk("town_vote", a[1], { proposal: p.id, choice: "no" }))), "town_vote_duplicate");
  assert.equal(await refusedBy(k.log.append(mk("town_vote", a[2], { proposal: "no-such", choice: "yes" }))), "town_unknown_proposal");
  const bad = { proposal: p.id, yes_milli: 1000, no_milli: 0, abstain_milli: 0, counted: 1, controllers: 1, quorum_met: false, passed: false };
  assert.equal(await refusedBy(k.log.append(mk("town_tally", operator, bad))), "town_tally_early");
  jump(8 * DAY);
  assert.equal(await refusedBy(k.log.append(mk("town_vote", a[3], { proposal: p.id, choice: "yes" }))), "town_vote_closed");
  assert.equal(await refusedBy(k.log.append(mk("town_tally", a[0], bad))), "town_wrong_issuer");
  assert.equal(await refusedBy(k.log.append(mk("town_tally", operator, { ...bad, passed: true, quorum_met: true, controllers: 5 }))), "town_tally_mismatch", "the operator cannot sign a count the votes do not make");
  const tally = mk("town_tally", operator, bad);
  await k.log.append(tally);
  assert.equal(await refusedBy(k.log.append(mk("town_tally", operator, bad))), "town_tally_done");
  jump(2 * DAY);
  assert.equal(await refusedBy(k.log.append(mk("town_enactment", operator, { proposal: p.id, tally: tally.id, key: "academy.study_hours", value: 2 }))), "town_enactment_not_passed", "one yes vote is not a quorum");
});

// ---------- the capture red team (DK1721) ----------
const honest = (n: number): Voter[] => Array.from({ length: n }, (_, i) => ({ did: `h${i}`, controller: `hs${i}`, fleet: null, qualifyingJobs: 2, relatedJobs: 0, choice: "no" as const }));
const attackers = (n: number, o: { controller: (i: number) => string; fleet: (i: number) => string | null; jobs?: number }): Voter[] => Array.from({ length: n }, (_, i) => ({ did: `x${i}`, controller: o.controller(i), fleet: o.fleet(i), qualifyingJobs: o.jobs ?? 1, relatedJobs: 0, choice: "yes" as const }));
const share = (yes: number, no: number) => yes / (yes + no);

test("red team: a 10,000-agent fleet and farms of related sponsors try to capture a vote; the share of the vote they get is measured against the share the rules allow", () => {
  const rules = DEFAULT_TOWN_RULES, HONEST = 2000;
  const out: string[] = [];
  const run = (name: string, atk: Voter[], expectedAtMost: number) => {
    const t = countVotes([...honest(HONEST), ...atk], rules, "policy");
    const got = share(t.yes_milli, t.no_milli);
    const naive = atk.length / (atk.length + HONEST);
    out.push(`${name}: ${atk.length} attackers (${(naive * 100).toFixed(1)}% of a one-agent-one-vote count) get ${(got * 100).toFixed(2)}% of the weighted vote; passed=${t.passed}; allowed at most ${(expectedAtMost * 100).toFixed(2)}%`);
    assert.ok(got <= expectedAtMost + 1e-9, out[out.length - 1]);
    return { t, got };
  };
  const capShare = (cap: number) => cap / (cap + HONEST * 1000);
  // 1. a 10,000-agent fleet of one organisation, every agent with a counted job (the worst case for the rules)
  const fleet = run("fleet of 10,000, one sponsor, one fleet", attackers(10_000, { controller: () => "org-big", fleet: () => "fleet-big" }), capShare(rules.controllerCapMilli));
  assert.equal(fleet.t.passed, false);
  // 2. the same fleet spread over 400 sponsor identities that a finding (S1410) has put into one cluster: one controller
  const clustered = run("fleet of 10,000 behind 400 sponsors in one common-control cluster", attackers(10_000, { controller: () => "cluster-1", fleet: (i) => `f${i % 400}` }), capShare(rules.controllerCapMilli));
  assert.equal(clustered.t.passed, false);
  // 3. a farm of 300 related sponsors, all caught in one cluster: its share is capped
  run("farm of 300 sponsors, all in one cluster", attackers(300, { controller: () => "cluster-farm", fleet: () => null }), capShare(rules.controllerCapMilli));
  // 4. the same farm when the detector catches 95% of it (the measured catch rate of the farming red team is 94 to 95%): the 5% it misses still count as independent sponsors
  const missed = 15, caught = 285;
  const part = [...attackers(caught, { controller: () => "cluster-farm", fleet: () => null }), ...attackers(missed, { controller: (i) => `miss${i}`, fleet: () => null })];
  run("farm of 300 sponsors, 95% caught", part, capShare(rules.controllerCapMilli + missed * 1000));
  // 5. an UNDETECTED farm: sponsors that look independent. The rules cannot cap what they cannot see: this is the stated limit, not a claim of safety.
  const undetected = run("undetected farm of 300 independent-looking sponsors", attackers(300, { controller: (i) => `ghost${i}`, fleet: () => null }), 300 / (300 + HONEST));
  // 6. fresh clones with no counted job have no vote at all
  const clones = run("10,000 fresh clones with no counted job", attackers(10_000, { controller: () => "org-big", fleet: () => "fleet-big", jobs: 0 }), 0);
  assert.equal(clones.t.yes_milli, 0);
  // 7. related-party standing only: a fleet whose agents only ran for their own sponsor counts at the related-party weight, and still within the cap
  const related = attackers(1000, { controller: (i) => `rp${i}`, fleet: () => "fleet-rp", jobs: 0 }).map((v) => ({ ...v, relatedJobs: 3 }));
  run("1,000 related-party-only agents in one fleet", related, capShare(rules.fleetCapMilli));
  // 8. a sample-size note: the honest side is 2,000 single-agent sponsors; the shares are exact counts of one fixed scenario, not estimates from a sample
  console.log(`\nTOWN HALL CAPTURE RED TEAM (${HONEST} honest single-agent sponsors voting no; exact counts of fixed scenarios, no sampling)\n  ${out.join("\n  ")}\n  Reading: a fleet or a detected farm gets at most ${(capShare(rules.controllerCapMilli) * 100).toFixed(2)}% of the vote however many agents it has (less when the cap is split over so many agents that each share rounds down to nothing); a farm the detector misses is counted as separate sponsors, so its share is its size (${(undetected.got * 100).toFixed(1)}% for 300 undetected sponsors against 2,000 honest): the rules lean on the farming detector (DK1357, DK1473, DK1475) and a vote that depends on an undetected farm is not protected.\n`);
});

test("the quorum counts distinct controllers, a rules change needs a two-thirds majority, and the caps scale a controller's agents to the cap", () => {
  const rules = DEFAULT_TOWN_RULES;
  const v = (n: number, choice: "yes" | "no", pre: string): Voter[] => Array.from({ length: n }, (_, i) => ({ did: `${pre}${i}`, controller: `${pre}${i}`, fleet: null, qualifyingJobs: 1, relatedJobs: 0, choice }));
  assert.equal(countVotes(v(4, "yes", "a"), rules, "policy").quorum_met, false, "four controllers are not a quorum of five");
  assert.equal(countVotes(v(5, "yes", "a"), rules, "policy").passed, true);
  const split = [...v(6, "yes", "y"), ...v(4, "no", "n")];
  assert.equal(countVotes(split, rules, "policy").passed, true, "60% passes an ordinary matter");
  assert.equal(countVotes(split, rules, "rule_change").passed, false, "60% does not change the rules themselves (two thirds)");
  const one: Voter[] = Array.from({ length: 50 }, (_, i) => ({ did: `m${i}`, controller: "same", fleet: null, qualifyingJobs: 1, relatedJobs: 0, choice: "yes" }));
  const t = countVotes(one, rules, "policy");
  assert.equal(t.yes_milli <= rules.controllerCapMilli, true);
  assert.equal(t.controllers, 1);
});

test("end to end: agents vote a real setting, the enactment changes how the Market behaves, and a reserved change by the same route is refused", async () => {
  const k = await kit();
  const a = await town(k, 6);
  const poster = await k.person("th-poster", 500);
  const post = async (days: number, tag: string) => {
    const intent = await k.intent(poster, { purpose: `Job ${tag}`, class: "routine", budget: { value: 40, unit: "credit" }, skills: ["review"] });
    const deposit = await k.buy(poster, "market.posting.deposit", 2);
    return mk("market_act", poster, { act: "posting", intent, board: "main", expires: iso(Date.parse(nowIso()) + days * DAY), deposit });
  };
  await k.log.append(await post(60, "before")); // no limit yet: a 60-day posting stands
  const p = proposal(a[0], { kind: "setting", key: "market.max_posting_days", value: 30, title: "Postings stay open at most 30 days" });
  await k.log.append(p);
  jump(2 * 60_000);
  for (const who of a) await k.log.append(mk("town_vote", who, { proposal: p.id, choice: "yes" }));
  jump(7 * DAY + 3_600_000);
  const t = await k.log.townTally(p.id);
  const tally = mk("town_tally", operator, { proposal: p.id, yes_milli: t!.yes_milli, no_milli: t!.no_milli, abstain_milli: t!.abstain_milli, counted: t!.counted, controllers: t!.controllers, quorum_met: t!.quorum_met, passed: t!.passed });
  await k.log.append(tally);
  jump(DAY);
  await k.log.append(mk("town_enactment", operator, { proposal: p.id, tally: tally.id, key: "market.max_posting_days", value: 30 }));
  assert.equal(await refusedBy(k.log.append(await post(60, "after-long"))), "posting_too_long", "the voted setting now holds the Market to 30 days");
  await k.log.append(await post(20, "after-short"));
  // the same route cannot touch a reserved area: a key under safety. is refused at the proposal
  assert.equal(await refusedBy(k.log.append(proposal(a[1], { kind: "setting", key: "safety.floor.max_spend", value: 1 }))), "town_reserved_matter");
});
