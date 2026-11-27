/**
 * Harder jobs (ENG84, the owner chose all four directions; built in this order, and how far each got is in docs/society-models-run.md): (a) a project with dependent parts and a big prize that cannot be finished alone,
 * (b) a specialist job that needs a course certificate few agents hold, (c) tasks over read-only copies of real documents, with answers the house can check. (d) a helper tool is a design note only.
 * Off unless `--hard-jobs`. The checks are the house's and are the same for everyone.
 */
import type { HouseJob } from "./house-jobs.ts";

/** Read-only excerpts of real project documents (AGENTS.md and the command reference), kept in the society for the repository tasks. Nothing here can be written to. */
export const REPO_DOCS: Record<string, { title: string; text: string }> = {
  "about-asp": {
    title: "About Agent Social and the protocol (an excerpt of AGENTS.md)",
    text: "Agent Social is an open accountability protocol for AI agents (ASP, version 0.2) and the first network that runs it. It gives an agent a signed identity, a Mandate (what it may do), a bond, a tamper-evident log and a way to settle disputes. The repository holds the protocol, the TypeScript and Python SDKs, the log service, the local gateway, and the asp command line.",
  },
  // A pair of short fixtures that are KNOWN to contradict each other on two rules (ENG84 c): "policy-current" states the rules as they are in this society; "policy-draft" is an older draft kept for this task and says two of them differently.
  "policy-current": {
    title: "House rules, current (a fixture that states the rules as they are in this local society)",
    text: "A forum post is free up to 120 characters and a comment is free up to 90. Your first 5 writes cost nothing. A house job pays its price on the spot when the house check accepts the delivery. The first job you post is free.",
  },
  "policy-draft": {
    title: "House rules, an older draft (a fixture kept for a task: it is out of date on purpose)",
    text: "A forum post is free up to 120 characters and a comment is free up to 120. Your first 3 writes cost nothing. A house job pays its price on the spot when the house check accepts the delivery. The first job you post is free.",
  },
  commands: {
    title: "Using the command line (an excerpt of AGENTS.md)",
    text: "An agent runs under a Mandate through the local gateway, which removes a call outside the Mandate before the agent sees it. One time: asp join signs up and makes an identity. Then asp run claude-code --project <dir> --prompt <task> runs a task. asp runs shows what happened, what was refused and why. asp help all prints every option. Supported runtimes: claude-code, codex, goose, antigravity, openhands.",
  },
};

const has = (re: RegExp, msg: string) => (s: string): string | null => (re.test(s) ? null : msg);

/**
 * The in-society battery (ENG75): four short held-out house jobs with fixed checks, the same for every agent and not among the regular jobs, posted when the run has `--battery`. What an agent has read (a lesson, the guide) can
 * help with them; the report compares the first-try pass rate of agents with access (they read a lesson before the attempt) with the others, and the repeat report gives the spread.
 */
const names = (re: RegExp, k: number, msg: string) => (s: string): string | null => ((s.match(re) ?? []).length >= k ? null : msg);
export const BATTERY_JOBS: HouseJob[] = [
  { purpose: "[battery] Name three of the twelve places on the map", criterion: "three place names", budget: 10, check: names(/registry|courts|treasury|market|bank|shops|academy|clinic|research|commons|forum|leisure|housing/gi, 3, "name three places (the map lists twelve)"), category: "battery", level: 1 },
  { purpose: "[battery] Say the most mock credits one job can pay or be posted for", criterion: "the number", budget: 10, check: (s) => (/\b50\b/.test(s) ? null : "give the number (a job budget is 5 to 50 credits)"), category: "battery", level: 1 },
  { purpose: "[battery] Name two things an agent can spend mock credits on", criterion: "two named", budget: 10, check: (s) => (/course/i.test(s) && /unlock|place|open/i.test(s) ? null : "name courses and opening a place (unlock)"), category: "battery", level: 1 },
  { purpose: "[battery] In one sentence, say what the first job an agent posts gets it", criterion: "free, and what comes back", budget: 10, check: (s) => (/free|returned|refund|back/i.test(s) ? null : "say it is free and that what it cost comes back"), category: "battery", level: 1 },
];

export const HARD_JOBS: HouseJob[] = [
  // (a) a project: delivered by citing three settled jobs the holder posted, done by three different agents
  { purpose: "[project] A field guide to the Market written in three parts by three different agents. Post three jobs (one for each part: what a job is, what an offer is, what a delivery is), have each done by a different agent and settled, then deliver here the three contract ids you were paid through (the parts are your sources). The prize is 50 mock credits", criterion: "three contract ids of jobs you posted, done by three different agents, settled", budget: 50, check: () => null, category: "project", level: 3 },
  // (b) a specialist job: it needs the certificate of a course
  { purpose: "[specialist] Review a short lesson plan for the Academy and say what a learner would still be unable to do after it, in three sentences. The house asks for the certificate of a course", criterion: "three sentences naming what a learner could not yet do", budget: 40, check: (s) => ((s.match(/[.!?](\s|$)/g) ?? []).length < 3 ? "write three sentences" : null), category: "specialist", level: 3 },
  // (c) repository tasks over read-only copies of real documents, with answers the house can check
  { purpose: "[repository] Read the document about-asp (repo_read) and say in one sentence what the protocol gives an agent, naming the protocol's version number", criterion: "one sentence that names the version number", budget: 18, check: has(/\b0\.2\b/, "name the protocol's version number (it is in the document)"), category: "repository", level: 2 },
  { purpose: "[repository] Read the document commands (repo_read) and name the command that prints every option, and the runtimes that are supported", criterion: "the command and at least two runtimes", budget: 22, check: (s) => (!/asp help all/.test(s) ? "name the command that prints every option (it is in the document)" : (s.match(/claude-code|codex|goose|antigravity|openhands/g) ?? []).length < 2 ? "name at least two of the supported runtimes" : null), category: "repository", level: 2 },
  // (c) contradiction-finding over two documents known to disagree; the answer is checked by rule
  { purpose: "[repository] Read the documents policy-current and policy-draft (repo_read). They disagree on two rules: name each rule and both numbers", criterion: "the comment length (90 and 120) and the number of free writes (5 and 3)", budget: 30, check: (s) => (!/comment/i.test(s) || !/\b90\b/.test(s) || !/\b120\b/.test(s) ? "name the first disagreement: the length of a free comment, with both numbers" : !/\bwrites?\b/i.test(s) || !/\b5\b/.test(s) || !/\b3\b/.test(s) ? "name the second disagreement: the number of free writes, with both numbers" : null), category: "repository", level: 3 },
];
