/**
 * Three more specs of the generic rule world (register rows DK701 to DK703): C-L11-2 which writes a registry accepts (registry x act), C-L8-2 what a court or treasury keeps (courts and treasury x remember) and C-L8-3
 * research notes worth keeping (research-commons x remember). Toy worlds with invented rules and a scripted executor; the learner's output is a short list of written rules, never trained.
 */
import { ruleWorld } from "./rule-world.ts";

/** registry x act: handling a write to the registry. */
export const writes = ruleWorld({
  id: "rule-writes", subject: "write", actions: ["append", "reject", "quarantine", "rate_limit", "flag"], defaultAction: "append",
  features: { signer: ["valid", "invalid"], age: ["new", "old"], rate: ["normal", "burst"], chain: ["intact", "broken"], scope: ["inside", "outside"] },
  rules: [
    { when: (s) => s.signer === "invalid", action: "reject" },
    { when: (s) => s.signer === "valid" && s.chain === "broken", action: "quarantine" },
    { when: (s) => s.signer === "valid" && s.chain === "intact" && s.rate === "burst" && s.age === "new", action: "rate_limit" },
    { when: (s) => s.signer === "valid" && s.chain === "intact" && s.scope === "outside" && s.rate === "normal", action: "flag" },
  ],
  runbook: ["A write with an invalid signature is rejected.", "A valid write on a broken chain is quarantined.", "A valid write on an intact chain in a burst from a new identity is rate-limited.", "A valid write on an intact chain, outside its scope, at a normal rate, is flagged."],
  shown: 3, nameParts: ["rec", "ent", "blk", "seq", "tx", "msg", "doc", "evt", "row", "key", "tag", "log"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when signer=invalid then reject because an unsigned or wrongly signed write is not a write",
    "when signer=valid and chain=broken then quarantine because the chain no longer proves what came before",
    "when signer=valid and chain=intact and rate=burst and age=new then rate_limit because a new identity in a burst is slowed",
    "when signer=valid and chain=intact and scope=outside and rate=normal then flag because it went beyond its Mandate",
  ],
  overbroad: ["when chain=broken then quarantine because broken is broken", "when rate=burst then rate_limit because bursts are risky", "when age=new then flag because new is risky", "when scope=outside then reject because outside is out"],
});

/** courts x remember, treasury x remember: what a record keeper retains. */
export const retention = ruleWorld({
  id: "rule-retention", subject: "record", actions: ["keep", "archive", "summarise", "drop", "seal"], defaultAction: "keep",
  features: { kind: ["filing", "ledger", "chat", "draft"], age: ["recent", "old"], use: ["often", "never"], dispute: ["open", "closed"], size: ["small", "large"] },
  rules: [
    { when: (s) => s.dispute === "open" && s.kind === "filing", action: "seal" },
    { when: (s) => s.age === "old" && s.use === "never" && s.kind === "draft", action: "drop" },
    { when: (s) => s.age === "old" && s.size === "large" && s.kind === "chat" && s.dispute === "closed", action: "summarise" },
    { when: (s) => s.age === "old" && s.use === "never" && s.kind === "ledger" && s.dispute === "closed", action: "archive" },
  ],
  runbook: ["A filing in an open dispute is sealed.", "An old draft nobody uses is dropped.", "An old, large chat from a closed dispute is summarised.", "An old ledger entry nobody uses, from a closed dispute, is archived."],
  shown: 3, nameParts: ["rec", "fil", "led", "log", "note", "mem", "doc", "ref", "box", "vol", "bin", "set"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when dispute=open and kind=filing then seal because a filing in an open dispute must not change",
    "when age=old and use=never and kind=draft then drop because an unused old draft has no value",
    "when age=old and size=large and kind=chat and dispute=closed then summarise because the gist is enough",
    "when age=old and use=never and kind=ledger and dispute=closed then archive because it is needed only for audit",
  ],
  overbroad: ["when dispute=open then seal because open is open", "when use=never then drop because unused", "when size=large then summarise because large is long", "when age=old then archive because old is old"],
});

/** research-commons x remember: which research notes to keep. */
export const notes = ruleWorld({
  id: "rule-notes", subject: "note", actions: ["keep", "merge", "link", "drop", "verify"], defaultAction: "keep",
  features: { source: ["own", "other"], novelty: ["new", "repeat"], support: ["strong", "weak"], topic: ["method", "result", "idea"], links: ["none", "many"] },
  rules: [
    { when: (s) => s.novelty === "repeat" && s.source === "own", action: "merge" },
    { when: (s) => s.novelty === "new" && s.support === "weak" && s.source === "other", action: "verify" },
    { when: (s) => s.links === "many" && s.novelty === "new" && s.support === "strong", action: "link" },
    { when: (s) => s.topic === "idea" && s.support === "weak" && s.novelty === "repeat" && s.source === "other", action: "drop" },
  ],
  runbook: ["A repeat of your own note is merged into the earlier one.", "A new, weakly supported note from another source is verified before it is kept.", "A new, strongly supported note with many links is linked into the graph.", "A weak repeat idea from another source is dropped."],
  shown: 3, nameParts: ["n", "memo", "card", "item", "page", "slip", "snip", "clip", "thread", "entry", "line", "scrap"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when novelty=repeat and source=own then merge because it says what an earlier note said",
    "when novelty=new and support=weak and source=other then verify because an unsupported claim from outside is checked first",
    "when links=many and novelty=new and support=strong then link because it belongs in the graph",
    "when topic=idea and support=weak and novelty=repeat and source=other then drop because it adds nothing",
  ],
  overbroad: ["when novelty=repeat then merge because repeats merge", "when support=weak then verify because weak needs checking", "when links=many then link because links are good", "when topic=idea then drop because ideas are cheap"],
});
