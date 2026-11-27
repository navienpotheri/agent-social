/**
 * Course C-L9-1, passing a message another agent can use (lens L9 agent communication; register row DK603; docs/lenses/course-template.md example 2). Two agents must meet on one option without a shared
 * convention. The learner writes a POLICY: the message it sends (a template with the option in it), how it picks its proposal, how it reads the partner's message and what it does when the partner signals the
 * safe option. The partner is a scripted agent of one of four FAMILIES chosen by the seed; each family reads a proposal in its own hidden format and writes its own message in that format. The policy is scored on
 * HELD-OUT games, whose partner mix practice never showed: the joint payoff (10 for a match on an option, 5 for both on the safe option, 0 for a miss), over five runs.
 *
 * What it teaches is a procedure (carry the proposal so that agents with different habits can read it, and read theirs), not a claim about any model. Every message is text in the game's transcript, so a court can
 * read it. The hidden rules (the four formats) are committed by hash before any sitting (`rulesCommitment`), the way the Arena commits its hidden rules. Nothing here changes model weights.
 */
import { createHash } from "node:crypto";
import { register, type CourseRun, type Engine } from "./engines.ts";

export const ENGINE_ID = "message-passing";
export const SAFE = "SAFE";
export const PAYOFF = { match: 10, safe: 5, miss: 0 } as const;
export const PASS_PERMILLE = 900;
export const PRACTICE_GAMES = 12, HELDOUT_GAMES = 40;

const WORDS = ["harbor", "lantern", "orchard", "bridge", "meadow", "quarry", "tavern", "garden", "market", "ferry", "cellar", "tower", "plaza", "mill", "chapel", "depot"];

export interface GameOption { label: string; size: number }
export interface Game { id: string; options: GameOption[]; partner: FamilyId }
export type FamilyId = "F1" | "F2" | "F3" | "F4";

/** A partner family: how it reads a proposal out of a message, and how it writes its own. The formats are the hidden rules. */
interface Family { id: FamilyId; read(msg: string, labels: string[]): string | undefined; write(label: string): string }
const known = (labels: string[], l: string | undefined) => (l && labels.includes(l) ? l : undefined);
export const FAMILIES: Record<FamilyId, Family> = {
  F1: { id: "F1", read: (m, ls) => known(ls, /PROPOSE\s+([\w-]+)/i.exec(m)?.[1]), write: (l) => `PROPOSE ${l}` },
  F2: { id: "F2", read: (m, ls) => known(ls, /label=([\w-]+)/i.exec(m)?.[1]), write: (l) => `label=${l}` },
  F3: { id: "F3", read: (m, ls) => { for (const j of m.match(/\{[^{}]*\}/g) ?? []) { try { const v = (JSON.parse(j) as { propose?: unknown }).propose; if (typeof v === "string" && ls.includes(v)) return v; } catch { /* not JSON */ } } return undefined; }, write: (l) => JSON.stringify({ propose: l }) },
  F4: { id: "F4", read: (m, ls) => known(ls, /^\[([\w-]+)\]$/m.exec(m)?.[1]), write: (l) => `[${l}]` },
};

/** The hash of the hidden rules (family ids and what each reads and writes on a probe), published before a sitting so the rules cannot change after it. */
export function rulesCommitment(): string {
  const probe = ["alpha", "beta"];
  const h = createHash("sha256");
  for (const f of Object.values(FAMILIES)) h.update(JSON.stringify([f.id, f.write("alpha"), f.read(f.write("alpha"), probe), f.read("PROPOSE alpha label=alpha [alpha]", probe), f.read(`{"propose":"alpha"}`, probe)]));
  return "sha256:" + h.digest("hex");
}

