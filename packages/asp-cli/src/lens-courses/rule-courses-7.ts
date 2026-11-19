/**
 * Three more specs of the generic rule world (register rows DK711 to DK713): C-L8-6 which fact supersedes which (bank-insurer, treasury and registry x remember), C-L7-2 how to report a confidence (treasury and
 * bank-insurer x reflect) and C-L20-2 which demonstration to turn into an abstraction (academy and housing x learn). Toy worlds with invented rules and a scripted executor; the learner's output is a short list of
 * written rules, never trained.
 */
import { ruleWorld } from "./rule-world.ts";

/** bank-insurer x remember, treasury x remember: a fact store that keeps time. */
export const facts = ruleWorld({
  id: "rule-facts", subject: "fact", actions: ["replace", "keep_both", "discard", "flag", "merge"], defaultAction: "keep_both",
  features: { recency: ["newer", "older"], source: ["primary", "secondary"], agree: ["yes", "no"], scope: ["same", "different"], validity: ["open", "closed"] },
  rules: [
    { when: (s) => s.recency === "newer" && s.source === "primary" && s.agree === "no" && s.scope === "same", action: "replace" },
    { when: (s) => s.recency === "older" && s.source === "secondary" && s.agree === "no", action: "discard" },
    { when: (s) => s.agree === "no" && s.source === "secondary" && s.recency === "newer" && s.validity === "open", action: "flag" },
    { when: (s) => s.agree === "yes" && s.scope === "same" && s.validity === "open", action: "merge" },
  ],
  runbook: ["A newer primary fact that disagrees on the same scope replaces the old one.", "An older secondary fact that disagrees is discarded.", "A newer secondary fact that disagrees, while the question is open, is flagged for a check.", "Two facts that agree on the same scope, while it is open, are merged."],
  shown: 3, nameParts: ["fact", "claim", "entry", "stmt", "note", "item", "line", "datum", "node", "edge", "ref", "tag"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when recency=newer and source=primary and agree=no and scope=same then replace because the newer primary fact supersedes",
    "when recency=older and source=secondary and agree=no then discard because it is old and second-hand",
    "when agree=no and source=secondary and recency=newer and validity=open then flag because it needs a check",
    "when agree=yes and scope=same and validity=open then merge because they say the same thing",
  ],
  overbroad: ["when recency=newer then replace because newer is newer", "when source=secondary then discard because second-hand is weak", "when agree=no then flag because disagreement needs a look", "when agree=yes then merge because they agree"],
});

/** treasury x reflect, bank-insurer x reflect: how to state a confidence. */
export const confidence = ruleWorld({
  id: "rule-confidence", subject: "claim", actions: ["state", "hedge", "abstain", "verify", "escalate"], defaultAction: "state",
  features: { evidence: ["strong", "weak"], track: ["good", "poor"], claim: ["routine", "unusual"], stakes: ["low", "high"], age: ["fresh", "stale"] },
  rules: [
    { when: (s) => s.evidence === "weak" && s.claim === "unusual" && s.stakes === "high", action: "abstain" },
    { when: (s) => s.evidence === "weak" && s.track === "poor" && s.stakes === "low", action: "hedge" },
    { when: (s) => s.age === "stale" && s.evidence === "strong" && s.stakes === "high", action: "verify" },
    { when: (s) => s.claim === "unusual" && s.track === "poor" && s.evidence === "strong" && s.stakes === "high" && s.age === "fresh", action: "escalate" },
  ],
  runbook: ["Weak evidence for an unusual claim with high stakes: abstain.", "Weak evidence from a poor track record with low stakes: hedge.", "Strong but stale evidence with high stakes: verify it again.", "A fresh, strongly supported but unusual claim from a poor track record with high stakes goes to a person."],
  shown: 3, nameParts: ["claim", "call", "est", "view", "bet", "line", "read", "take", "stmt", "fcst", "item", "ref"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when evidence=weak and claim=unusual and stakes=high then abstain because a thin unusual claim that matters is not stated",
    "when evidence=weak and track=poor and stakes=low then hedge because the record does not earn confidence",
    "when age=stale and evidence=strong and stakes=high then verify because old evidence may have moved",
    "when claim=unusual and track=poor and evidence=strong and stakes=high and age=fresh then escalate because a person should sign off",
  ],
  overbroad: ["when evidence=weak then abstain because weak is weak", "when track=poor then hedge because poor is poor", "when age=stale then verify because stale is old", "when claim=unusual then escalate because unusual is risky"],
});

/** academy x learn, housing x learn: which demonstration to abstract. */
export const demos = ruleWorld({
  id: "rule-demos", subject: "demonstration", actions: ["abstract", "store", "drop", "retry", "ask"], defaultAction: "store",
  features: { demos: ["one", "many"], outcome: ["good", "bad"], noise: ["low", "high"], novelty: ["new", "seen"], fit: ["close", "far"] },
  rules: [
    { when: (s) => s.demos === "many" && s.outcome === "good" && s.noise === "low", action: "abstract" },
    { when: (s) => s.outcome === "bad" && s.noise === "high", action: "drop" },
    { when: (s) => s.outcome === "bad" && s.noise === "low" && s.fit === "close", action: "retry" },
    { when: (s) => s.novelty === "new" && s.fit === "far" && s.demos === "one" && s.outcome === "good", action: "ask" },
  ],
  runbook: ["Many good, low-noise demonstrations are abstracted into one reusable example.", "A bad, noisy demonstration is dropped.", "A bad, clean demonstration that is close to the task is retried.", "A single good, new demonstration far from the task is asked about before anything is learned."],
  shown: 3, nameParts: ["demo", "trace", "run", "ep", "shot", "case", "ex", "play", "log", "seq", "take", "rep"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when demos=many and outcome=good and noise=low then abstract because they agree and are clean",
    "when outcome=bad and noise=high then drop because there is nothing reliable in it",
    "when outcome=bad and noise=low and fit=close then retry because the failure is informative and near",
    "when novelty=new and fit=far and demos=one and outcome=good then ask because one distant success is not a pattern",
  ],
  overbroad: ["when demos=many then abstract because many is many", "when outcome=bad then drop because bad is bad", "when fit=close then retry because close is close", "when novelty=new then ask because new is unknown"],
});
