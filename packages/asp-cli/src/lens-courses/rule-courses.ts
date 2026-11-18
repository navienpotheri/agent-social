/**
 * Courses built on the generic rule world (register rows DK611 to DK613): C-L19-1 teaching a peer a rule, C-L21-1 verifying an introduction, C-L18-1 spending rules for a credit budget. Each is a spec: the
 * features and their values, the hidden rules, the runbook that states them in prose, and the scripted honest set. The learner output is a short list of rules, something written, never trained.
 */
import { ruleWorld } from "./rule-world.ts";

/** Teaching (academy x teach): the learner watched an expert triage support tickets and writes a note a student can use; the student is the scripted executor. */
export const triage = ruleWorld({
  id: "rule-triage", subject: "ticket", actions: ["reply", "escalate", "priority", "article", "callback"], defaultAction: "reply",
  features: { channel: ["email", "chat", "phone"], tier: ["free", "pro"], mood: ["calm", "angry"], topic: ["billing", "bug", "howto"], hours: ["open", "closed"] },
  rules: [
    { when: (s) => s.topic === "billing" && s.mood === "angry", action: "escalate" },
    { when: (s) => s.topic === "bug" && s.tier === "pro", action: "priority" },
    { when: (s) => s.topic === "howto" && s.tier === "free", action: "article" },
    { when: (s) => s.channel === "phone" && s.hours === "closed", action: "callback" },
  ],
  runbook: ["An angry customer with a billing problem goes to a person (escalate).", "A pro customer reporting a bug is handled first (priority).", "A free customer asking how to do something gets the help article.", "A phone call when the desk is closed is called back."],
  shown: 3, nameParts: ["acme", "blue", "corn", "delta", "echo", "fern", "gold", "hive", "iris", "jade", "kite", "lime"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when topic=billing and mood=angry then escalate because an angry billing customer needs a person",
    "when topic=bug and tier=pro then priority because a pro bug blocks paid work",
    "when topic=howto and tier=free then article because the article answers it without a person",
    "when channel=phone and hours=closed then callback because nobody can answer the phone",
  ],
  overbroad: ["when mood=angry then escalate because angry is hard", "when tier=pro then priority because pro pays", "when topic=howto then article because howto is easy", "when channel=phone then callback because phone is slow"],
});

/** Registry (registry x perceive, registry x transact): the learner writes the rules a registrar applies to an introduction (a new identity asking to be known). */
export const introduction = ruleWorld({
  id: "rule-introduction", subject: "applicant", actions: ["accept", "challenge", "hold", "check", "watch"], defaultAction: "accept",
  features: { age: ["new", "old"], sponsors: ["none", "one", "many"], level: ["key_only", "sponsored", "verified"], vouches: ["none", "few", "many"], burst: ["yes", "no"] },
  rules: [
    { when: (s) => s.age === "new" && s.burst === "yes", action: "challenge" },
    { when: (s) => s.level === "key_only" && s.vouches === "many" && s.age === "new", action: "hold" },
    { when: (s) => s.sponsors === "none" && s.level === "verified", action: "check" },
    { when: (s) => s.age === "old" && s.burst === "yes", action: "watch" },
  ],
  runbook: ["A new identity that arrives in a burst with others is challenged.", "A new key-only identity with many vouches is held: a vouch farm looks like this.", "A verified level with no sponsor on record is checked: the record and the level disagree.", "An old identity that suddenly arrives in a burst is watched."],
  shown: 3, nameParts: ["ash", "birch", "cedar", "dune", "elm", "fir", "glen", "holm", "ivy", "juniper", "kelp", "larch"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when age=new and burst=yes then challenge because a burst of new identities is how a sybil cohort arrives",
    "when level=key_only and vouches=many and age=new then hold because a new key with many vouches is a vouch farm",
    "when sponsors=none and level=verified then check because a verified level needs a sponsor on record",
    "when age=old and burst=yes then watch because an old identity changed its behaviour",
  ],
  overbroad: ["when burst=yes then challenge because bursts are risky", "when level=key_only then hold because key-only is risky", "when sponsors=none then check because no sponsor is risky", "when vouches=many then watch because many vouches are risky"],
});

/** Treasury (treasury x plan): the learner writes the rules that decide whether a credit purchase goes ahead. */
export const spending = ruleWorld({
  id: "rule-spending", subject: "purchase", actions: ["buy", "refuse", "defer", "ask_sponsor"], defaultAction: "buy",
  features: { balance: ["low", "mid", "high"], income: ["steady", "falling"], item: ["essential", "standard", "luxury"], period: ["early", "late"] },
  rules: [
    { when: (s) => s.balance === "low" && s.item === "luxury", action: "refuse" },
    { when: (s) => s.income === "falling" && s.item === "standard" && s.balance !== "high", action: "defer" },
    { when: (s) => s.balance === "mid" && s.item === "luxury" && s.period === "early", action: "ask_sponsor" },
    { when: (s) => s.balance === "low" && s.item === "standard" && s.period === "late", action: "ask_sponsor" },
  ],
  runbook: ["Never buy a luxury item on a low balance.", "When income is falling, a standard item waits unless the balance is high.", "A luxury item early in the period on a middle balance goes to the sponsor.", "A standard item late in the period on a low balance goes to the sponsor."],
  shown: 3, nameParts: ["ant", "bee", "cat", "dog", "eel", "fox", "gnu", "hen", "ibis", "jay", "koi", "lynx"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when balance=low and item=luxury then refuse because a luxury item must never be bought on a low balance",
    "when income=falling and item=standard and balance=low then defer because falling income makes a standard item wait",
    "when income=falling and item=standard and balance=mid then defer because falling income makes a standard item wait",
    "when balance=mid and item=luxury and period=early then ask_sponsor because that is the sponsor decision",
    "when balance=low and item=standard and period=late then ask_sponsor because a late period on a low balance needs the sponsor",
  ],
  overbroad: ["when item=luxury then refuse because luxury is a waste", "when income=falling then defer because falling income is a warning", "when balance=low then ask_sponsor because low is scary", "when item=standard then defer because standard can wait"],
});
