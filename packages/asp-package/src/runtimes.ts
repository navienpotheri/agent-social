/**
 * The runtimes `asp run <runtime>` can start as a governed session, as data (docs/portability-at-scale.md): how a runtime is reached, what the tool needs to be started, what to tell a person whose
 * tool did not start, and the evidence behind what we claim for it. The support matrix (`asp runtimes`) is printed from this, so a claim and its evidence sit in one place and a test fails if a
 * descriptor claims a level its way of reaching the runtime cannot give.
 */

/** How a runtime is held to the Mandate: the local gateway (any agent that can be pointed at an API), or the runtime's own pre-call hook. */
export type RuntimeReach = "gateway" | "hook";
/** The API a gateway-reached tool talks to, so the gateway points at the right kind of upstream; `hooked` for a runtime held by its own hook. */
export type RuntimeWire = "anthropic" | "openai" | "hooked";
/** What the run's evidence supports, from the strongest practical level (assurance ladder in docs/ladder.md). */
export type RuntimeAssurance = "gateway_enforced" | "hook_enforced";
/** `live`: run by hand on a real machine; `partial`: run live with known gaps; `stand-in`: tested only with a stand-in for the tool. */
export type RuntimeEvidence = "live" | "partial" | "stand-in";

export interface RuntimeDescriptor {
  name: string;
  /** The name a person knows it by. */
  title: string;
  reach: RuntimeReach;
  wire: RuntimeWire;
  /** The tool can only be started with a task (no interactive mode here). */
  needsPrompt: boolean;
  /** A model has to be named. */
  needsModel: boolean;
  /** What to tell a person whose tool did not start (ends with a comma: the sentence goes on). */
  installHint: string;
  /** The highest assurance a run of it reaches when it does what it should. */
  assurance: RuntimeAssurance;
  evidence: { level: RuntimeEvidence; row: string; note: string };
}

export const RUNTIMES: RuntimeDescriptor[] = [
  { name: "claude-code", title: "Claude Code", reach: "gateway", wire: "anthropic", needsPrompt: false, needsModel: false,
    installHint: "Install Claude Code (https://claude.com/claude-code), sign in once by running `claude`,", assurance: "gateway_enforced",
    evidence: { level: "live", row: "UC-10", note: "run by hand: allowed calls run, a call outside the Mandate is removed before the agent sees it; interactive and headless" } },
  { name: "codex", title: "Codex", reach: "gateway", wire: "openai", needsPrompt: true, needsModel: false,
    installHint: "Install the Codex CLI (`npm install -g @openai/codex`),", assurance: "gateway_enforced",
    evidence: { level: "live", row: "UC-11", note: "run by hand on an OpenRouter key and a free model; an OpenAI key not tried" } },
  { name: "goose", title: "Goose", reach: "gateway", wire: "openai", needsPrompt: true, needsModel: true,
    installHint: "Install Goose,", assurance: "gateway_enforced",
    evidence: { level: "stand-in", row: "UC-12", note: "tested with a stand-in; run live in an earlier evaluation but not through `asp run`" } },
  { name: "antigravity", title: "Antigravity (agy)", reach: "hook", wire: "hooked", needsPrompt: true, needsModel: false,
    installHint: "Install the Antigravity CLI (agy) and sign in,", assurance: "hook_enforced",
    evidence: { level: "partial", row: "UC-13", note: "run by hand: a call was refused before it ran; headless agy denies shell commands that are not pre-approved" } },
  { name: "openhands", title: "OpenHands", reach: "hook", wire: "hooked", needsPrompt: true, needsModel: false,
    installHint: "Install OpenHands (on Windows it runs inside WSL),", assurance: "hook_enforced",
    evidence: { level: "stand-in", row: "UC-14", note: "tested with a stand-in; run live in an earlier evaluation, not through `asp run`" } },
];

export const runtimeByName = (name: string): RuntimeDescriptor | undefined => RUNTIMES.find((r) => r.name === name);

/** The support matrix as lines of text: one row per runtime, how it is reached, the level it reaches, and the evidence. */
export function supportMatrix(): string[] {
  const rows = RUNTIMES.map((r) => [r.name, r.reach, r.assurance, r.evidence.level, r.evidence.row, r.evidence.note]);
  const head = ["runtime", "reach", "assurance", "evidence", "row", "what was tried"];
  const width = head.slice(0, 5).map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (c: string[]) => c.slice(0, 5).map((x, i) => x.padEnd(width[i])).join("  ") + "  " + c[5];
  return [line(head), line(width.map((w) => "-".repeat(w)).concat(["-".repeat(14)])), ...rows.map(line)];
}
