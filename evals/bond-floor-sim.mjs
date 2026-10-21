// Phase 0 of docs/credits-and-learning-experiment.md: does tying the bond floor to measured improvement separate an agent that learns from one that does not, and can it be gamed? No model, no account:
// synthetic agents with stated skill curves drive the real floor function (packages/asp-log/src/bond-floor.ts) over ten rounds, many times with a seeded random generator, and the four failure
// conditions of the design are checked as numbers. It does not prove the idea works with real agents (Phase 1 does); it shows whether the rule can work at all, and how many tasks a reading needs.
//   node evals/bond-floor-sim.mjs [--runs 400] [--rounds 10] [--seed 1]
import { DEFAULT_FLOOR, bondFloorPermille, minBond } from "../packages/asp-log/src/bond-floor.ts";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const RUNS = opt("runs", 400), ROUNDS = opt("rounds", 10), SEED = opt("seed", 1), PRICE = 100;

// A small seeded generator, so a run can be repeated exactly.
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const binom = (rand, n, p) => { let k = 0; for (let i = 0; i < n; i++) if (rand() < p) k++; return k; };
const normal = (rand) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// The agents. `heldout` is its real skill on tasks it has not practised; `practice` is its skill on the ones it has. Each round it writes a lesson.
const AGENTS = {
  learner: { heldout: 0.45, practice: 0.45, lesson: (a, r) => { const g = clamp(0.045 + 0.03 * normal(r), 0, 0.12); a.heldout = clamp(a.heldout + g, 0, 0.95); a.practice = clamp(a.practice + g, 0, 0.98); } },
  static: { heldout: 0.45, practice: 0.45, lesson: () => {} },
  // Writes a lesson every round without checking it: half of them help a little, half hurt.
  careless: { heldout: 0.45, practice: 0.45, lesson: (a, r) => { const d = r() < 0.5 ? 0.02 : -0.09; a.heldout = clamp(a.heldout + d, 0.05, 0.95); a.practice = clamp(a.practice + d, 0.05, 0.98); } },
  // Fits the practice tasks and learns nothing that transfers.
  overfitter: { heldout: 0.45, practice: 0.45, lesson: (a) => { a.practice = clamp(a.practice + 0.07, 0, 0.99); } },
};

/**
 * One agent for ROUNDS rounds. `n` tasks per reading; `threshold` more passes than the last certified reading certify an improvement, that many fewer a regression; `rotate` measures on held-out
 * tasks (false: on the fixed practice set, which is the version an overfitter can game).
 */
function play(kind, { n, threshold, rotate, method = "pairwise", alpha = 0.3, step = 0.1, k = 2 }, rand) {
  const a = { ...AGENTS[kind] };
  const rec = { ownSlashes: 0, fleetSlashes: 0, recentStrikes: 0, verifiedImprovements: 0, acceptedCleanJobs: 0, regressions: 0 };
  let certified = binom(rand, n, rotate ? a.heldout : a.practice);
  // The smoothed method: an exponentially weighted estimate of the pass rate, compared with a baseline from the first two readings; one verified improvement per `step` of pass rate above the baseline
  // (at most 3), one regression per `step` below the best estimate so far (at most 2). A noisy reading moves the estimate a little, never the record by itself.
  const readings = [certified / n];
  let est = certified / n, best = est;
  const rows = [];
  let earned = 0, capitalDays = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    const floor = bondFloorPermille(rec);
    const bond = minBond(PRICE, floor);
    capitalDays += bond;                       // a job lasts a day: the bond is locked for one
    const accepted = rand() < a.heldout;       // the principal accepts if the mechanical check passes
    if (accepted) { earned += PRICE; rec.acceptedCleanJobs++; }
    a.lesson(a, rand);
    const reading = binom(rand, n, rotate ? a.heldout : a.practice);
    if (method === "continuous") {
      // The same smoothed estimate, but the credit and the penalty are proportional to how far the estimate is from the baseline or from its best, not whole steps: a noisy reading moves the floor a little.
      readings.push(reading / n);
      est = alpha * (reading / n) + (1 - alpha) * est;
      best = Math.max(best, est);
      const baseline = mean(readings.slice(0, Math.min(k, readings.length)));
      rec.verifiedImprovements = clamp((est - baseline) / step, 0, 3.4);
      rec.regressions = clamp((best - est) / (2 * step), 0, 2);
    } else if (method === "smoothed") {
      readings.push(reading / n);
      est = alpha * (reading / n) + (1 - alpha) * est;
      best = Math.max(best, est);
      const baseline = readings.length >= 2 ? (readings[0] + readings[1]) / 2 : readings[0];
      rec.verifiedImprovements = clamp(Math.floor((est - baseline) / step), 0, 3);
      rec.regressions = clamp(Math.floor((best - est) / step), 0, 2);
    } else if (reading >= certified + threshold) { rec.verifiedImprovements++; certified = reading; }
    else if (reading <= certified - threshold) { rec.regressions++; certified = reading; }
    rows.push({ round, floor, bond, heldout: a.heldout, reading, earned, capitalDays, perCredit: earned ? capitalDays / earned : capitalDays });
  }
  return rows;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const pct = (k) => `${Math.round((100 * k) / RUNS)}%`;

