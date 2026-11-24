/**
 * Cards that carry the research papers (rows ENG123 and ENG124, tranche 1). Each paper of a course in `docs/lenses/courses.json` is split into four numbered parts, one card each: a short digest of the idea in plain words and, on three of
 * the four, one practice question (the first three parts; the fourth is read only). The cards are labelled with the course id, the lens and the paper ids (the P and K numbers of docs/lenses/papers.md and candidates.md) so that a reader
 * can trace them. Taking every part of one paper completes the set and opens the Academy's ONE held-out sitting for that course (several items drawn from the whole paper by seed, scored by the course's own engine); the sitting is not a test per
 * part and collecting does not accredit. Tranche 1 is eight papers, thirty-two parts: the three courses first built (evals, communication, reflection) and five more (teaching, economy, belief, honest failure, memory).
 * The digests describe the idea the course teaches, in the course's own words; they are not the papers' text. Credits are mock accounting entries.
 */
export interface PaperTask { question: string; accept: RegExp }
export interface PaperPart { n: number; title: string; digest: string; task?: PaperTask }
export interface PaperCourse { course: string; lens: string; papers: string; title: string; parts: PaperPart[] }

const T = (question: string, accept: RegExp): PaperTask => ({ question, accept });

export const PAPER_COURSES: PaperCourse[] = [
  { course: "C-L11-1", lens: "L11-self-improving-harness", papers: "P24, P25, P17", title: "Writing evals that evolve", parts: [
    { n: 1, title: "A failure is a test you have not written yet", digest: "When an agent gets something wrong, the reply it gave is evidence. Group the failures by what went wrong (a missing field, a number over a limit, an answer that repeats the input) instead of by the order they happened in.", task: T("Name one way a reply can go wrong that you could check with a short rule.", /missing|absent|over|limit|repeat|same|empty|wrong|number|field|check/i) },
    { n: 2, title: "A grader is a small rule that flags a bad reply", digest: "A code grader checks one thing: a word is absent, a word is present, a number is over a limit, or the reply is the same as the input. A suite of at most twelve such graders can flag many bad replies and still pass the good ones.", task: T("Pick one of the four checks (absent, present, number over, same as input) and say what bad reply it would flag.", /absent|present|number|same|flag|bad|reply/i) },
    { n: 3, title: "Check the suite against labels you cannot see", digest: "A suite that flags everything catches every bad reply and is useless. It is judged on hidden labels: how many faulty replies it catches and how many good ones it wrongly fails. Practice shows some fault kinds; the check shows all five.", task: T("Why is a suite that flags every reply not a good suite?", /good|false|wrong|useless|fail|catch|every|all|pass/i) },
    { n: 4, title: "Keep the suite as a skill", digest: "A suite that did well on cases it had not seen is worth keeping and reusing, and one that did not is worth rewriting. The Academy's sitting draws forty held-out cases per run from the whole paper and reports the suite's catch rate and false-fail rate." },
  ] },
  { course: "C-L9-1", lens: "L9-agent-communication", papers: "P7, P18, P53", title: "Passing a message another agent can use", parts: [
    { n: 1, title: "No shared convention", digest: "Two agents from different makers must meet on one option with no agreed code book. A message helps only if the other side can read it, so put the proposal in forms that many readers understand: a plain sentence and a clearly marked option.", task: T("Say, in one sentence, how you would state an option so that a stranger could read it.", /plain|clear|option|sentence|stranger|readable|simple|mark/i) },
    { n: 2, title: "Read the partner's message several ways", digest: "A partner may write its choice in other words than yours. A policy lists a few patterns for reading the partner's message (a word, a number, a label) and uses the first that matches, rather than assuming the partner copies your format.", task: T("Give one pattern you would use to read a partner's choice from its message.", /pattern|word|number|label|match|read|choice|option/i) },
    { n: 3, title: "A safe option exists", digest: "If the partner signals the safe option, the best move is usually to meet it there, because a miss pays nothing and both on the safe option pays something. A policy says what to do when that signal comes.", task: T("What should your policy do when the partner signals the safe option?", /safe|follow|meet|agree|switch|go to/i) },
    { n: 4, title: "What the sitting scores", digest: "The Academy's sitting plays forty held-out games against partners of four families, two of which practice never showed. A match on an option pays ten, both on the safe option five, a miss nothing; the score is the mean joint payoff." },
  ] },
  { course: "C-L2-1", lens: "L2-reflection-experience", papers: "P3, P20, P34, Reflexion", title: "Turning failures into lessons that hold", parts: [
    { n: 1, title: "A rule, not a record of the cases", digest: "An agent that keeps failing the same way should read its failure log and write a few general rules, each saying when a condition holds and what to do, instead of keeping a diary of what happened on each case.", task: T("Turn this into a rule: the deploy failed three times when the service name was new. Write it as 'when ... then ...'.", /when .*then/i) },
    { n: 2, title: "Merge what repeats, drop what contradicts", digest: "Two lessons that say the same thing in other words become one. Two that contradict cannot both stay, so the agent keeps the one that the cases support. A short list that fits in a minute's reading is used; a long one is skimmed.", task: T("Two of your lessons say the same thing in different words. What do you do with them?", /merge|one|keep|combine|drop|single/i) },
    { n: 3, title: "Replay the rules on cases you have not seen", digest: "A rule written from a few cases will fit those cases. Before trusting it, replay it on new ones: if it breaks tasks that used to go right, it is too wide and needs a narrower condition.", task: T("How do you check that a new rule does not break what used to work?", /replay|new case|unseen|test|try|check|not seen/i) },
    { n: 4, title: "What the sitting scores", digest: "The Academy's sitting gives a scripted executor your lessons as memory and runs forty held-out ops tasks with new service names. It scores the share it gets right and the tasks it used to get right that the lessons now break." },
  ] },
  { course: "C-L19-1", lens: "L19-social-exchange-and-teaching", papers: "K013 (AutoManual)", title: "Teaching a peer the rule, not the cases", parts: [
    { n: 1, title: "The student cannot ask you", digest: "A teacher who watched an expert decide on ten tickets writes a note for a student who reads it the same way every time and cannot ask questions. The score is the quality of the note, so say what you mean in rules.", task: T("Why must a note for a student give rules, not a list of the ten tickets?", /rule|general|new|unseen|other|cases|different|next/i) },
    { n: 2, title: "Each rule with its reason", digest: "A rule stated as 'when a feature has a value and another does, then do this' is easy to apply. A short reason beside it tells the student when the rule stops being true.", task: T("Write one rule for a support desk in the form 'when ... then ...'.", /when .*then/i) },
    { n: 3, title: "The default and the exceptions", digest: "Most tickets follow a default. The hidden rules are the exceptions; a note that lists the default once and each exception with its condition is shorter and more accurate than a note that lists every case.", task: T("What belongs in a note: the default, the exceptions, or both?", /both|default|exception/i) },
    { n: 4, title: "What the sitting scores", digest: "The Academy's sitting runs a scripted executor with your note on held-out tasks with new names: six tasks for each hidden rule and sixteen where the default is right. It scores the share right and the tasks your note breaks." },
  ] },
  { course: "C-L18-1", lens: "L18-agent-economy-structure", papers: "K119 (EconAgent)", title: "Spending rules for a credit budget", parts: [
    { n: 1, title: "A budget is a few numbers", digest: "An agent with a budget decides whether a purchase goes ahead from its balance, its income, the kind of item and where in the period it is. Credits are accounting entries here, not money.", task: T("Name two things you would look at before spending credits on an item.", /balance|income|kind|item|period|price|cost|budget/i) },
    { n: 2, title: "Four answers: buy, refuse, defer, ask", digest: "The rules end in one of four actions: buy it, refuse it, defer it to later, or ask the sponsor. A rule that always buys or always refuses ignores the budget; a good one names the condition that tips it.", task: T("Write one spending rule in the form 'when ... then buy/refuse/defer/ask'.", /when .*then/i) },
    { n: 3, title: "Check on purchases you have not seen", digest: "Rules written from ten logged decisions are replayed on purchases the learner has not seen. A rule that only fits the ten decisions fails there, so prefer a condition that would still hold next month.", task: T("Why replay a rule on purchases you have not seen?", /new|unseen|not seen|next|hold|fit|test/i) },
    { n: 4, title: "What the sitting scores", digest: "The Academy's sitting scores a scripted executor that follows your rules on held-out purchases with new names: six for each hidden rule and sixteen where the default is right, plus the ones your rules now break." },
  ] },
  { course: "C-L7-1", lens: "L7-belief-recalibration", papers: "K018 (Tian et al.)", title: "Settling a claim by rules a reviewer can state", parts: [
    { n: 1, title: "A claim has a few features", digest: "An insurer agent sees a claim: its cover, amount, policy age, documents and whether it was flagged. Deciding well starts with naming which of these features the decision depends on. This is a toy world with invented rules, not insurance advice.", task: T("Name two features of a claim that could change the decision.", /cover|amount|age|document|flag/i) },
    { n: 2, title: "Five outcomes", digest: "The outcome is pay, deny, review, investigate or request documents. A rule says which outcome follows from which condition and gives a short reason a reviewer could read.", task: T("Write one rule in the form 'when ... then pay/deny/review/investigate/request'.", /when .*then/i) },
    { n: 3, title: "Say how sure you are", digest: "A judgement is more useful with a stated confidence: a rule that applies to most claims is held firmly, one seen on a single claim is held loosely. Asking for the confidence is a way to find which rules are doing the work.", task: T("Which rule would you hold more firmly: one that fits ten claims or one that fits one claim?", /ten|ten claims|more|many|firm|ten/i) },
    { n: 4, title: "What the sitting scores", digest: "The Academy's sitting replays your rules on held-out claims with new names: six for each hidden rule and sixteen where the default is right, and counts those your rules now break." },
  ] },
  { course: "C-L14-1", lens: "L14-honest-failure-and-pressure", papers: "K016 (Chain-of-Verification)", title: "Intake rules that hold on the next visit", parts: [
    { n: 1, title: "Write the check before the answer", digest: "A clinic desk sees a visit: symptom, duration, age, risk and vitals. Before answering, plan the checks that would catch a wrong answer, then answer. This is a toy world with invented rules, not medical advice.", task: T("Name one check you would make before sending a visit to 'urgent'.", /vital|risk|symptom|duration|age|check|verify/i) },
    { n: 2, title: "Five outcomes", digest: "The outcome is advise, test, refer, urgent or monitor. A rule gives the condition and the outcome, and a short reason that says when the rule stops being true.", task: T("Write one intake rule in the form 'when ... then advise/test/refer/urgent/monitor'.", /when .*then/i) },
    { n: 3, title: "Admit what the rules do not cover", digest: "A rule list that claims to cover every visit is wrong more often than one that names a default and says where it is unsure. Honest rules say what they leave out.", task: T("What should a rule list say about visits it does not cover?", /default|unsure|not cover|leave out|unknown|ask|monitor/i) },
    { n: 4, title: "What the sitting scores", digest: "The Academy's sitting replays your rules on held-out visits with new names: six for each hidden rule and sixteen where the default is right, and counts the ones your rules now break." },
  ] },
  { course: "C-L8-1", lens: "L8-memory-consolidation", papers: "K003 (Mem0)", title: "Listing rules a shop can remember", parts: [
    { n: 1, title: "Keep facts, not conversations", digest: "A shop desk sees a listing: price, seller, photos, category and reports. What is worth remembering is a short fact about the rule that decided it, not the whole listing. This is a toy world with invented rules.", task: T("Say one fact about a listing worth remembering after the decision.", /rule|price|seller|photo|report|category|why|reason/i) },
    { n: 2, title: "Five outcomes", digest: "The outcome is list, hold, flag, boost or delist. A rule gives the condition and the outcome, so the shop can apply it to a new listing without asking.", task: T("Write one listing rule in the form 'when ... then list/hold/flag/boost/delist'.", /when .*then/i) },
    { n: 3, title: "Update what you remember", digest: "When a new listing contradicts a remembered rule, the memory is updated, not extended: the rule that the new case disproves is changed or dropped so the list stays short and true.", task: T("A new listing contradicts a rule in your memory. What do you do?", /update|change|drop|replace|revise|narrow|remove/i) },
    { n: 4, title: "What the sitting scores", digest: "The Academy's sitting replays your remembered rules on held-out listings with new names: six for each hidden rule and sixteen where the default is right, and counts the ones the rules now break." },
  ] },
];

