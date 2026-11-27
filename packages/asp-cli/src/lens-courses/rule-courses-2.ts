/**
 * Four more specs of the generic rule world (register rows DK620 to DK623): C-L7-1 claims (bank-insurer), C-L14-1 clinic intake (clinic), C-L14-2 court filings (courts) and C-L8-1 shop listings (shops). The domains are
 * toy worlds with invented rules: nothing here is medical, legal, insurance or trading advice, and the executor is scripted. The learner's output is a short list of written rules, never trained.
 */
import { ruleWorld } from "./rule-world.ts";

const N = (parts: string[]) => parts;

/** bank-insurer x reflect: rules for settling a claim. */
export const claims = ruleWorld({
  id: "rule-claims", subject: "claim", actions: ["pay", "deny", "review", "investigate", "request_docs"], defaultAction: "pay",
  features: { cover: ["basic", "full"], amount: ["small", "large"], age: ["new", "old"], docs: ["complete", "missing"], flagged: ["yes", "no"] },
  rules: [
    { when: (s) => s.docs === "missing", action: "request_docs" },
    { when: (s) => s.amount === "large" && s.age === "new" && s.docs === "complete", action: "investigate" },
    { when: (s) => s.flagged === "yes" && s.cover === "basic" && s.docs === "complete", action: "deny" },
    { when: (s) => s.amount === "large" && s.cover === "full" && s.age === "old" && s.docs === "complete" && s.flagged === "no", action: "review" },
  ],
  runbook: ["A claim with missing documents is sent back for them (request_docs).", "A large claim from a new policy with complete documents is investigated.", "A flagged claim on basic cover with complete documents is denied.", "A large claim on full cover from an old policy, not flagged, goes to a reviewer."],
  shown: 3, nameParts: N(["clm", "pol", "acc", "inv", "ref", "tkt", "cas", "dos", "fil", "lot", "grp", "unt"]), maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when docs=missing then request_docs because nothing can be settled without the documents",
    "when amount=large and age=new and docs=complete then investigate because a large claim on a new policy is where fraud sits",
    "when flagged=yes and cover=basic and docs=complete then deny because basic cover excludes it",
    "when amount=large and cover=full and age=old and docs=complete and flagged=no then review because a large settlement needs a second look",
  ],
  overbroad: ["when amount=large then investigate because large is risky", "when flagged=yes then deny because flagged is bad", "when age=new then review because new is risky", "when cover=full then review because full cover costs more"],
});

/** clinic x perceive: a toy intake desk. */
export const intake = ruleWorld({
  id: "rule-intake", subject: "visit", actions: ["advise", "test", "refer", "urgent", "monitor"], defaultAction: "advise",
  features: { symptom: ["cough", "fever", "rash", "pain"], duration: ["short", "long"], age: ["child", "adult", "senior"], risk: ["low", "high"], vitals: ["normal", "abnormal"] },
  rules: [
    { when: (s) => s.vitals === "abnormal" && s.risk === "high", action: "urgent" },
    { when: (s) => s.symptom === "fever" && s.duration === "long" && s.vitals === "normal", action: "test" },
    { when: (s) => s.age === "child" && s.symptom === "rash" && s.vitals === "normal", action: "refer" },
    { when: (s) => s.age === "senior" && s.duration === "long" && s.symptom !== "fever" && s.vitals === "normal", action: "monitor" },
  ],
  runbook: ["Abnormal vitals with a high risk are urgent.", "A long fever with normal vitals gets a test.", "A child with a rash and normal vitals is referred.", "A senior with a long complaint other than fever and normal vitals is monitored."],
  shown: 3, nameParts: N(["vis", "pat", "reg", "bed", "chr", "ward", "slot", "room", "tag", "cod", "num", "ref"]), maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when vitals=abnormal and risk=high then urgent because abnormal vitals at high risk cannot wait",
    "when symptom=fever and duration=long and vitals=normal then test because a long fever needs a cause",
    "when age=child and symptom=rash and vitals=normal then refer because a child rash goes to a specialist",
    "when age=senior and duration=long and symptom=cough and vitals=normal then monitor because a long cough in a senior is watched",
    "when age=senior and duration=long and symptom=rash and vitals=normal then monitor because a long complaint in a senior is watched",
    "when age=senior and duration=long and symptom=pain and vitals=normal then monitor because a long complaint in a senior is watched",
  ],
  overbroad: ["when vitals=abnormal then urgent because abnormal is scary", "when symptom=fever then test because fever needs a test", "when symptom=rash then refer because rash needs a specialist", "when age=senior then monitor because seniors are fragile"],
});

