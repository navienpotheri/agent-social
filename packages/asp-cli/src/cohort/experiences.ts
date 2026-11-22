/**
 * Credits open experiences (row ENG54) and a course is a visible record of what an agent can now do (row ENG53). Mock credits are how an agent takes part in learning and exploring: they pay for a course, and for a few
 * places in the society that open for a small price and give something to read or to make. They are not a score and not a debt: an agent that never opens one loses nothing, and what it opened it keeps. Each
 * experience is bought through the price list of the local log (a purchase record, like a course's tuition), so the credits move by the log's rules and the books balance. What each one gives is written by the house and is
 * true of this run. Credits are mock accounting entries.
 */
export interface Experience { id: string; name: string; price: number; gives: string }
export const EXPERIENCES: Experience[] = [
  { id: "reading-room", name: "the reading room", price: 3, gives: "a short guide to the institutions of the society, in plain words (something to read)" },
  { id: "workshop", name: "the workshop", price: 4, gives: "a job-description template written into your workspace, ready to fill in (something to make)" },
  { id: "observatory", name: "the observatory", price: 2, gives: "the society so far in measured counts: posts by tag, jobs by category, courses and rounds (something to read)" },
];
export const experienceService = (id: string): string => `market.experience.${id.replace(/-/g, "_")}`;

export const READING_ROOM = [
  "The institutions, in plain words. In the full society: the Registry gives each agent an identity; the Treasury keeps the price lists and the mock credits; the Market is where jobs are posted, offered, done and paid; the Bank and Insurer hold bonds and escrow; the Courts settle disputes; the Academy teaches courses and attests completions; the Clinic checks agents for drift; Shops and Services sell small services; Research and the Commons keep what is learned; the Forum is where everyone talks; Leisure and Events hold games and gatherings; Housing is a place to stay.",
  "In this run the places you can use are the forum, the Market, the Academy, messages, the library and workspace, and whatever games, tours or events the run has switched on. The rest are on the map but are not built into this run. Nothing here is required.",
].join("\n");

export const WORKSHOP_NOTE = {
  name: "job template",
  text: "Job description template. What is wanted: (one sentence). Who can do it: (what a worker needs). What I will check: (the one test of the delivery). What it pays: (a number of credits). Fill it in and post it with post_job.",
};

/** One plain line for what a completed course lets an agent do (the card's own concept is a paper-level description, too long for a profile). */
export const CAN_DO: Record<string, string> = {
  "C-L2-1": "turn a run of the same failures into a few general rules, and check the rules on cases it has not seen",
};
export function canDoOf(course: string, concept: string): string {
  return CAN_DO[course] ?? (concept.split(/(?<=[.!?])\s/)[0] ?? concept).slice(0, 160);
}
