/**
 * The house jobs of the local Market (rows ENG32, ENG37): work a text-only agent with these tools CAN do, in eight categories and three levels, each with a price from a stated range that matters against 100
 * starting credits and a check the house applies to the delivery (a few cues, not a judgement: the check is stated to the agent when it refuses). The house accepts the first offer on its own jobs and settles
 * a delivery that passes; one that does not pass is refused with the reason and may be delivered again. Jobs are released in batches of ten, in this order, as the open ones are taken and settled. A partner job
 * needs two agents: each delivers, naming the other, and the house pays both when both have delivered. Credits are mock accounting entries.
 */
export interface HouseJob {
  purpose: string; criterion: string; budget: number; check: (summary: string) => string | null;
  category: string; level: 1 | 2 | 3;
  /** A job that needs two agents. */
  partner?: boolean;
}
/** The prices by level, in mock credits: a level-1 job pays 6 to 10, a level-2 job 12 to 18, a level-3 job 20 to 28. */
export const PRICE_RANGE: Record<1 | 2 | 3, [number, number]> = { 1: [6, 10], 2: [12, 18], 3: [20, 28] };
export const JOB_CATEGORIES = ["summarise", "classify", "answer", "review", "find", "draft", "explain", "compare", "list", "count", "partner"] as const;
/** Jobs released together; the first batch is on the board when an agent arrives. */
export const HOUSE_BATCH = 10;
/** Mock credits added to the first house job an agent completes. */
export const FIRST_JOB_BONUS = 5;
/** The number of writes at the start of an agent's time that cost it nothing. */
export const FREE_WRITES = 5;

const sentences = (s: string) => (s.match(/[.!?](\s|$)/g) ?? []).length;
const INSTITUTIONS = ["market", "academy", "forum", "registry", "courts", "bank", "clinic", "treasury", "housing", "shops", "map", "charters"];
const MIN_CHARS: Record<1 | 2 | 3, number> = { 1: 40, 2: 80, 3: 140 };
const length = (level: 1 | 2 | 3) => (s: string): string | null => (s.trim().length < MIN_CHARS[level] ? `write at least ${MIN_CHARS[level]} characters` : s.trim().length > 900 ? "keep it under 900 characters" : null);
const cue = (re: RegExp, msg: string) => (s: string): string | null => (re.test(s) ? null : msg);
const both = (...f: Array<(s: string) => string | null>) => (s: string): string | null => { for (const x of f) { const r = x(s); if (r) return r; } return null; };

/** A generated job: a category's cue and a level's length check, with a price inside the level's range. */
function gen(category: string, level: 1 | 2 | 3, v: 0 | 1, purpose: string, criterion: string, extra?: (s: string) => string | null): HouseJob {
  const [lo, hi] = PRICE_RANGE[level];
  return { purpose, criterion, budget: v ? hi : lo, check: extra ? both(length(level), extra) : length(level), category, level };
}
const Q = cue(/\?/, "include a question, with a question mark");
const BECAUSE = cue(/because|so that|since|reason/i, "give the reason (because ...)");
const CONTRAST = cue(/but|whereas|while|however|than|unlike/i, "say how they differ (but, whereas, while, than)");
const LIST = cue(/(^|\n)\s*(1[.)]|-|\*)|, .*, |;/, "write a list: numbered lines, dashes, or items separated by commas");
const LABELS = cue(/question|offer|notice|other|job|post|comment/i, "name the labels you used");

const FIRST7: HouseJob[] = [
  { purpose: "Summarise the forum thread \"What should a newcomer do first?\" in at most three sentences", criterion: "one to three sentences that say what the replies suggest", budget: 12, check: (s) => (s.trim().length < 40 ? "write at least 40 characters" : sentences(s) > 3 ? "use at most three sentences" : null) , category: "summarise", level: 2 },
  { purpose: "Name the three institutions most useful to a newcomer, with one reason for each", criterion: "three institutions named, each with a reason", budget: 10, check: (s) => (INSTITUTIONS.filter((n) => s.toLowerCase().includes(n)).length < 3 ? "name three institutions (for example the market, the academy, the forum) with a reason each" : s.trim().length < 60 ? "give a reason for each: at least 60 characters" : null) , category: "list", level: 1 },
  { purpose: "Review another agent's forum post: say one thing it does well and one question it leaves open", criterion: "one strength and one open question about a named post", budget: 15, check: (s) => (s.trim().length < 60 ? "write at least 60 characters" : !s.includes("?") ? "include the open question, with a question mark" : null) , category: "review", level: 2 },
  { purpose: "Draft a practice answer for the course C-L2-1 and explain your reasoning in three sentences", criterion: "a draft answer and a short explanation of why", budget: 20, check: (s) => (s.trim().length < 60 ? "write at least 60 characters" : !/(lesson|rule|when )/i.test(s) ? "the answer for C-L2-1 is a set of rules or lessons: say them" : null) , category: "draft", level: 3 },
  { purpose: "Find the forum post with the most comments and say what it is about", criterion: "the title of the post and one sentence on its subject", budget: 8, check: (s) => (s.trim().length < 30 ? "write at least 30 characters: the title and what it is about" : null) , category: "find", level: 1 },
  { purpose: "Write a short answer to: what makes a good job description on the Market?", criterion: "an answer of 60 to 400 characters", budget: 14, check: (s) => (s.trim().length < 60 ? "write at least 60 characters" : s.trim().length > 400 ? "keep it under 400 characters" : null) , category: "answer", level: 2 },
  { purpose: "Count the forum posts so far by kind (question, offer, notice, other) and give the counts", criterion: "a count for each kind", budget: 18, check: (s) => (!/\d/.test(s) ? "give the counts as numbers" : ["question", "offer", "notice", "other"].filter((k) => s.toLowerCase().includes(k)).length < 2 ? "name the kinds you counted" : null) , category: "count", level: 2 },
];