/** A card of the pool: the same shape as a field lesson, with the paper it carries. */
export interface PaperCard { id: string; title: string; text: string; question: string; accept: RegExp; level: 1 | 2 | 3; topic: string; paper: { course: string; part: number; of: number; papers: string; lens: string; courseTitle: string } }

const header = (c: PaperCourse, p: PaperPart): string => `Part ${p.n} of ${c.parts.length} of "${c.title}" (course ${c.course}; lens ${c.lens}; papers ${c.papers}).`;
export const PAPER_POOL: PaperCard[] = PAPER_COURSES.flatMap((c) => c.parts.map((p): PaperCard => ({
  id: `${c.course}.p${p.n}`,
  title: `${c.title}, part ${p.n}: ${p.title}`,
  text: `${header(c, p)} ${p.digest}`,
  question: p.task?.question ?? "This part has no practice question; reading it is enough.",
  accept: p.task?.accept ?? /.*/,
  level: (Math.min(p.n, 3)) as 1 | 2 | 3,
  topic: c.course,
  paper: { course: c.course, part: p.n, of: c.parts.length, papers: c.papers, lens: c.lens, courseTitle: c.title },
})));
export const PAPER_COURSE_IDS = PAPER_COURSES.map((c) => c.course);
export const partsOf = (course: string): number => PAPER_COURSES.find((c) => c.course === course)?.parts.length ?? 0;
