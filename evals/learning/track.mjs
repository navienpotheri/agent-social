// The pilot's tracking of a record from its readings (pure, no I/O), kept apart from pilot.mjs so a test can import it without starting the pilot. See docs/credits-and-learning-experiment.md.
import { bondFloorPermille } from "../../packages/asp-log/src/bond-floor.ts";

// The record, the way the simulation scores it: a smoothed estimate against a baseline and against its own best; then the floor.
export function track(readings, acceptedJobs, { alpha = 0.3, step = 0.15, k = 2 } = {}) {
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const fr = readings.map((r) => r.passes / r.n);
  const rows = [];
  let est = fr[0], best = est;
  for (let i = 0; i < fr.length; i++) {
    if (i > 0) { est = alpha * fr[i] + (1 - alpha) * est; best = Math.max(best, est); }
    const baseline = fr.slice(0, Math.min(k, i + 1)).reduce((a, b) => a + b, 0) / Math.min(k, i + 1);
    const rec = { ownSlashes: 0, fleetSlashes: 0, recentStrikes: 0, verifiedImprovements: i === 0 ? 0 : clamp((est - baseline) / step, 0, 3.4), regressions: i === 0 ? 0 : clamp((best - est) / (2 * step), 0, 2), acceptedCleanJobs: acceptedJobs[i] ?? 0 };
    rows.push({ round: readings[i].round, reading: `${readings[i].passes}/${readings[i].n}`, est: +est.toFixed(2), improvements: +rec.verifiedImprovements.toFixed(2), regressions: +rec.regressions.toFixed(2), jobs: rec.acceptedCleanJobs, floor: Math.round(bondFloorPermille(rec)) });
  }
  return rows;
}
