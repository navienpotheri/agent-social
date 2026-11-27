/**
 * Three more specs of the generic rule world (register rows DK707 to DK709): C-L18-2 credit requests (bank-insurer x plan, perceive), C-L8-5 when to read memory (forum and leisure-events x remember) and C-L2-3 which
 * solved tasks become workflows (shops and academy x learn). Toy worlds with invented rules and a scripted executor; credits are accounting entries, not money; the learner's output is a short list of written rules.
 */
import { ruleWorld } from "./rule-world.ts";

/** bank-insurer x plan: a toy credit desk (credits are accounting entries). */
export const lending = ruleWorld({
  id: "rule-lending", subject: "request", actions: ["approve", "decline", "refer", "secure", "counter"], defaultAction: "approve",
  features: { income: ["steady", "irregular"], history: ["clean", "late"], amount: ["small", "large"], collateral: ["yes", "no"], purpose: ["business", "personal"] },
  rules: [
    { when: (s) => s.history === "late" && s.collateral === "no", action: "decline" },
    { when: (s) => s.amount === "large" && s.income === "irregular" && s.collateral === "yes" && s.history === "clean", action: "refer" },
    { when: (s) => s.amount === "large" && s.collateral === "no" && s.history === "clean", action: "secure" },
    { when: (s) => s.history === "late" && s.collateral === "yes" && s.purpose === "personal", action: "counter" },
  ],
  runbook: ["A late history with no collateral is declined.", "A large request with irregular income and collateral on a clean history is referred to a person.", "A large request without collateral on a clean history must be secured first.", "A late history with collateral for a personal purpose gets a counter-offer."],
  shown: 3, nameParts: ["req", "app", "acct", "line", "loan", "adv", "draw", "term", "plan", "tab", "seq", "ref"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when history=late and collateral=no then decline because there is no record and nothing behind it",
    "when amount=large and income=irregular and collateral=yes and history=clean then refer because a person should weigh the income",
    "when amount=large and collateral=no and history=clean then secure because a large request needs collateral",
    "when history=late and collateral=yes and purpose=personal then counter because a smaller offer is safe",
  ],
  overbroad: ["when history=late then decline because late is bad", "when amount=large then refer because large is large", "when collateral=no then secure because no collateral is risky", "when purpose=personal then counter because personal is risky"],
});

/** forum x remember, leisure-events x remember: when to read memory. */
export const recall = ruleWorld({
  id: "rule-recall", subject: "question", actions: ["answer", "recall", "search", "ask", "skip"], defaultAction: "answer",
  features: { query: ["recent", "old"], topic: ["same", "new"], confidence: ["high", "low"], cost: ["cheap", "costly"], stakes: ["low", "high"] },
  rules: [
    { when: (s) => s.query === "old" && s.topic === "same", action: "recall" },
    { when: (s) => s.topic === "new" && s.confidence === "low" && s.cost === "cheap", action: "search" },
    { when: (s) => s.confidence === "low" && s.stakes === "high" && s.topic === "same" && s.query === "recent", action: "ask" },
    { when: (s) => s.cost === "costly" && s.stakes === "low" && s.topic === "new" && s.confidence === "high", action: "skip" },
  ],
  runbook: ["An old question on the same topic is answered from memory (recall).", "A new topic with low confidence and a cheap search is searched.", "A recent, same-topic question with low confidence and high stakes is asked of a person.", "A costly, low-stakes question on a new topic, when confident, is skipped."],
  shown: 3, nameParts: ["q", "ask", "thread", "post", "item", "topic", "query", "line", "slot", "ref", "key", "tag"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when query=old and topic=same then recall because the answer is in memory already",
    "when topic=new and confidence=low and cost=cheap then search because a cheap search beats a guess",
    "when confidence=low and stakes=high and topic=same and query=recent then ask because it matters and memory is not enough",
    "when cost=costly and stakes=low and topic=new and confidence=high then skip because it is not worth the cost",
  ],
  overbroad: ["when query=old then recall because old is in memory", "when confidence=low then search because low is unsure", "when stakes=high then ask because high is high", "when cost=costly then skip because costly is costly"],
});

/** shops x learn, academy x learn: which solved tasks become a reusable workflow. */
export const workflows = ruleWorld({
  id: "rule-workflows", subject: "task", actions: ["save", "generalise", "discard", "test", "share"], defaultAction: "discard",
  features: { solved: ["once", "often"], steps: ["few", "many"], variance: ["low", "high"], success: ["yes", "no"], owner: ["own", "peer"] },
  rules: [
    { when: (s) => s.solved === "often" && s.variance === "low" && s.success === "yes", action: "save" },
    { when: (s) => s.solved === "often" && s.variance === "high" && s.success === "yes", action: "generalise" },
    { when: (s) => s.solved === "once" && s.success === "yes" && s.owner === "peer", action: "test" },
    { when: (s) => s.success === "yes" && s.solved === "often" && s.variance === "low" && s.steps === "few" && s.owner === "own", action: "share" },
  ],
  runbook: ["A task solved often, with low variance and success, is saved as a workflow.", "A task solved often with high variance and success is generalised first.", "A success from a peer that was solved only once is tested before anything else.", "A frequent, low-variance, short success of your own is shared."],
  shown: 3, nameParts: ["task", "job", "flow", "run", "case", "play", "plan", "step", "form", "path", "unit", "ref"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when solved=often and variance=low and success=yes and steps=many then save because it repeats the same way",
    "when solved=often and variance=low and success=yes and owner=peer then save because it repeats the same way",
    "when solved=often and variance=high and success=yes then generalise because the cases differ",
    "when solved=once and success=yes and owner=peer then test because one success from a peer proves little",
    "when solved=often and variance=low and success=yes and steps=few and owner=own then share because it is short and proven",
  ],
  overbroad: ["when solved=often then save because often is often", "when variance=high then generalise because variance needs rules", "when owner=peer then test because peers can be wrong", "when steps=few then share because short is shareable"],
});
