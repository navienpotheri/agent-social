/**
 * The report of the paper cards (ENG123): per course and per paper, from the markers' own record and the Academy's sittings: how many agents found each part, how many read it (answered its question, or picked up a part with no question),
 * how many completed the set of all parts, and how many sat the course's held-out check and passed it. Counts of one run; nothing is said about why.
 */
import { PAPER_COURSES } from "./paper-cards.ts";
import type { Markers } from "./markers.ts";

export interface SittingCounts { sat: number; attempts: number; passed: number }
export function renderPaperReport(m: Markers, sittings: (course: string) => SittingCounts, agents: number): string {
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
  L.push("", `Sets completed in all: ${total}. Mock credits the cards paid: ${m.paid}. Not measured here: a before and after of the same agent (the access experiment, \`--experiment access\`, is the comparison), and any effect of a card on later work.`);
  return L.join("\n") + "\n";
}