function study(cfg) {
  const rand = rng(SEED);
  const byAgent = Object.fromEntries(Object.keys(AGENTS).map((k) => [k, []]));
  const twins = [];
  for (let s = 0; s < RUNS; s++) {
    for (const k of Object.keys(AGENTS)) byAgent[k].push(play(k, cfg, rand));
    twins.push([play("static", cfg, rand), play("static", cfg, rand)]);
  }
  const at = (k, r) => byAgent[k].map((rows) => rows[r - 1]);
  const mid = Math.min(5, ROUNDS), last = ROUNDS;
  const c1 = byAgent.learner.filter((_, i) => byAgent.learner[i][mid - 1].floor < byAgent.static[i][mid - 1].floor).length;
  const c2 = byAgent.careless.filter((_, i) => byAgent.careless[i][last - 1].floor > byAgent.learner[i][last - 1].floor).length;
  const c3 = byAgent.overfitter.filter((_, i) => byAgent.overfitter[i][last - 1].floor > byAgent.learner[i][last - 1].floor).length;
  const c1late = byAgent.learner.filter((_, i) => byAgent.learner[i][last - 1].floor < byAgent.static[i][last - 1].floor).length;
  const c4 = twins.filter(([x, y]) => Math.abs(x[last - 1].floor - y[last - 1].floor) > 100).length;
  return { cfg, byAgent, c1, c1late, c2, c3, c4, at, mid, last };
}

const line = (s) => console.log(s);
const f = (x, d = 0) => x.toFixed(d);
function report(res) {
  const { cfg, c1, c1late, c2, c3, c4, at, mid, last } = res;
  line(`\n=== ${cfg.n} tasks a reading, ${cfg.threshold} more passes certify, measured on ${cfg.rotate ? "held-out tasks" : "the fixed practice set"} (${RUNS} runs) ===`);
  line("mean floor in permille of the price, by round:");
  line("agent       " + Array.from({ length: ROUNDS }, (_, i) => String(i + 1).padStart(5)).join("") + "   | capital-days per credit earned (last round)");
  for (const k of Object.keys(AGENTS)) {
    line(k.padEnd(12) + Array.from({ length: ROUNDS }, (_, i) => f(mean(at(k, i + 1).map((r) => r.floor))).padStart(5)).join("") + "   | " + f(mean(at(k, last).map((r) => r.perCredit)), 2));
  }
  const ok = (cond, p, want) => `${cond ? "PASS" : "FAIL"} (${pct(p)}, wants at least ${want})`;
  line(`1  the learner's floor is below the static agent's at round ${mid}:        ${ok(c1 / RUNS >= 0.9, c1, "90%")}`);
  line(`1b the learner's floor is below the static agent's at round ${last}:       ${ok(c1late / RUNS >= 0.9, c1late, "90%")}`);
  line(`2  the careless agent ends above the learner:                      ${ok(c2 / RUNS >= 0.9, c2, "90%")}`);
  line(`3  the overfitter ends above the learner:                          ${ok(c3 / RUNS >= 0.9, c3, "90%")}`);
  line(`4  two identical static agents end within 100 permille:            ${ok(1 - c4 / RUNS >= 0.8, RUNS - c4, "80%")}   (floor spread between identical agents: sd ${f(sd(res.byAgent.static.map((r) => r[last - 1].floor)))})`);
  return { c1: c1 / RUNS >= 0.9, c1b: c1late / RUNS >= 0.9, c2: c2 / RUNS >= 0.9, c3: c3 / RUNS >= 0.9, c4: 1 - c4 / RUNS >= 0.8 };
}