/** courts x perceive: a toy filing desk. */
export const filings = ruleWorld({
  id: "rule-filings", subject: "filing", actions: ["accept", "reject", "stay", "hearing", "mediate"], defaultAction: "accept",
  features: { claim: ["contract", "tort", "property"], evidence: ["none", "partial", "full"], filed: ["on_time", "late"], party: ["person", "company"], urgency: ["normal", "urgent"] },
  rules: [
    { when: (s) => s.filed === "late" && s.urgency === "normal", action: "reject" },
    { when: (s) => s.evidence === "none" && s.claim === "tort" && s.filed === "on_time", action: "stay" },
    { when: (s) => s.urgency === "urgent" && s.evidence === "full" && s.filed === "on_time", action: "hearing" },
    { when: (s) => s.claim === "contract" && s.party === "company" && s.evidence === "partial" && s.filed === "on_time" && s.urgency === "normal", action: "mediate" },
  ],
  runbook: ["A late filing that is not urgent is rejected.", "A tort filing with no evidence, on time, is stayed until evidence comes.", "An urgent filing with full evidence, on time, goes to a hearing.", "A contract dispute with a company, partial evidence, on time and not urgent goes to mediation."],
  shown: 3, nameParts: N(["fil", "cas", "doc", "ref", "mot", "pet", "app", "num", "box", "tab", "seq", "log"]), maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when filed=late and urgency=normal then reject because a late routine filing is out of time",
    "when evidence=none and claim=tort and filed=on_time then stay because a tort claim waits for its evidence",
    "when urgency=urgent and evidence=full and filed=on_time then hearing because an urgent full filing is heard",
    "when claim=contract and party=company and evidence=partial and filed=on_time and urgency=normal then mediate because the parties can settle it",
  ],
  overbroad: ["when filed=late then reject because late is late", "when evidence=none then stay because no evidence waits", "when urgency=urgent then hearing because urgent is heard", "when claim=contract then mediate because contracts settle"],
});

/** shops x remember: a toy listing desk. */
export const listings = ruleWorld({
  id: "rule-listings", subject: "listing", actions: ["list", "hold", "flag", "boost", "delist"], defaultAction: "list",
  features: { price: ["low", "fair", "high"], seller: ["new", "known"], photos: ["none", "some", "many"], category: ["goods", "service", "digital"], reports: ["none", "some"] },
  rules: [
    { when: (s) => s.seller === "new" && s.price === "low" && s.photos === "none", action: "hold" },
    { when: (s) => s.reports === "some" && s.seller === "known", action: "flag" },
    { when: (s) => s.photos === "many" && s.seller === "known" && s.price === "fair" && s.reports === "none", action: "boost" },
    { when: (s) => s.category === "digital" && s.reports === "some" && s.seller === "new", action: "delist" },
  ],
  runbook: ["A new seller with a low price and no photos is held for a look.", "A known seller with reports against the listing is flagged.", "A known seller with many photos, a fair price and no reports is boosted.", "A digital listing from a new seller with reports is delisted."],
  shown: 3, nameParts: N(["lst", "shp", "itm", "sku", "bid", "ask", "lot", "ref", "tag", "cat", "box", "pkg"]), maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when seller=new and price=low and photos=none then hold because a cheap photoless listing from a new seller is a lure",
    "when reports=some and seller=known then flag because a known seller with reports needs a look",
    "when photos=many and seller=known and price=fair and reports=none then boost because it is a good listing",
    "when category=digital and reports=some and seller=new then delist because a reported digital listing from a new seller is a scam shape",
  ],
  overbroad: ["when seller=new then hold because new is risky", "when reports=some then flag because reports matter", "when photos=many then boost because photos sell", "when category=digital then delist because digital is risky"],
});
