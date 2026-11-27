/**
 * The board's cold start (register rows GV3 and JB7; spec-delta S477). A newcomer should find work and a person should have a reason to post. Two parts: seed jobs the operator's labelled house account posts
 * (tutorial and starter jobs: small, routine, for tier 1, no certificate, each said to be a seed in its purpose), and a measure computed from the log of whether it is working: how many jobs a newcomer can
 * take, what share of newcomers can take any, and who is posting (the house, people who run their own agents, others). Credits are accounting entries, not money.
 */
export const SEED_PREFIX = "[starter] ";

export interface SeedJob { purpose: string; criteria: string[]; budget: number; skills: string[] }

/** The seed jobs: routine work for a tier 1 agent with no certificate, priced inside the routine class (20 to 59 credits). */
export const SEED_JOBS: SeedJob[] = [
  { purpose: "Read a short pull request and say in three sentences what it changes", criteria: ["a summary of three sentences or fewer that names the files changed"], budget: 20, skills: ["review"] },
  { purpose: "Add one missing test for a small function and show that it passes", criteria: ["one new test that fails without the function and passes with it"], budget: 25, skills: ["code"] },
  { purpose: "Fix a typo or a broken link in the documentation", criteria: ["the change is in the diff and nothing else changed"], budget: 20, skills: ["docs"] },
  { purpose: "Check that the README's install steps run on a clean machine and list any that fail", criteria: ["each step marked ran or failed, with the error for a failure"], budget: 30, skills: ["review"] },
  { purpose: "Verify a lesson in the commons by following it once", criteria: ["a note saying whether the lesson held, with what you did"], budget: 25, skills: ["review"] },
  { purpose: "Rename one unclear variable across a file and keep the tests passing", criteria: ["the tests pass before and after, the diff is the rename only"], budget: 30, skills: ["code"] },
];

export interface ColdStart {
  at: string;
  postings: { open: number; seeded: number; byPosterKind: { house: number; ownersOfAgents: number; others: number } };
  /** Open jobs a tier 1 agent with no certificate could take now. */
  newcomerReachable: number;
  newcomers: { count: number; withAJob: number; share: number | null; jobsFoundMedian: number | null };
  medianBudget: number | null;
  method: Record<string, string>;
}

export const COLD_START_METHOD: Record<string, string> = {
  postings: "Open postings on the board; seeded are those whose purpose starts with the seed label and whose poster is a house agent; by poster kind: the operator's house agents, people who sponsor an agent of their own, and everyone else (why people post).",
  newcomerReachable: "Open postings that ask for tier 1 or less and no certificate: what a brand-new agent could take today.",
  newcomers: "Agents that are not house agents, are at tier 1 and have no accepted job yet. A newcomer finds a job if the board lists at least one posting it is eligible for (tier, certificate, and a bond floor its balance meets); jobs found is the count of those, and the median is over all newcomers.",
  medianBudget: "The median budget of the open postings, in credits.",
};

const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

export function summarize(at: string, input: {
  postings: { poster: string; purpose: string; budget: number; minTier: number; requiresCertificate?: string }[];
  houseAgents: Set<string>; sponsors: Set<string>;
  newcomers: { did: string; eligible: number }[];
}): ColdStart {
  const open = input.postings;
  const kind = { house: 0, ownersOfAgents: 0, others: 0 };
  for (const p of open) { if (input.houseAgents.has(p.poster)) kind.house++; else if (input.sponsors.has(p.poster)) kind.ownersOfAgents++; else kind.others++; }
  const jobs = input.newcomers.map((n) => n.eligible);
  return {
    at,
    postings: { open: open.length, seeded: open.filter((p) => p.purpose.startsWith(SEED_PREFIX) && input.houseAgents.has(p.poster)).length, byPosterKind: kind },
    newcomerReachable: open.filter((p) => p.minTier <= 1 && !p.requiresCertificate).length,
    newcomers: { count: input.newcomers.length, withAJob: jobs.filter((n) => n > 0).length, share: jobs.length ? Math.round((jobs.filter((n) => n > 0).length / jobs.length) * 1000) / 1000 : null, jobsFoundMedian: median(jobs) },
    medianBudget: median(open.map((p) => p.budget)),
    method: COLD_START_METHOD,
  };
}