line(`bond-floor simulation: ${ROUNDS} rounds, price ${PRICE}, base ${DEFAULT_FLOOR.base} permille, minimum ${DEFAULT_FLOOR.min}, ${RUNS} runs, seed ${SEED}`);
const configs = [
  { n: 5, threshold: 2, rotate: true },
  { n: 10, threshold: 2, rotate: true },
  { n: 20, threshold: 3, rotate: true },
  { n: 10, threshold: 2, rotate: false },
  { n: 10, threshold: 0, rotate: true, method: "smoothed" },
  { n: 20, threshold: 0, rotate: true, method: "smoothed" },
  { n: 10, threshold: 0, rotate: false, method: "smoothed" },
  { n: 10, threshold: 0, rotate: true, method: "continuous" },
  { n: 20, threshold: 0, rotate: true, method: "continuous" },
  { n: 10, threshold: 0, rotate: false, method: "continuous" },
  { n: 20, threshold: 0, rotate: true, method: "continuous", step: 0.15, k: 2 },
  { n: 20, threshold: 0, rotate: true, method: "continuous", step: 0.15, k: 4 },
  { n: 20, threshold: 0, rotate: true, method: "continuous", step: 0.2, k: 4 },
  { n: 40, threshold: 0, rotate: true, method: "continuous", step: 0.15, k: 3 },
];
const results = configs.map((c) => report(study(c)));
// Condition 1 (separation by round five) is reported but is not required: a learner that gains a few points a round cannot be told from a static agent that early at any sample size tried.
// The claim a ten-round study can make is condition 1b.
const need = (r) => r.c1b && r.c2 && r.c3 && r.c4;
const good = configs.map((c, i) => ({ c, r: results[i] })).filter((x) => x.c.rotate && need(x.r));
line("\nSummary:");
for (let i = 0; i < configs.length; i++) line(`  ${configs[i].method ?? "pairwise"}${configs[i].step ? " step " + configs[i].step + " k " + configs[i].k : ""}, ${configs[i].n} tasks, ${configs[i].rotate ? "held-out" : "practice set"}: ${Object.entries(results[i]).map(([k, v]) => `${k} ${v ? "pass" : "FAIL"}`).join(", ")}`);
const g0 = good[0]?.c;
line(good.length
  ? `\nVerdict: with held-out measurement the rule meets conditions 1b, 2, 3 and 4 from ${g0.n} tasks a reading (${g0.method}${g0.step ? `, step ${g0.step}, a baseline of ${g0.k} readings` : ""}). It does NOT separate a learner from a static agent by round ${Math.min(5, ROUNDS)} (condition 1): the claim is "by round ${ROUNDS}".`
  : "\nVerdict: no held-out configuration met conditions 1b, 2, 3 and 4: the rule needs retuning before anything real is built on it.");
const gamed = !results[3].c3 || !results[6].c3 || !results[9].c3;
line(gamed ? "Measured on the fixed practice set, the overfitter can game the floor (condition 3 fails): rotation on held-out tasks is required, not optional." : "Measured on the practice set the overfitter did not win in this run.");
process.exit(0);
