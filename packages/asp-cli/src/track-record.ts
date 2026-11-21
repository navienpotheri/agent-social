/**
 * A track record in plain words (register row US3): `asp registry lookup <did> --plain` and `asp registry compare <did> <did> ...`. They say, from the page the log computes, what an agent has done and
 * what has gone wrong, in sentences a person can compare, and they say when there are too few jobs to judge. They add no figure that the page does not hold and no score: a count is a count.
 */
import type { RecordPage } from "@agent-social/asp-log";

/** Fewer accepted jobs than this are too few to judge an agent by. */
export const TOO_FEW_JOBS = 3;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function plainTrackRecord(p: RecordPage): string[] {
  const name = p.names[0] ?? p.did;
  const kind = p.house ? "a house agent run by the operator" : p.kind === "agent" ? "an agent" : `a ${p.kind}`;
  const out: string[] = [];
  out.push(`${name} is ${kind} at the ${String(p.level).replace(/_/g, "-")} identity level${p.sponsor ? `, sponsored by ${p.sponsor}` : ", with no sponsor"}.`);
  out.push(p.tier === null ? "It has no tier yet." : `It is in tier ${p.tier}.`);
  out.push(`It has had ${plural(p.acceptedJobs, "job")} accepted; ${p.qualifyingJobs} of them counted toward its standing, because they came from an independent poster.`);
  out.push(p.slashCount === 0 ? "No bond of its has been slashed." : `A bond of its has been slashed ${plural(p.slashCount, "time")}.`);
  out.push(p.strikes === 0 ? "It has no strikes in the last 30 days." : `It has ${plural(p.strikes, "strike")} in the last 30 days.`);
  out.push(p.certificates.length ? `It holds ${plural(p.certificates.length, "certificate")}: ${p.certificates.map((c) => `${c.skill} at level ${c.level}`).join(", ")}.` : "It holds no certificate.");
  if (p.suspended) out.push(`It is suspended until ${p.suspended.until}: ${p.suspended.reason}.`);
  if (p.retired) out.push("It has been retired by its holder.");
  if (p.takedowns.length) out.push(`${plural(p.takedowns.length, "name")} of it ${p.takedowns.length === 1 ? "was" : "were"} taken down by the Registry; each can be appealed.`);
  if (p.acceptedJobs < TOO_FEW_JOBS) out.push(`Too few jobs to judge: fewer than ${TOO_FEW_JOBS} accepted jobs.`);
  out.push(`This summary is computed from the public log at record ${p.seq}. It is a set of counts and says nothing about quality beyond them. Recompute it with asp registry verify ${p.did}.`);
  return out;
}

/** The figures that two or more agents can be compared on, one line each. */
export function comparisonTable(pages: RecordPage[]): string[] {
  const rows: [string, (p: RecordPage) => string][] = [
    ["tier", (p) => (p.tier === null ? "none" : String(p.tier))],
    ["accepted jobs", (p) => String(p.acceptedJobs)],
    ["counted for standing", (p) => String(p.qualifyingJobs)],
    ["bonds slashed", (p) => String(p.slashCount)],
    ["strikes, 30 days", (p) => String(p.strikes)],
    ["certificates", (p) => String(p.certificates.length)],
    ["identity level", (p) => String(p.level).replace(/_/g, "-")],
  ];
  const names = pages.map((p) => p.names[0] ?? p.did);
  const width = Math.max(...names.map((n) => n.length), 8);
  const lines = [`${"".padEnd(22)}${names.map((n) => n.padEnd(width + 2)).join("")}`];
  for (const [label, f] of rows) lines.push(`${label.padEnd(22)}${pages.map((p) => f(p).padEnd(width + 2)).join("")}`);
  return lines;
}
