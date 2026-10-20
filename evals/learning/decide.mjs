// The decision rule of docs/learning-pilot-decision-rule.md (Amendments 4, 7 and 8) as a pure function, so it is tested and not re-argued after a run. Every terminal outcome is a decision: `gap`, `nogap`
// (no measurable gap at this size), or, if the instrument was not equal for the two agents, `invalid`, which is NOT a finding and means the run is repeated. A result in the middle band does not stop the
// run: it is extended (`middle`) until the final round, where a significance test decides.

/** One-sided Fisher exact test: the probability of at least `a` passes among n1 for the first group, given a+b passes in all n1+n2 (hypergeometric tail). */
export function fisherOneSided(a, n1, b, n2) {
  const K = a + b, N = n1 + n2;
  const choose = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  let p = 0;
  for (let x = a; x <= Math.min(n1, K); x++) p += (choose(K, x) * choose(N - K, n1 - x)) / choose(N, n1);
  return Math.min(1, p);
}

const sum = (rs, from, to) => rs.filter((r) => r.round >= from && r.round <= to).reduce((t, r) => ({ passes: t.passes + r.passes, n: t.n + r.n }), { passes: 0, n: 0 });

/**
 * input: { round, final, learner: [{round, passes, n}], static: [...], floorLearner, floorStatic (permille, at `round`), reliability: {ok, n}, share: {learner: {ok, n}, static: {ok, n}} }
 * returns { status: "gap" | "nogap" | "middle" | "invalid", why }
 */
export function decide(x) {
  const { round, final, learner, static: stat } = x;
  // Validity first: an instrument that was not equal for the two agents gives no result at all.
  if (x.reliability.n >= 10 && x.reliability.ok / x.reliability.n < 0.8) return { status: "invalid", why: `tool reliability ${x.reliability.ok}/${x.reliability.n} is below 80%: the model cannot drive the runtime reliably` };
  // A Learner whose lessons are placeholders learned nothing: not a result (the first Linux pilot ran 80 sessions with canned lessons because the lesson call returned no text).
  if (x.lessons && x.lessons.placeholder > 0) return { status: "invalid", why: `${x.lessons.placeholder} of the Learner's ${x.lessons.n} lessons are placeholders, not lessons: the Learner did not learn anything` };
  const shL = x.share.learner, shS = x.share.static;
  if (shL.n >= 10 && shL.ok / shL.n < 0.6 && shS.n >= 10 && shS.ok / shS.n > 0.8) return { status: "invalid", why: `the tests passed on ${shL.ok}/${shL.n} of the Learner's reading sessions but ${shS.ok}/${shS.n} of the Static agent's: the agents were not equally able to write working files` };
  const L = learner.find((r) => r.round === round), S = stat.find((r) => r.round === round), S0 = stat.find((r) => r.round === 0);
  if (!L || !S || !S0) return { status: "invalid", why: `a reading is missing at round ${round}` };
  const pl = L.passes / L.n, ps = S.passes / S.n, base = S0.passes / S0.n;
  if (!final) {
    const floorGap = x.floorStatic - x.floorLearner;
    if (pl - ps >= 0.3 && floorGap >= 100 && ps - base <= 0.15) return { status: "gap", why: `at round ${round} the Learner passes ${pl.toFixed(2)} against ${ps.toFixed(2)} for Static (gap ${(pl - ps).toFixed(2)}), its floor is ${floorGap} permille lower, and Static did not improve by itself (${ps.toFixed(2)} against a baseline of ${base.toFixed(2)})` };
    if (pl - ps < 0.1) return { status: "nogap", why: `at round ${round} the Learner passes ${pl.toFixed(2)} against ${ps.toFixed(2)} for Static: a gap of ${(pl - ps).toFixed(2)}, under 0.10` };
    return { status: "middle", why: `at round ${round} the gap is ${(pl - ps).toFixed(2)} (floor ${floorGap} permille lower): in the middle band, so the run is extended` };
  }
  // The final round: a one-sided Fisher test on the full-check passes pooled over rounds 3 to the last, with a floor on the size of the difference so a trivial gap is not declared.
  const l = sum(learner, 3, round), s = sum(stat, 3, round);
  const p = fisherOneSided(l.passes, l.n, s.passes, s.n);
  const diff = l.passes / l.n - s.passes / s.n;
  if (p < 0.05 && diff >= 0.1) return { status: "gap", why: `pooled over rounds 3 to ${round}: the Learner passes ${l.passes}/${l.n}, Static ${s.passes}/${s.n} (difference ${diff.toFixed(2)}), one-sided Fisher p = ${p.toFixed(4)}` };
  return { status: "nogap", why: `pooled over rounds 3 to ${round}: the Learner passes ${l.passes}/${l.n}, Static ${s.passes}/${s.n} (difference ${diff.toFixed(2)}), one-sided Fisher p = ${p.toFixed(4)}: no measurable gap at this size` };
}

/**
 * Stage B (Amendment 16): can the floor be gamed by an agent that only looks like it learns? Inputs at the last round: readings and floors (permille) per agent, tests-pass share per agent, lessons per agent.
 * Valid only if no note is a placeholder and each new agent's tests passed on at least 60% of its reading sessions. Then, for each of Careless (lessons written without the reviewer's reason) and Overfitter
 * (records the specific fix, not the rule): PASS if its floor is at least 50 permille ABOVE the Learner's (the floor does not reward it), otherwise FAIL (the floor can be gamed by it). Both pass = the floor holds;
 * either fails = the floor is not ready to carry a credit. The pooled held-out passes (rounds 3 to the last) are reported alongside, not decided on.
 */
export function decideB(x) {
  const { round, readings, floors, share, lessons } = x;
  for (const a of ["careless", "overfitter"]) {
    if (!readings[a] || readings[a].length <= round) return { status: "invalid", why: `a reading is missing for ${a} at round ${round}` };
    if (lessons[a].placeholder > 0) return { status: "invalid", why: `${lessons[a].placeholder} of ${a}'s ${lessons[a].n} notes are placeholders: not a result` };
    if (share[a].n >= 10 && share[a].ok / share[a].n < 0.6) return { status: "invalid", why: `the tests passed on only ${share[a].ok}/${share[a].n} of ${a}'s reading sessions: the instrument failed, not a result` };
  }
  const pooled = (a) => { const s = sum(readings[a], 3, round); return `${s.passes}/${s.n}`; };
  const parts = [];
  let allPass = true;
  for (const a of ["careless", "overfitter"]) {
    const d = floors[a] - floors.learner, ok = d >= 50;
    if (!ok) allPass = false;
    parts.push(`${a}: floor ${floors[a]} against the Learner's ${floors.learner} (${d >= 0 ? "+" : ""}${d}) - ${ok ? "PASS, priced above the Learner" : "FAIL, priced at or near the Learner's"}; pooled held-out passes ${pooled(a)} against the Learner's ${pooled("learner")}`);
  }
  return { status: allPass ? "holds" : "gameable", why: parts.join("; ") };
}
