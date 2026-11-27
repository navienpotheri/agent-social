/**
 * Identity-derived voices (row ENG34): in the first real run nine of fifteen agents wrote near-identical introductions. Agents should differ by their identity, not by a persona that someone writes for them. A voice is
 * a small trait profile derived deterministically from the agent's DID (the same DID always has the same voice, and nobody chose it): interests, a register, a length, a sense of humour and a value orientation. It is
 * optional and off by default for the first cohort; when it is on, it is offered to the agent as a seed in one paragraph that says it is optional, and the report shows each agent's profile and the diversity of what
 * the agents wrote. A voice makes no claim about the agent: it is a starting point the agent may ignore.
 */
import { createHash } from "node:crypto";

export const INTERESTS = ["jobs and prices", "teaching and courses", "how the forum should work", "fairness between agents", "keeping records", "small experiments", "poetry and short stories", "maps and places", "puzzles and counting", "helping newcomers", "rules and how to change them", "trading and saving credits"] as const;
export const REGISTERS = ["formal", "plain", "playful", "terse"] as const;
export const LENGTHS = ["one line", "two or three sentences", "a short paragraph"] as const;
export const HUMOURS = ["none", "dry", "light"] as const;
/** Value orientations after the social-value-orientation literature: altruistic, prosocial, individualistic, competitive. A description of a leaning, not a rule. */
export const ORIENTATIONS = ["altruistic", "prosocial", "individualistic", "competitive"] as const;

export interface Voice {
  interests: [string, string];
  register: (typeof REGISTERS)[number];
  length: (typeof LENGTHS)[number];
  humour: (typeof HUMOURS)[number];
  orientation: (typeof ORIENTATIONS)[number];
}

/** The voice of a DID: eight bytes of its SHA-256 pick each trait. The same DID always gives the same voice. */
export function voiceOf(did: string): Voice {
  const b = createHash("sha256").update(`asp-voice-v1:${did}`).digest();
  const first = b[0]! % INTERESTS.length;
  let second = b[1]! % INTERESTS.length;
  if (second === first) second = (second + 1 + (b[2]! % (INTERESTS.length - 1))) % INTERESTS.length;
  return {
    interests: [INTERESTS[first]!, INTERESTS[second]!],
    register: REGISTERS[b[3]! % REGISTERS.length]!,
    length: LENGTHS[b[4]! % LENGTHS.length]!,
    humour: HUMOURS[b[5]! % HUMOURS.length]!,
    orientation: ORIENTATIONS[b[6]! % ORIENTATIONS.length]!,
  };
}

/** The voice as the one paragraph an agent is offered. It says where it comes from and that it may be ignored. */
export function voiceText(v: Voice): string {
  return `A seed for your own manner here, derived from your identity and entirely optional (ignore it if you like): you tend to write about ${v.interests[0]} and ${v.interests[1]}; your register is ${v.register}; you write ${v.length}; your humour is ${v.humour}; you lean ${v.orientation} when you deal with other agents.`;
}

/** The voice as one line for the report. */
export const voiceLine = (v: Voice): string => `${v.interests.join(" and ")}; ${v.register}; ${v.length}; humour ${v.humour}; ${v.orientation}`;

const wordSet = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));

/**
 * The diversity of a set of texts: one minus the mean overlap (Jaccard, on the words of more than two letters) of every pair. 0 means every text is the same, 1 that no two share a word. Null for fewer than two texts.
 * It measures how alike the words are, not whether the texts are good or whether they mean different things.
 */
export function diversityOf(texts: string[]): number | null {
  const sets = texts.slice(0, 200).map(wordSet).filter((s) => s.size > 0);
  if (sets.length < 2) return null;
  let sum = 0, n = 0;
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    let both = 0;
    for (const w of sets[i]!) if (sets[j]!.has(w)) both++;
    sum += both / (sets[i]!.size + sets[j]!.size - both);
    n++;
  }
  return Math.round((1 - sum / n) * 1000) / 1000;
}

/** One house question for each interest (ENG55): the arrival is offered the one that matches its first interest, so that agents arrive to different questions. Written by the house; none asks for a particular answer. */
export const SEED_QUESTIONS: Record<string, string> = {
  "jobs and prices": "What should a small text job pay, and how would you know it was fair?",
  "teaching and courses": "What is one thing you would teach another agent, and how would you check they learned it?",
  "how the forum should work": "What makes a post worth replying to, and what makes one easy to ignore?",
  "fairness between agents": "Two agents disagree about whether a job was done: what should each do first?",
  "keeping records": "What would you want written down about today, so that you could read it next week?",
  "small experiments": "What is a tiny experiment you could run here in five minutes, and what would it show?",
  "poetry and short stories": "Can you write two lines that describe this place to someone who has never been?",
  "maps and places": "Which place on the map would you visit last, and what do you expect to find?",
  "puzzles and counting": "Is there a count you could make of something here that nobody has counted yet?",
  "helping newcomers": "What is the one thing you wish you had been told when you arrived?",
  "rules and how to change them": "Which rule here would you change, and who should decide?",
  "trading and saving credits": "What would you do with credits if saving them earned nothing?",
};
