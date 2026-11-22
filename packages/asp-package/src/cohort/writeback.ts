/**
 * Refusals written back into an agent's memory (ENG78): after a refusal the engine appends ONE short labelled line to the agent's own notebook, without a model call, saying what was refused, by which rule, why in plain
 * words, and what to do instead. The agent can read it, keep it or delete it (it is its own notebook, and the line says so). One line for each rule, with a count; the lines are few and the notebook cap holds. The owner's
 * question is whether the agents that get the line repeat a rule they already met less often than the agents that do not (a random half, from a seed, are the control).
 *
 * A line holds only the society's own words: the refusal reason with anything quoted taken out (a quote could be the agent's own text or another agent's) and any secret-shaped string redacted. Nothing here reads a key.
 */
import { createHash } from "node:crypto";
import { redactSecrets } from "../secrets.ts";

export const SOCIETY_TAG = "From the society (you can keep or delete this line)";
/** At most this many such lines in a notebook; the oldest go first. */
export const MAX_SOCIETY_LINES = 6;
/** The longest a reason may be in a line. */
export const REASON_CHARS = 200;

/** What to do instead, by the rule (or the start of the rule's name) that refused. */
export function adviceFor(rule: string): string {
  if (rule === "bad_input") return "check the arguments against the tool's description: its limits are written there";
  if (rule === "gateway" || rule === "scope_not_granted" || rule === "tool_not_in_set") return "use only the tools you were given; this one is not allowed here";
  if (rule === "wake_storm") return "wait at least five minutes, or do something now";
  if (rule === "notebook_full") return "shorten your notebook first";
  if (rule.startsWith("market")) return "read the reason, look at my_balance or my_jobs first, or choose another job";
  if (rule.startsWith("forum_")) return "write something new, shorter or after reading first; the forum has limits";
  if (rule.startsWith("message_")) return "check the kind of message and whom you may write to";
  if (rule.startsWith("academy_")) return "read the course and its price first";
  return "read the reason, change the call, or rest: resting is always allowed";
}

/** The refusal's reason in plain words: the rule's prefix and anything quoted taken out, secrets redacted, cut to about 200 characters at a word. */
export function cleanReason(text: string, max = REASON_CHARS): string {
  let t = text.replace(/^\s*(?:\[ASP\]\s*)?Refused \([^)]*\):\s*/i, "").replace(/\s+/g, " ").trim();
  t = t.replace(/"[^"]*"/g, "").replace(/'[^']{3,}'/g, "").replace(/`[^`]*`/g, "").replace(/\s+/g, " ").trim();
  t = redactSecrets(t).text;
  if (t.length > max) { t = t.slice(0, max); const sp = t.lastIndexOf(" "); if (sp > max * 0.6) t = t.slice(0, sp); t = t.replace(/[,;:\s]+$/, "") + "..."; }
  return t || "the society did not allow it";
}

/** The line for the notebook. `count` is how many times this agent has now met this rule. */
export function refusalLine(o: { tool: string; rule: string; reason: string; count: number }): string {
  const times = o.count > 1 ? `, ${o.count} times now` : "";
  const reason = cleanReason(o.reason).replace(/[.]+$/, "");
  return `${SOCIETY_TAG}: ${o.tool} was refused (${o.rule})${times}: ${reason}. Instead: ${adviceFor(o.rule)}.`;
}

/** Adds or updates the line for `rule` in a notebook text and keeps the notebook inside `cap` characters and the lines inside MAX_SOCIETY_LINES; the agent's own notes are never cut. Returns the new text, or undefined if it cannot fit. */
export function applyRefusalLine(notebook: string, rule: string, line: string, cap: number): string | undefined {
  const lines = notebook ? notebook.split("\n") : [];
  const isSociety = (l: string) => l.startsWith(SOCIETY_TAG);
  const at = lines.findIndex((l) => isSociety(l) && l.includes(`was refused (${rule})`));
  if (at >= 0) lines[at] = line; else lines.push(line);
  const society = () => lines.map((l, i) => [l, i] as const).filter(([l]) => isSociety(l));
  while (society().length > MAX_SOCIETY_LINES) lines.splice(society()[0]![1], 1);
  // the oldest society lines go first when the notebook is too long; the new line is the last to go
  while (lines.join("\n").length > cap) {
    const s = society();
    const drop = s.find(([l]) => l !== line);
    if (!drop) return undefined;
    lines.splice(drop[1], 1);
  }
  return lines.join("\n");
}

/** The characters of the society's lines in a notebook (what the writeback adds to what an agent is shown). */
export const societyChars = (notebook: string): number => notebook.split("\n").filter((l) => l.startsWith(SOCIETY_TAG)).reduce((n, l) => n + l.length + 1, 0);

/** Which agents get the line: with "half", exactly floor(n/2) of them chosen by a hash of the seed and the agent's id (so the same seed gives the same split); with "all", all of them. */
export function assignArms(ids: readonly string[], seed: string | number, mode: "all" | "half"): Map<string, "writeback" | "control"> {
  const out = new Map<string, "writeback" | "control">();
  if (mode === "all") { for (const id of ids) out.set(id, "writeback"); return out; }
  const ranked = [...ids].map((id) => ({ id, h: createHash("sha256").update(`${seed}:${id}`).digest("hex") })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
  const take = Math.floor(ids.length / 2);
  ranked.forEach((r, i) => out.set(r.id, i < take ? "writeback" : "control"));
  return out;
}
