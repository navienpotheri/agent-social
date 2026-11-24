/**
 * The report of the paper cards (ENG123): per course and per paper, from the markers' own record and the Academy's sittings: how many agents found each part, how many read it (answered its question, or picked up a part with no question),
 * how many completed the set of all parts, and how many sat the course's held-out check and passed it. Counts of one run; nothing is said about why.
 */
import { PAPER_COURSES } from "./paper-cards.ts";
import type { Markers } from "./markers.ts";

export interface SittingCounts { sat: number; attempts: number; passed: number }
export interface SittingRow { handle: string; course: string; attempt: number; mean: number; passed: boolean; parts: number; set: boolean; arm?: string }
const mean = (a: number[]): string => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : "none");
export function renderPaperReport(m: Markers, sittings: (course: string) => SittingCounts, agents: number, log: SittingRow[] = []): string {
  if (!m.paperMode) return "";
  const L = ["## Paper cards: per course and per paper", "", `${PAPER_COURSES.length} papers in four numbered parts each (${PAPER_COURSES.length * 4} cards); a window of the simulated clock changes the cards; ${agents} agents. A part is found when an agent looks at its place and sees it, read when it answers the part's practice question (a part with no question is read when it is picked up); a set is all four parts of one paper; the Academy's held-out check for the course is the ONE sitting per paper (not a test per part). Counts of one run.`, "",
    "| Course | Papers | Part 1 found/read | Part 2 | Part 3 | Part 4 | Sets | Sat the check | Passed |", "|---|---|---|---|---|---|---|---|---|"];
  for (const c of PAPER_COURSES) {
    const cell = (n: number): string => {
      const id = `${c.course}.p${n}`, found = new Set(m.paperLog.filter((e) => e.kind === "found" && e.id === id).map((e) => e.did)).size, read = new Set(m.paperLog.filter((e) => e.kind === "read" && e.id === id).map((e) => e.did)).size;
      return `${found}/${read}`;
    };
    const sets = new Set(m.paperLog.filter((e) => e.kind === "set" && e.course === c.course).map((e) => e.did)).size, s = sittings(c.course);
    L.push(`| ${c.course} ${c.title} | ${c.papers} | ${cell(1)} | ${cell(2)} | ${cell(3)} | ${cell(4)} | ${sets} | ${s.sat} (${s.attempts} sittings) | ${s.passed} |`);
  }
  const total = m.paperLog.filter((e) => e.kind === "set").length;
  const ofCourse = log.filter((r) => PAPER_COURSES.some((c) => c.course === r.course));
  if (ofCourse.length) {
    L.push("", "### Before and after, by sitting", "", "Every Academy sitting of these courses, with what the agent had of that paper when it sat: no part yet (before any card), some part but not the set, or the whole set; and the arm of the access experiment when there is one (`--experiment access`: the control half has no card tools). Scores are the mean of the sitting, in percent; sittings of one run, small numbers.", "", "| Course | Before any card (n, mean) | Some part (n, mean) | Whole set (n, mean) | Access arm (n, mean) | Control arm (n, mean) |", "|---|---|---|---|---|---|");
    for (const c of PAPER_COURSES) {
      const r = ofCourse.filter((x) => x.course === c.course); if (!r.length) continue;
      const g = (f: (x: SittingRow) => boolean): string => { const s = r.filter(f).map((x) => x.mean); return `${s.length}, ${mean(s)}`; };
      L.push(`| ${c.course} | ${g((x) => x.parts === 0)} | ${g((x) => x.parts > 0 && !x.set)} | ${g((x) => x.set)} | ${g((x) => x.arm === "access")} | ${g((x) => x.arm === "control")} |`);
    }
    L.push("", "Sittings stay unlocked: an agent may sit before it has read any card, which is what makes a before. The repeat report (`cohort repeat`) reads the same per-sitting record from each run's `paper-sittings.json`; a spread across repeats is not computed in this stretch.");
  }
  L.push("", `Sets completed in all: ${total}. Mock credits the cards paid: ${m.paid}. Not measured here: a before and after of the same agent (the access experiment, \`--experiment access\`, is the comparison), and any effect of a card on later work.`);
  return L.join("\n") + "\n";
}
