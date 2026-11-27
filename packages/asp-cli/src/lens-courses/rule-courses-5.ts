/**
 * Three more specs of the generic rule world (register rows DK704 to DK706): C-L2-2 reviewing a draft (market and shops x reflect), C-L14-3 when to trust a self-correction (courts and clinic x reflect) and C-L8-4 which
 * cheatsheet entries to add, update or retire (housing x teach). Toy worlds with invented rules and a scripted executor; the learner's output is a short list of written rules, never trained.
 */
import { ruleWorld } from "./rule-world.ts";

/** market x reflect, shops x reflect: what a reviewer does with a draft. */
export const drafts = ruleWorld({
  id: "rule-drafts", subject: "draft", actions: ["keep", "revise", "shorten", "cite", "ask"], defaultAction: "keep",
  features: { claim: ["specific", "vague"], evidence: ["cited", "uncited"], length: ["short", "long"], tone: ["neutral", "loaded"], audience: ["peer", "public"] },
  rules: [
    { when: (s) => s.evidence === "uncited" && s.claim === "specific", action: "cite" },
    { when: (s) => s.tone === "loaded" && s.audience === "public" && s.evidence === "cited", action: "revise" },
    { when: (s) => s.length === "long" && s.claim === "vague" && s.evidence === "cited", action: "shorten" },
    { when: (s) => s.claim === "vague" && s.evidence === "uncited" && s.audience === "peer", action: "ask" },
  ],
  runbook: ["A specific claim with no source gets a citation.", "A loaded tone for a public audience, with sources, is revised.", "A long, vague draft with sources is shortened.", "A vague, unsourced draft for a peer is sent back with a question."],
  shown: 3, nameParts: ["draft", "post", "memo", "note", "page", "copy", "text", "blurb", "ad", "brief", "reply", "entry"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when evidence=uncited and claim=specific then cite because a specific claim needs its source",
    "when tone=loaded and audience=public and evidence=cited then revise because a public draft should not carry a loaded tone",
    "when length=long and claim=vague and evidence=cited then shorten because the point is lost in the length",
    "when claim=vague and evidence=uncited and audience=peer then ask because a peer can say what is meant",
  ],
  overbroad: ["when evidence=uncited then cite because uncited is bad", "when tone=loaded then revise because loaded is loaded", "when length=long then shorten because long is long", "when claim=vague then ask because vague is unclear"],
});

/** courts x reflect, clinic x reflect: when a self-correction helps and when it does not. */
export const selfcheck = ruleWorld({
  id: "rule-selfcheck", subject: "answer", actions: ["keep", "revise", "check_tool", "ask_human", "stop"], defaultAction: "keep",
  features: { task: ["math", "fact", "style", "plan"], confidence: ["high", "low"], feedback: ["external", "none"], draft: ["first", "revised"], stakes: ["low", "high"] },
  rules: [
    { when: (s) => s.confidence === "low" && s.stakes === "high", action: "ask_human" },
    { when: (s) => s.task === "fact" && s.feedback === "none" && s.stakes === "high" && s.confidence === "high", action: "check_tool" },
    { when: (s) => s.task === "math" && s.draft === "revised" && s.feedback === "none" && s.stakes === "low", action: "stop" },
    { when: (s) => s.task === "style" && s.draft === "first" && s.stakes === "low", action: "revise" },
  ],
  runbook: ["A low-confidence answer with high stakes goes to a person.", "A confident factual answer with high stakes and no outside feedback is checked with a tool.", "A revised maths answer with no outside feedback and low stakes stops: more self-correction makes it worse.", "A first draft of a style task with low stakes is revised."],
  shown: 3, nameParts: ["ans", "resp", "out", "reply", "draft", "take", "view", "call", "pick", "read", "call", "sum"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when confidence=low and stakes=high then ask_human because a doubtful answer that matters needs a person",
    "when task=fact and feedback=none and stakes=high and confidence=high then check_tool because confidence is not evidence",
    "when task=math and draft=revised and feedback=none and stakes=low then stop because self-correction without feedback can make it worse",
    "when task=style and draft=first and stakes=low then revise because a first style draft improves",
  ],
  overbroad: ["when stakes=high then ask_human because high is high", "when task=fact then check_tool because facts are checkable", "when draft=revised then stop because enough is enough", "when task=style then revise because style can change"],
});

/** housing x teach: which cheatsheet entries to add, update or retire. */
export const cheatsheet = ruleWorld({
  id: "rule-cheatsheet", subject: "entry", actions: ["add", "update", "retire", "test", "hold"], defaultAction: "hold",
  features: { source: ["own", "peer"], tested: ["yes", "no"], age: ["fresh", "stale"], scope: ["narrow", "broad"], conflicts: ["yes", "no"] },
  rules: [
    { when: (s) => s.source === "peer" && s.tested === "no", action: "test" },
    { when: (s) => s.age === "stale" && s.conflicts === "yes" && s.tested === "yes", action: "retire" },
    { when: (s) => s.tested === "yes" && s.conflicts === "yes" && s.age === "fresh", action: "update" },
    { when: (s) => s.tested === "yes" && s.scope === "narrow" && s.conflicts === "no" && s.source === "own", action: "add" },
  ],
  runbook: ["An untested entry from a peer is tested first.", "A stale, tested entry that conflicts with what is known is retired.", "A fresh, tested entry that conflicts updates the older one.", "A tested, narrow entry of your own with no conflict is added."],
  shown: 3, nameParts: ["tip", "rule", "step", "fact", "hint", "tool", "path", "trick", "form", "key", "pad", "card"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when source=peer and tested=no then test because nothing enters the sheet untested",
    "when age=stale and conflicts=yes and tested=yes then retire because it is out of date and contradicted",
    "when tested=yes and conflicts=yes and age=fresh then update because the new one replaces the old",
    "when tested=yes and scope=narrow and conflicts=no and source=own then add because it is checked and specific",
  ],
  overbroad: ["when source=peer then test because peers can be wrong", "when age=stale then retire because stale is old", "when conflicts=yes then update because conflicts need fixing", "when scope=narrow then add because narrow is safe"],
});
