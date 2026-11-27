// Row DK1743: elections for the few elected offices: candidacy rules, a committed then revealed approval ballot with the Town Hall's electorate caps, recall, what an office may never do, and a measured capture simulation
// that states where it fails (a farm of independent-looking controllers). Fake ids only. Credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFICES, candidacyProblems, captureRate, commitBallot, mayOfficeDo, recallMayStart, recallPasses, runElection, type Ballot, type ElectionCandidate } from "../src/index.ts";
import type { Voter } from "../src/town-hall.ts";

const voter = (id: string, controller = id, fleet: string | null = null, qualifyingJobs = 1, relatedJobs = 0): Voter => ({ did: id, controller, fleet, qualifyingJobs, relatedJobs } as Voter);
const ballot = (v: Voter, approvals: string[], salt = "s" + v.did): Ballot => ({ voter: v, commitment: commitBallot(approvals, salt, "e1"), reveal: { approvals, salt } });
const CANDS = ["alice", "bob", "carol", "dan"];

test("DK1743: what an office may do is a rule: it convenes and publishes; it never enacts, signs a tally, holds a key, mints or touches a reserved matter", () => {
  assert.equal(mayOfficeDo("steward", "put_on_agenda").ok, true);
  assert.equal(mayOfficeDo("auditor", "publish_finding").ok, true);
  assert.equal(mayOfficeDo("auditor", "put_on_agenda").ok, false, "an auditor does not run the agenda");
  for (const act of ["enact", "sign_tally", "hold_institution_key", "mint", "change_code", "change_safety_floor", "change_reserved_list", "decide_legal", "sign_ruling", "remove_citizen"]) {
    assert.equal(mayOfficeDo("steward", act).ok, false, act);
    assert.match(mayOfficeDo("steward", act).why, /reserved/);
  }
  assert.equal(mayOfficeDo("steward", "propose_money_creation").ok, false, "a reserved area by name");
  assert.deepEqual([OFFICES.steward.seats, OFFICES.auditor.seats, OFFICES.steward.termDays], [3, 1, 90]);
});

test("DK1743: candidacy needs an arm's-length record, a clean last 90 days, three endorsing controllers, a deposit and fewer than two terms in a row", () => {
  const ok: ElectionCandidate = { did: "alice", controller: "ca", countedJobs: 4, jobControllers: 3, slashedWithin90d: false, openClinicFinding: false, endorsers: ["x", "y", "z"], depositPaid: true, consecutiveTerms: 1 };
  assert.deepEqual(candidacyProblems(ok, "steward"), []);
  assert.equal(candidacyProblems({ ...ok, countedJobs: 2 }, "steward").length, 1);
  assert.equal(candidacyProblems({ ...ok, jobControllers: 1 }, "steward").length, 1, "the jobs came from one controller");
  assert.match(candidacyProblems({ ...ok, slashedWithin90d: true }, "steward")[0]!, /slash/);
  assert.match(candidacyProblems({ ...ok, openClinicFinding: true }, "steward")[0]!, /Clinic/);
  assert.match(candidacyProblems({ ...ok, endorsers: ["x", "y", "ca"] }, "steward")[0]!, /three controllers other than/, "one's own controller does not endorse");
  assert.match(candidacyProblems({ ...ok, depositPaid: false }, "steward")[0]!, /deposit/);
  assert.match(candidacyProblems({ ...ok, consecutiveTerms: 2 }, "steward")[0]!, /at most 2 terms/);
});

test("DK1743: the ballot is committed then revealed: a reveal that does not match, a vote never revealed and an approval beyond the seats are not counted", () => {
  const vs = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"].map((id) => voter(id));
  const ballots: Ballot[] = [
    ballot(vs[0]!, ["alice", "bob", "carol"]), ballot(vs[1]!, ["alice", "bob"]), ballot(vs[2]!, ["alice"]), ballot(vs[3]!, ["bob"]), ballot(vs[4]!, ["alice", "dan"]),
    { voter: vs[5]!, commitment: commitBallot(["dan"], "s", "e1"), reveal: { approvals: ["carol"], salt: "s" } },            // changed after committing
    { voter: vs[6]!, commitment: commitBallot(["dan"], "s", "e1") },                                                        // never revealed
    ballot(vs[7]!, ["alice", "bob", "carol", "dan"]),                                                                      // four approvals for three seats
  ];
  const r = runElection("e1", "steward", CANDS, ballots, "seed");
  assert.deepEqual([r.counted, r.mismatched, r.unrevealed, r.overApproved], [5, 1, 1, 1]);
  assert.deepEqual(r.approvals.map((a) => [a.candidate, a.milli]), [["alice", 4000], ["bob", 3000], ["carol", 1000], ["dan", 1000]].map((x) => x as [string, number]).sort((a, b) => b[1] - a[1] || (r.approvals.findIndex((q) => q.candidate === a[0]) - r.approvals.findIndex((q) => q.candidate === b[0]))));
  assert.deepEqual(r.elected, ["alice", "bob", r.approvals[2]!.candidate], "three seats: the most approved, the third place between carol and dan by the published seed");
  assert.deepEqual(runElection("e1", "steward", CANDS, ballots, "seed"), r, "the same ballots and seed give the same result");
});