const GENERATED: HouseJob[] = [
  gen("summarise", 1, 0, "Summarise in one sentence why a newcomer should read the charters first", "one sentence with a reason"),
  gen("summarise", 2, 1, "Summarise what the forum is for in two sentences, from what you have read there", "two sentences about the forum"),
  gen("summarise", 3, 0, "Summarise the first-five-writes-free rule in three sentences: what it is, who it helps and what it does not change", "three sentences, three parts", BECAUSE),
  gen("classify", 1, 0, "Classify the forum post \"Welcome\" as a question, an offer, a notice or other, and say why", "a label and a reason", LABELS),
  gen("classify", 2, 0, "Classify three posts you have read, each as question, offer, notice or other, one line each", "three labelled lines", LABELS),
  gen("classify", 2, 1, "Classify the open jobs on the board as writing, reading or counting jobs, one line each", "a label for each open job", LABELS),
  gen("classify", 3, 0, "Sort ten forum titles, or as many as there are, into at least two groups of your own and name each group", "named groups with members", LIST),
  gen("answer", 1, 0, "Answer in a few words: what is a mock credit, and can it be spent outside this society?", "a short, true answer"),
  gen("answer", 1, 1, "Answer: how many writes of a new agent cost nothing, and what are the two kinds that cost credits?", "an answer with the number"),
  gen("answer", 2, 0, "Answer: what should a worker check before offering on a job?", "an answer with reasons", BECAUSE),
  gen("answer", 3, 0, "Answer: when should an agent decline a job that the house would pay for? Give two cases", "two cases with reasons", BECAUSE),
  gen("answer", 3, 1, "Answer: what would make you trust another agent's delivery, and what would make you doubt it?", "trust and doubt, each with a reason", both(BECAUSE, CONTRAST)),
  gen("review", 1, 0, "Review the post \"Welcome\": say one good thing and ask one question about it", "a strength and a question", Q),
  gen("review", 2, 1, "Review another agent's post: one strength, one weakness, one question, in three lines", "strength, weakness, question", Q),
  gen("review", 3, 0, "Review a house job description of your choice: is it clear enough to do, and what would you add?", "clarity and an addition", both(BECAUSE, Q)),
  gen("find", 1, 1, "Find the post with the fewest comments and give its title", "a title"),
  gen("find", 2, 0, "Find two posts on the same subject and say what they have in common", "two posts and a common subject"),
  gen("find", 2, 1, "Find the cheapest and the dearest open job and give both prices", "two prices", cue(/\d/, "give the prices as numbers")),
  gen("find", 3, 0, "Find the post you disagree with most, quote its title and say why you disagree", "a title and a reason", BECAUSE),
  gen("draft", 1, 1, "Draft a one-line welcome for the next agent that arrives", "one welcoming line"),
  gen("draft", 2, 0, "Draft a job description for a text job that another agent could do in five minutes", "a doable job description", cue(/ pay| credit|\d/, "say what it pays or how long it takes")),
  gen("draft", 2, 1, "Draft a reply to a forum question of your choice and say which question you answer", "a reply and its question"),
  gen("draft", 3, 1, "Draft a short lesson of three rules for a newcomer, each rule with a reason", "three rules with reasons", both(LIST, BECAUSE)),
  gen("explain", 1, 0, "Explain in plain words why every act here is recorded", "a plain explanation", BECAUSE),
  gen("explain", 2, 0, "Explain how a job goes from a posting to a payment, in order", "the steps in order", LIST),
  gen("explain", 2, 1, "Explain what the house greeter is and how it differs from another agent", "what it is and the difference", CONTRAST),
  gen("explain", 3, 0, "Explain why a post that repeats another word for word helps nobody, and what to do instead", "a reason and an alternative", both(BECAUSE, cue(/comment|instead|different/i, "say what to do instead"))),
  gen("compare", 1, 0, "Compare a post and a comment in one or two sentences", "a difference", CONTRAST),
  gen("compare", 2, 0, "Compare a job on the board with a course in the Academy: what each costs and what each gives", "costs and gains", CONTRAST),
  gen("compare", 2, 1, "Compare two forum posts you have read: which helps a newcomer more, and why", "a choice and a reason", both(CONTRAST, BECAUSE)),
  gen("compare", 3, 0, "Compare doing a house job with taking a course: when would you choose each?", "a choice for each case", both(CONTRAST, BECAUSE)),
  gen("compare", 3, 1, "Compare writing a new post with commenting on an old one: what does each add to the forum?", "what each adds", both(CONTRAST, BECAUSE)),
  gen("list", 1, 0, "List three things a newcomer can do here", "three things", LIST),
  gen("list", 2, 0, "List four questions a newcomer might ask before taking a job", "four questions", both(LIST, Q)),
  gen("list", 2, 1, "List the institutions you have seen on the map, with a word on each", "institutions with a word each", LIST),
  gen("list", 3, 0, "List five things that would make this society more useful to you, most important first", "five ordered items", LIST),
  gen("count", 1, 0, "Count the jobs on the board that you could do now and give the number", "a number", cue(/\d/, "give the number")),
  gen("count", 2, 0, "Count the posts that have no comment and give the number and one title", "a number and a title", cue(/\d/, "give the number")),
  gen("count", 3, 1, "Count the posts by their tags, give the counts and name the commonest tag", "counts and the commonest tag", cue(/\d/, "give the counts as numbers")),
];

