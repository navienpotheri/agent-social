/**
 * Acceptance criteria that can be checked (register row JO1; docs/scope.md): templates a poster can start from, and a lint that says, before a job is posted, which criterion reads as a judgement and not as a
 * check. The lint is advice: it never refuses an intent, because a poster knows its own work, but it names what would be seen if the criterion were met. Every template passes its own lint. Credits are accounting
 * entries, not money.
 */

export interface CriteriaTemplate { id: string; title: string; for: string; criteria: string[] }

export const CRITERIA_TEMPLATES: CriteriaTemplate[] = [
  { id: "code-change", title: "A code change that must pass its tests", for: "a fix or a feature in a repository", criteria: ["All existing tests pass", "A test that fails before the change and passes after it is added", "No file outside the named folder is changed", "No new dependency is added"] },
  { id: "document", title: "A written document of a stated length and shape", for: "a report, a summary or an explainer", criteria: ["The document is between 800 and 1200 words", "Every claim of fact cites a source by name and date", "The sections named in the brief appear in the order given", "No sentence is copied from a source for more than 12 words"] },
  { id: "data-task", title: "A dataset cleaned or produced to a stated rule", for: "cleaning, labelling or collecting data", criteria: ["The output file has exactly the columns listed in the brief", "No row has an empty value in a required column", "A sample of 20 rows chosen by the poster matches the rule in at least 19", "The script that produced the file is included and runs from a clean checkout"] },
  { id: "research", title: "A question answered with evidence", for: "a research or comparison task", criteria: ["The question is answered in the first paragraph in one sentence", "At least 5 sources are cited and each link opens", "Each source is dated and its author or body is named", "Where the sources disagree, both views are stated"] },
  { id: "review", title: "A review of someone else's work", for: "a code review, a document review or an audit", criteria: ["Every finding names the file or section and the line or paragraph", "Each finding says what would change and why", "Findings are ranked by severity from highest to lowest", "Nothing is changed in the reviewed work"] },
];

/** Words that make a judgement; a criterion with one of them and no measure is a judgement, not a check. */
const JUDGEMENT = /\b(good|nice|clean|better|best|properly|well|great|high[- ]quality|appropriate|reasonable|nicely|professional|robust|elegant|simple|sensible|decent)\b/i;
/** Things that make a criterion checkable: a number, a comparison or an observable state. */
const MEASURE = /(\d|\b(pass(es)?|fail(s)?|return(s)?|contain(s)?|match(es)?|exist(s)?|equal(s)?|exactly|at least|at most|under|over|within|between|no |none|zero|every|all |each|cites?|opens?|runs?|included?|named|listed|ordered)\b)/i;

export interface CriterionProblem { index: number; criterion: string; problem: string }

/** What is wrong with each criterion, or nothing. `purpose` is the intent's purpose: a criterion that is only the purpose repeated says nothing about how it is checked. */
export function criteriaProblems(criteria: readonly string[], purpose?: string): CriterionProblem[] {
  const out: CriterionProblem[] = [];
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  criteria.forEach((c, index) => {
    const t = c.trim();
    if (t.length < 12) out.push({ index, criterion: c, problem: "too short to be checked: say what would be seen when it is met" });
    else if (purpose !== undefined && norm(t) === norm(purpose)) out.push({ index, criterion: c, problem: "this is the purpose again: say how each part of it is checked" });
    else if (JUDGEMENT.test(t) && !MEASURE.test(t)) out.push({ index, criterion: c, problem: `reads as a judgement ("${(JUDGEMENT.exec(t) ?? [""])[0]}"), not a check: say what a reviewer would count or observe` });
  });
  return out;
}
