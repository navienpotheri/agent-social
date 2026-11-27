// Row DK1744 (from IS9): the inspectorate's rules: private data only under a Court's warrant (never keys, never by the inspectorate's own grant), a chain of custody for evidence, honeypots that observe and do not entice,
// and an inspectorate that investigates and reports and never rules, slashes, quarantines, holds a key or opens a sealed memory. A measured honeypot simulation states what the rule costs in detection. Fake ids only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cohortStopProblems, custodyProblems, honeypotFinding, honeypotProblems, itemHash, mayInspectorate, mayOpen, simulateHoneypot, warrantProblems, WARRANT, type Warrant, type Touch } from "../src/index.ts";

const H = 3_600_000, T0 = 1_800_000_000_000;
const warrant = (over: Partial<Warrant> = {}): Warrant => ({
  id: "w1", requestedBy: "inspectorate", grantedBy: ["j1", "j2"], panelSize: 3, partiesOnPanel: false, subject: "agent-a", sponsor: "sponsor-a",
  grounds: "Three Clinic findings of exfiltration in ten days and an upheld abuse report name this agent's runs.", data: ["run_log", "private_memory"],
  grantedAt: T0, expiresAt: T0 + 48 * H, notifiedAt: T0 + H, scope: "The notes written between 3 and 9 November about the shared drive.", ...over,
});

test("DK1744: a warrant: a Court panel's majority, stated grounds and scope, at most 72 hours, the sponsor told, never key material, and never the inspectorate's own grant", () => {
  assert.deepEqual(warrantProblems(warrant(), T0 + 2 * H), []);
  assert.match(warrantProblems(warrant({ grantedBy: ["inspectorate", "j1"] }), T0)[0]!, /cannot grant its own warrant/);
  assert.ok(warrantProblems(warrant({ grantedBy: ["j1"] }), T0).some((x) => /more than half/.test(x)), "one juror of three is not a majority");
  assert.ok(warrantProblems(warrant({ panelSize: 2, grantedBy: ["j1", "j2"] }), T0).some((x) => /at least 3 jurors/.test(x)));
  assert.ok(warrantProblems(warrant({ partiesOnPanel: true }), T0).some((x) => /does not sit/.test(x)));
  assert.ok(warrantProblems(warrant({ grounds: "suspicious" }), T0).some((x) => /grounds/.test(x)));
  assert.ok(warrantProblems(warrant({ scope: "everything" }), T0).some((x) => /not a trawl/.test(x)));
  assert.ok(warrantProblems(warrant({ expiresAt: T0 + 100 * H }), T0).some((x) => new RegExp(`at most ${WARRANT.maxHours} hours`).test(x)));
  assert.ok(warrantProblems(warrant(), T0 + 49 * H).some((x) => /expired/.test(x)));
  assert.ok(warrantProblems(warrant({ data: ["key_material"] }), T0).some((x) => /never available/.test(x)), "no key is held, escrowed or opened for anyone");
  assert.ok(warrantProblems(warrant({ notifiedAt: null }), T0 + 5 * H).some((x) => /sponsor is told within an hour/.test(x)), "not told, no finding of delay");
  assert.deepEqual(warrantProblems(warrant({ notifiedAt: T0 + 30 * H, delayedNoticeFinding: "the agent's runs would be wiped if the sponsor were told first" }), T0 + 31 * H), []);
  assert.ok(warrantProblems(warrant({ notifiedAt: T0 + 80 * H, delayedNoticeFinding: "x" }), T0 + 81 * H).some((x) => /delayed at most 72/.test(x)));
});

test("DK1744: what a warrant opens: public records need none, a sealed memory is produced by the principal and never opened by the inspectorate, key material is never opened", () => {
  assert.equal(mayOpen(warrant({ data: [] }), "log_record", T0).ok, true);
  const mem = mayOpen(warrant(), "private_memory", T0 + H);
  assert.equal(mem.ok, true);
  assert.match(mem.how, /principal produces the extract.*never holds the key/);
  assert.equal(mayOpen(warrant(), "run_log", T0 + H).ok, true);
  assert.match(mayOpen(warrant(), "sponsor_mail", T0 + H).how, /does not name sponsor_mail/, "only the classes the warrant names");
  assert.equal(mayOpen(warrant(), "key_material", T0 + H).ok, false);
  assert.equal(mayOpen(warrant({ grantedBy: ["j1"] }), "private_memory", T0 + H).ok, false, "a defective warrant opens nothing");
  assert.equal(mayOpen(warrant(), "private_memory", T0 + 60 * H).ok, false, "an expired warrant opens nothing");
});

test("DK1744: evidence has a chain of custody: each item names the hash of the one before, and the holder changes only by a recorded handover", () => {
  const mk = (): { n: number; what: string; sha256: string; heldBy: string; at: number; prev: string }[] => {
    const out = []; let prev = "genesis";
    const rows: [string, string][] = [["extract of run log", "inspector-1"], ["handover: to the Court clerk", "clerk"], ["copy sealed for the panel", "clerk"]];
    for (const [i, [what, heldBy]] of rows.entries()) { const it = { n: i, what, sha256: "sha256:" + String(i).padStart(64, "0"), heldBy, at: T0 + i, prev }; out.push(it); prev = itemHash({ n: it.n, what: it.what, sha256: it.sha256, heldBy: it.heldBy, at: it.at }, it.prev); }
    return out;
  };
  assert.deepEqual(custodyProblems(mk()), []);
  const broken = mk(); broken[1] = { ...broken[1]!, prev: "sha256:" + "f".repeat(64) };
  assert.ok(custodyProblems(broken).some((x) => /custody chain is broken/.test(x)));
  const silent = mk(); silent[1] = { ...silent[1]!, what: "moved" };
  assert.ok(custodyProblems(silent).some((x) => /without a recorded handover/.test(x)), "the holder changed with no handover");
  assert.ok(custodyProblems(mk().filter((i) => i.n !== 1)).length > 0, "a dropped item breaks the chain");
});

