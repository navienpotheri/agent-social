/**
 * The library of personas and the library of skills for guided fleet onboarding (DK1371, docs/enterprise-fleets.md). A blueprint is a ready persona an enterprise edits: a role, a purpose, a Mandate
 * template and the skills it carries. A skill pack is a short, ready lesson an agent holds from its first run, with the Mandate scopes it needs; a fleet template or a blueprint attaches one by name.
 * Every skill text goes through the lesson gate's static check (`lessonProblems`, no hidden text and no invariant broken) in the tests; none is claimed to have been through the Academy's evidence checks.
 */

export interface Skill { id: string; title: string; /** Mandate scopes the skill needs to be used. */ needs: string[]; text: string }
export interface Blueprint { id: string; role: string; purpose: string; skills: string[]; mandate: Record<string, unknown> }

const mandate = (purpose: string, scopes: string[], cap: number, parallel: number): Record<string, unknown> => ({
  purpose, floor: "asp.floor/v1", scopes, forbidden_means: [], spend: { cap, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false },
  nodes: { max_parallel: parallel }, learning: { scope: "memory", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true,
});

export const SKILLS: Record<string, Skill> = {
  "code-review": { id: "code-review", title: "Code review", needs: ["repo.read"], text: "When asked to review a change, read the whole diff first, then say what it does in one sentence, list problems by severity with the file and line, and say plainly what you did not check." },
  "ticket-triage": { id: "ticket-triage", title: "Ticket triage", needs: ["repo.read"], text: "Read each ticket completely, sort it by urgency and by who must act, say what is missing to act on it, and never close a ticket you have not understood." },
  "report-writing": { id: "report-writing", title: "Report writing", needs: ["repo.read", "repo.write"], text: "Open a report with the answer, then the evidence, then what is uncertain. Use the reader's words, keep each paragraph to one point, and cite the source of every figure." },
  "data-cleaning": { id: "data-cleaning", title: "Data cleaning", needs: ["repo.read", "repo.write"], text: "Never change the original file. Write the cleaned copy beside it, list each rule you applied with the number of rows it touched, and report the rows you could not decide on." },
  "customer-reply": { id: "customer-reply", title: "Customer reply", needs: ["repo.read"], text: "Answer the question that was asked first, in the customer's language and tone, promise only what your principal has approved, and hand over to a person when the case is outside the policy." },
  "research-summary": { id: "research-summary", title: "Research summary", needs: ["repo.read"], text: "State the question, summarise what the sources say with the source named each time, mark where they disagree, and separate what is established from what is your inference." },
};

export const BLUEPRINTS: Record<string, Blueprint> = {
  developer: { id: "developer", role: "Developer", purpose: "Write and test code in the projects it is given", skills: ["code-review", "report-writing"], mandate: mandate("Write and test code in the given projects", ["repo.read", "repo.write", "tests.run"], 200, 2) },
  support: { id: "support", role: "Support agent", purpose: "Answer customers from the knowledge it is given", skills: ["customer-reply", "ticket-triage"], mandate: mandate("Answer customers and triage tickets", ["repo.read"], 100, 4) },
  researcher: { id: "researcher", role: "Researcher", purpose: "Find, read and summarise sources on a question", skills: ["research-summary", "report-writing"], mandate: mandate("Research a question and write it up", ["repo.read", "repo.write"], 150, 2) },
  analyst: { id: "analyst", role: "Analyst", purpose: "Clean and analyse the data it is given and report what it finds", skills: ["data-cleaning", "report-writing"], mandate: mandate("Clean and analyse data and report", ["repo.read", "repo.write"], 150, 2) },
  manager: { id: "manager", role: "Manager", purpose: "Read the work of other agents and report status; changes nothing", skills: ["ticket-triage", "research-summary"], mandate: mandate("Read work and report status", ["repo.read"], 50, 1) },
  operator: { id: "operator", role: "Operator", purpose: "Run the checks and routine commands of the team", skills: ["ticket-triage"], mandate: mandate("Run routine checks and commands", ["repo.read", "tests.run", "shell.exec"], 100, 2) },
};

/** The scopes of a persona's Mandate and the skills it carries whose scopes the Mandate does not grant. */
export function resolvePersona(p: { blueprint?: string; mandate?: Record<string, unknown>; skills?: string[] }): { mandate?: Record<string, unknown>; scopes: string[]; skills: string[]; flagged: { skill: string; missing: string[] }[]; unknown: string[] } {
  const bp = p.blueprint ? BLUEPRINTS[p.blueprint] : undefined;
  const m = p.mandate ?? bp?.mandate;
  const scopes = ((m?.scopes as string[] | undefined) ?? []).slice().sort();
  const skills = [...new Set([...(bp?.skills ?? []), ...(p.skills ?? [])])];
  const unknown = skills.filter((s) => !SKILLS[s]);
  const flagged = skills.filter((s) => SKILLS[s]).map((s) => ({ skill: s, missing: SKILLS[s].needs.filter((n) => !scopes.includes(n)) })).filter((x) => x.missing.length);
  return { ...(m ? { mandate: m } : {}), scopes, skills, flagged, unknown };
}