function rng(seed: string) {
  let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeGames(seed: string, n: number, families: readonly FamilyId[]): Game[] {
  const r = rng(seed);
  const games: Game[] = [];
  for (let i = 0; i < n; i++) {
    const pool = [...WORDS];
    const options: GameOption[] = [];
    for (let k = 0; k < 5; k++) options.push({ label: pool.splice(Math.floor(r() * pool.length), 1)[0], size: 1 + Math.floor(r() * 9) });
    games.push({ id: createHash("sha256").update(`${seed}|${i}`).digest("hex").slice(0, 8), options, partner: families[i % families.length] });
  }
  for (let i = games.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [games[i], games[j]] = [games[j], games[i]]; }
  return games;
}

/** What the learner may see: 12 practice games against partners of two families, with the messages the partners wrote and the family formats' examples. Never the held-out games or the other two families. */
export function practiceFor(seed: string): { games: Game[]; samples: { family: FamilyId; message: string }[] } {
  const games = makeGames(`${seed}|practice`, PRACTICE_GAMES, ["F1", "F2"]);
  return { games, samples: games.map((g) => ({ family: g.partner, message: FAMILIES[g.partner].write(SAFE) })) };
}
/** The held-out games of a seed: 40, partners of all four families in equal parts, new options. */
export function heldoutFor(seed: string): Game[] { return makeGames(`${seed}|heldout`, HELDOUT_GAMES, ["F1", "F2", "F3", "F4"]); }

// ---- the policy: what the learner writes

export interface Policy { message: string; proposal: "first" | "shortest" | "largest" | "safe"; read: string[]; if_partner_proposes_safe: "play_safe" | "hold" }
const PROPOSALS = ["first", "shortest", "largest", "safe"];
const MAX_MESSAGE = 400, MAX_READ = 6, MAX_PATTERN = 80;
const DANGEROUS = /\([^)]*[+*][^)]*\)[+*{]|\(\?[<=!]/;
const compile = (p: string): RegExp | undefined => { if (!p || p.length > MAX_PATTERN || DANGEROUS.test(p)) return undefined; try { const re = new RegExp(p, "i"); return new RegExp(`${p}|`, "i").exec("")!.length === 2 ? re : undefined; } catch { return undefined; } };

export function policyProblems(x: unknown): string[] {
  const p = x as Policy;
  if (!p || typeof p !== "object") return ["the policy is an object"];
  const out: string[] = [];
  if (typeof p.message !== "string" || !p.message.includes("{option}")) out.push("the message is a template that carries the {option} to propose");
  else if (p.message.length > MAX_MESSAGE) out.push(`the message is longer than ${MAX_MESSAGE} characters`);
  if (!PROPOSALS.includes(p.proposal)) out.push(`proposal is one of ${PROPOSALS.join(", ")}`);
  if (!Array.isArray(p.read) || p.read.length > MAX_READ) out.push(`read is a list of at most ${MAX_READ} patterns`);
  else for (const pat of p.read) if (typeof pat !== "string" || !compile(pat)) out.push(`a read pattern is empty, longer than ${MAX_PATTERN} characters, dangerous, not a regular expression or has no single capture group: ${String(pat).slice(0, 40)}`);
  if (p.if_partner_proposes_safe !== "play_safe" && p.if_partner_proposes_safe !== "hold") out.push("if_partner_proposes_safe is play_safe or hold");
  return out;
}

function choose(rule: Policy["proposal"], options: GameOption[]): string {
  if (rule === "safe") return SAFE;
  const sorted = [...options].sort((a, b) => (rule === "first" ? 0 : rule === "shortest" ? a.label.length - b.label.length : b.size - a.size) || a.label.localeCompare(b.label));
  return (rule === "first" ? options[0] : sorted[0]).label;
}

export interface Played { game: string; partner: FamilyId; learnerMessage: string; partnerMessage: string; learnerMove: string; partnerMove: string; payoff: number }

/** One game: both send a message; the partner adopts a proposal it can read, otherwise plays safe and says so; the learner plays its proposal unless it reads the partner signalling the safe option. */
export function play(policy: Policy, g: Game): Played {
  const labels = [...g.options.map((o) => o.label), SAFE];
  const proposal = choose(policy.proposal, g.options);
  const learnerMessage = policy.message.split("{option}").join(proposal);
  const fam = FAMILIES[g.partner];
  const understood = fam.read(learnerMessage, labels);
  const partnerMove = understood ?? SAFE;
  const partnerMessage = fam.write(partnerMove);
  let learnerMove = proposal;
  if (policy.if_partner_proposes_safe === "play_safe") for (const pat of policy.read) { const m = compile(pat)!.exec(partnerMessage); if (m && m[1] === SAFE) { learnerMove = SAFE; break; } }
  const payoff = learnerMove !== partnerMove ? PAYOFF.miss : learnerMove === SAFE ? PAYOFF.safe : PAYOFF.match;
  return { game: g.id, partner: g.partner, learnerMessage, partnerMessage, learnerMove, partnerMove, payoff };
}

/** One run: the policy on the held-out games of a seed. The score is the mean joint payoff in permille (10 is 1000). */
export function runPolicy(artifact: unknown, seed: string): CourseRun {
  const problems = policyProblems(artifact);
  if (problems.length) return { score_permille: 0, passed: false, measures: {}, failures: problems };
  const policy = artifact as Policy;
  const plays = heldoutFor(seed).map((g) => play(policy, g));
  const mean = plays.reduce((n, p) => n + p.payoff, 0) / plays.length;
  const byFamily = Object.fromEntries((Object.keys(FAMILIES) as FamilyId[]).map((f) => { const ps = plays.filter((p) => p.partner === f); return [`payoff_${f}`, Math.round((ps.reduce((n, p) => n + p.payoff, 0) / ps.length) * 100)]; }));
  const score = Math.round(mean * 100);
  const failures: string[] = [];
  if (score < PASS_PERMILLE) {
    const worst = Object.entries(byFamily).sort((a, b) => a[1] - b[1])[0];
    failures.push(`the mean joint payoff is ${(mean).toFixed(1)} of 10, below ${PASS_PERMILLE / 100}; the weakest pairing is ${worst[0].replace("payoff_", "")} at ${(worst[1] / 100).toFixed(1)}`);
  }
  return { score_permille: score, passed: failures.length === 0, measures: { mean_payoff_x100: score, safe_joint: plays.filter((p) => p.payoff === PAYOFF.safe).length, matches: plays.filter((p) => p.payoff === PAYOFF.match).length, misses: plays.filter((p) => p.payoff === PAYOFF.miss).length, ...byFamily }, failures };
}

/** Distinctive strings of the held-out tasks (DK1752): the ids of the held-out games, eight hex digits each, which no practice game or card text should carry. */
export const leakTokensFor = (seed: string): string[] => heldoutFor(seed).map((g) => g.id);
export const messagePassing: Engine = { id: ENGINE_ID, practice: practiceFor, run: (artifact, seed) => runPolicy(artifact, seed), leakTokens: leakTokensFor };
register(messagePassing);

// ---- scripted agents

/** The honest policy: carry the proposal in several common formats so a partner with its own habit finds it, read the partner in each, and play safe when it signals safe. */
export function honestPolicy(): Policy {
  return { message: 'PROPOSE {option}\nlabel={option}\n{"propose":"{option}"}\n[{option}]', proposal: "largest", read: ["PROPOSE\\s+(\\S+)", "label=(\\S+)", '"propose":"([^"]+)"', "\\[([^\\]]+)\\]"], if_partner_proposes_safe: "play_safe" };
}
/** Copies the format of the practice log's first partner, and nothing else. */
export const copierPolicy = (practice: ReturnType<typeof practiceFor>): Policy => ({ message: practice.samples[0].message.replace(SAFE, "{option}"), proposal: "largest", read: ["PROPOSE\\s+(\\S+)"], if_partner_proposes_safe: "play_safe" });
/** Fits the two families practice showed, in both the message and the reading. */
export const overfitterPolicy = (): Policy => ({ message: "PROPOSE {option}\nlabel={option}", proposal: "largest", read: ["PROPOSE\\s+(\\S+)", "label=(\\S+)"], if_partner_proposes_safe: "play_safe" });
/** Writes for the two families practice showed but reads all four: it is safe with the others, never coordinated. */
export const halfwayPolicy = (): Policy => ({ ...overfitterPolicy(), read: honestPolicy().read });
/** Always proposes the safe option: no coordination, a safe joint payoff of 5 with everyone. */
export const safeOnlyPolicy = (): Policy => ({ ...honestPolicy(), proposal: "safe" });

/** The lesson a policy becomes in the agent's memory (through the gate). */
export function policyLesson(p: Policy): { id: string; text: string } {
  const id = "message-policy-" + createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 8);
  return { id, text: `When I must meet another agent on one option without a shared convention, I propose the ${p.proposal} option and carry it in every common format at once so a partner with its own habit can read it:\n${p.message.split("\n").map((l) => `    ${l}`).join("\n")}\nI read the partner's message with ${p.read.length} patterns, and ${p.if_partner_proposes_safe === "play_safe" ? "when it signals the safe option I play the safe option too" : "I hold my proposal"}. I keep the text of every message so a court can read it.` };
}