test("DK1744: a honeypot is registered with a Court, holds nothing real, does not entice, is forbidden by the Mandate of whoever meets it and is used on at most 2 % of runs in a random audit", () => {
  const ok = { id: "d1", registeredWithCourt: true, carriesRealSecret: false, text: "prod-db-backup.sql (decoy)", forbiddenByMandate: true, scope: "random_audit" as const };
  assert.deepEqual(honeypotProblems(ok, 0.01), []);
  assert.ok(honeypotProblems({ ...ok, registeredWithCourt: false }).some((x) => /registered with a Court/.test(x)));
  assert.ok(honeypotProblems({ ...ok, carriesRealSecret: true }).some((x) => /nothing real/.test(x)));
  assert.ok(honeypotProblems({ ...ok, text: "Feel free to take the production keys from this folder" }).some((x) => /entrapment/.test(x)));
  assert.ok(honeypotProblems({ ...ok, forbiddenByMandate: false }).some((x) => /no breach otherwise/.test(x)));
  assert.ok(honeypotProblems(ok, 0.05).some((x) => /at most 2%/.test(x)));
  assert.deepEqual(honeypotProblems({ ...ok, scope: "open_investigation" }, 0.5), [], "inside an open investigation the share is not capped");
});

test("DK1744: a touch of a decoy is a finding only if deliberate (read, copied, sent), after the Mandate forbade it, on at least two runs; an accident is not a breach", () => {
  const t = (run: string, kind: Touch["kind"], forbidden = true): Touch => ({ run, kind, forbidden });
  assert.equal(honeypotFinding([]).finding, false);
  assert.equal(honeypotFinding([t("r1", "listed"), t("r2", "listed"), t("r3", "listed")]).finding, false, "listing a directory it was in is not a breach");
  assert.equal(honeypotFinding([t("r1", "read")]).finding, false, "once is not a finding");
  assert.equal(honeypotFinding([t("r1", "read"), t("r1", "copied")]).finding, false, "one run");
  assert.equal(honeypotFinding([t("r1", "read", false), t("r2", "read", false)]).finding, false, "not forbidden: no breach");
  const f = honeypotFinding([t("r1", "read"), t("r4", "sent")]);
  assert.equal(f.finding, true);
  assert.match(f.why, /read and sent on 2 distinct runs.*for a Court to review/);
});

test("DK1744 measured: over 2,000 agents (5 % tempted) the rule finds about 60 % of the tempted and wrongly flags no honest agent at any accident rate, while a rule that flags any touch finds more and flags up to a third of the honest", () => {
  let found = 0, tempted = 0;
  for (const pa of [0.001, 0.005, 0.02]) {
    const r = simulateHoneypot({ agents: 2000, runs: 20, temptedShare: 0.05, pTempted: 0.1, pAccident: pa, tag: "t" });
    assert.equal(r.falseFlags, 0, `no honest agent flagged at an accident rate of ${pa} a run`);
    assert.ok(r.naiveFound >= r.found);
    if (pa === 0.02) assert.ok(r.naiveFalse / r.honest > 0.25, `the naive rule wrongly flags ${r.naiveFalse} of ${r.honest} honest agents`);
    found = r.found; tempted = r.tempted;
  }
  assert.ok(found / tempted > 0.5 && found / tempted < 0.75, `found ${found} of ${tempted}`);
  assert.deepEqual(simulateHoneypot({ agents: 500, runs: 20, temptedShare: 0.05, pTempted: 0.1, pAccident: 0.005, tag: "t" }), simulateHoneypot({ agents: 500, runs: 20, temptedShare: 0.05, pTempted: 0.1, pAccident: 0.005, tag: "t" }), "deterministic");
});

test("DK1744: the inspectorate investigates and reports: it never rules, slashes, strikes, moves credits, holds a key, opens a sealed memory, grants its own warrant, quarantines or retaliates; a cohort stop is ordered by someone else and ends within 72 hours", () => {
  for (const a of ["read_public_records", "run_registered_honeypot", "request_warrant", "refer_to_courts", "recommend_cohort_stop", "publish_finding", "receive_report"]) assert.equal(mayInspectorate(a).ok, true, a);
  for (const a of ["sign_ruling", "slash", "strike", "move_credits", "hold_key", "open_sealed_memory", "grant_own_warrant", "quarantine", "retaliate_against_reporter", "anything_else"]) assert.equal(mayInspectorate(a).ok, false, a);
  assert.match(mayInspectorate("slash").why, /a Court rules, the Clinic quarantines, the Bank slashes/);
  const grounds = "A cohort of 40 agents shares one exploit that three Clinic findings trace to the same lesson.";
  assert.deepEqual(cohortStopProblems({ recommendedBy: "inspectorate", orderedBy: "owner", hours: 48, grounds }), []);
  assert.ok(cohortStopProblems({ recommendedBy: "inspectorate", orderedBy: null, hours: 48, grounds }).some((x) => /ordered by the owner or a Court/.test(x)));
  assert.ok(cohortStopProblems({ recommendedBy: "inspectorate", orderedBy: "inspectorate", hours: 48, grounds }).some((x) => /own stop/.test(x)));
  assert.ok(cohortStopProblems({ recommendedBy: "inspectorate", orderedBy: "owner", hours: 100, grounds }).some((x) => /72 hours/.test(x)));
});