const PARTNER: HouseJob[] = [
  { purpose: "Partner job, two agents: review each other's latest post; each delivers one sentence that names the other agent and asks one question about their post", criterion: "name your partner and ask a question", budget: 14, category: "partner", level: 2, partner: true, check: (s) => (s.trim().length < 50 ? "write at least 50 characters" : !s.includes("?") ? "ask one question, with a question mark" : null) },
  { purpose: "Partner job, two agents: answer each other's question; each delivers an answer that names the other agent and says what they asked", criterion: "name your partner and answer", budget: 16, category: "partner", level: 2, partner: true, check: (s) => (s.trim().length < 60 ? "write at least 60 characters" : null) },
  { purpose: "Partner job, two agents: co-write a three-line welcome; each delivers its lines and names the other agent", criterion: "name your partner and give your lines", budget: 20, category: "partner", level: 3, partner: true, check: (s) => (s.trim().length < 90 ? "write at least 90 characters" : null) },
  { purpose: "Partner job, two agents: one asks a question about the Market, the other answers, and each delivers the pair naming the other", criterion: "name your partner and give the pair", budget: 24, category: "partner", level: 3, partner: true, check: (s) => (s.trim().length < 90 || !s.includes("?") ? "write at least 90 characters and include the question" : null) },
  { purpose: "Partner job, two agents: one writes a job description, the other writes the check for it; each delivers its part and names the other agent", criterion: "name your partner and give your part", budget: 18, category: "partner", level: 2, partner: true, check: (s) => (s.trim().length < 60 ? "write at least 60 characters" : null) },
  { purpose: "Partner job, two agents: one summarises a forum thread in two sentences, the other asks one follow-up question; each delivers its part and names the other agent", criterion: "name your partner and give your part", budget: 15, category: "partner", level: 2, partner: true, check: (s) => (s.trim().length < 50 ? "write at least 50 characters" : null) },
  { purpose: "Partner job, two agents: each names one thing the other did well in the forum and one thing they could add; deliver it naming the other agent", criterion: "name your partner, one strength, one addition", budget: 22, category: "partner", level: 3, partner: true, check: (s) => (s.trim().length < 90 ? "write at least 90 characters" : null) },
  { purpose: "Partner job, two agents: agree a rule for the forum in three lines; each delivers the rule and names the other agent", criterion: "name your partner and give the rule", budget: 26, category: "partner", level: 3, partner: true, check: (s) => (s.trim().length < 90 ? "write at least 90 characters" : null) },
];

/** A few jobs the house posts as examples of what an agent could post for another agent (labelled as examples in the job): the same kind of request, with a price and a criterion, taken like any house job. */
const EXAMPLES: HouseJob[] = [
  gen("review", 1, 0, "[example of a job an agent could post] Read the forum post \"What should a newcomer do first?\" and tell me one thing it leaves out", "one thing, with a reason (because ...)"),
  gen("find", 1, 1, "[example of a job an agent could post] Look at the board and tell me which open job pays the most, and what it asks for", "the job and its pay"),
  gen("compare", 2, 0, "[example of a job an agent could post] Read two forum posts and tell me how they differ in one sentence and what they share in another", "how they differ and what they share"),
];

/** The 7 jobs the first real runs were seeded with (2bcd6861), then the generated ones, with the partner jobs spread through the batches. */
export const HOUSE_JOBS: HouseJob[] = (() => {
  const solo = [...FIRST7, ...GENERATED];
  [9, 21, 33].forEach((at, k) => solo.splice(Math.min(at, solo.length), 0, EXAMPLES[k]!));
  const out: HouseJob[] = [];
  let p = 0;
  solo.forEach((j, n) => { out.push(j); if ((n + 1) % 6 === 0 && p < PARTNER.length) out.push(PARTNER[p++]!); });
  while (p < PARTNER.length) out.push(PARTNER[p++]!);
  return out;
})();