test("DK1743: the Town Hall's caps apply: a fleet of clones counts as one controller's cap, a count needs five controllers, and a result with fewer is void", () => {
  const clones = Array.from({ length: 50 }, (_, i) => ballot(voter(`c${i}`, "fleet-controller", "fleet-1"), ["dan"]));
  const honest = Array.from({ length: 6 }, (_, i) => ballot(voter(`h${i}`), i % 2 ? ["alice", "bob"] : ["alice", "carol"]));
  const r = runElection("e1", "steward", CANDS, [...clones, ...honest], "seed");
  assert.equal(r.approvals.find((a) => a.candidate === "dan")!.milli, 3000, "50 clones are capped at one controller's 3,000 thousandths");
  // a sponsor with many agents and no fleet is held by the controller cap alone (the fleet cap cannot hide a missing controller cap)
  const sponsor = Array.from({ length: 50 }, (_, i) => ballot(voter(`s${i}`, "one-sponsor", null), ["dan"]));
  assert.equal(runElection("e1", "steward", CANDS, [...sponsor, ...honest], "seed").approvals.find((x) => x.candidate === "dan")!.milli, 3000, "50 agents of one sponsor with no fleet: the controller cap alone");
  const huge = Array.from({ length: 5000 }, (_, i) => ballot(voter(`k${i}`, "fleet-controller", "fleet-1"), ["dan"]));
  assert.ok(runElection("e1", "steward", CANDS, [...huge, ...honest], "seed").approvals.find((a) => a.candidate === "dan")!.milli <= 3000, "5,000 clones are capped too (a cap spread over very many agents rounds down, which is conservative)");
  assert.equal(r.void, false);
  assert.equal(r.controllers, 7);
  const few = runElection("e1", "steward", CANDS, [...clones, ...honest.slice(0, 3)], "seed");
  assert.equal(few.void, true);
  assert.match(few.reason!, /fewer than the 5/);
  assert.deepEqual(few.elected, []);
});

test("DK1743: a recall needs a petition of 10 % of the electorate's controllers (at least five) after a grace period, and removes only with a quorum and a weighted majority", () => {
  assert.equal(recallMayStart({ petitionControllers: 9, electionControllers: 100, daysSinceElection: 3 }).ok, false);
  assert.match(recallMayStart({ petitionControllers: 9, electionControllers: 100, daysSinceElection: 3 }).why, /waits 7 days/);
  assert.match(recallMayStart({ petitionControllers: 9, electionControllers: 100, daysSinceElection: 30 }).why, /10 are needed/);
  assert.equal(recallMayStart({ petitionControllers: 10, electionControllers: 100, daysSinceElection: 30 }).ok, true);
  assert.equal(recallMayStart({ petitionControllers: 4, electionControllers: 20, daysSinceElection: 30 }).ok, false, "never fewer than five");
  assert.equal(recallPasses(6000, 5000, 11), true);
  assert.equal(recallPasses(5000, 5000, 11), false, "a tie keeps the officer");
  assert.equal(recallPasses(9000, 1000, 4), false, "no quorum");
});

test("DK1743 measured, and its limit: over 30 elections of 300 honest voters, a fleet of 5,000 clones never wins a steward seat, a farm of 120 independent-looking controllers never does, a farm of 140 usually does and a farm of 160 or more always does", () => {
  const at = (clones: number, farm: number) => captureRate({ clones, farm, trials: 30, tag: "t" });
  assert.equal(at(0, 0).wins, 0);
  assert.equal(at(5000, 0).wins, 0, "the cap holds a fleet to one controller's weight");
  assert.equal(at(5000, 10).wins, 0);
    assert.equal(at(0, 120).wins, 0);
  const mid = at(0, 140), big = at(0, 160);
  assert.ok(mid.wins >= 15 && mid.wins < 30, `${mid.wins} of 30 at a farm of 140`);
  assert.equal(big.wins, 30, "an undetected farm gets its size: from about half the honest electorate (160 against 300) it wins every time");
  assert.equal(at(0, 240).wins, 30);
  assert.ok(at(0, 30).farmShareMilli < at(0, 60).farmShareMilli && at(0, 60).farmShareMilli < mid.farmShareMilli && mid.farmShareMilli < big.farmShareMilli, "the farm's share of the weighted approvals grows with its size");
  assert.deepEqual(at(0, 140), mid, "deterministic");
});
