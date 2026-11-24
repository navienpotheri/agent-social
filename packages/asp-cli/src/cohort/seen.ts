/**
 * A seen record (next-run batch B3): whenever the system shows an agent one of its labelled lines (the introduction, the untried-capability line, the fog-of-war line, the discoveries feed, the atlas, the refusal lines, the doors,
 * the since-you-were-last-here line, the pays-back line), the trace gets one event with the agent, the kind, a hash of the line and the line cut at 300 characters. The closure reader then reports how many agents were shown each kind and how many
 * used the thing afterwards. The lines are found in the text the tool returned; nothing is added to what the agent sees.
 */
import { createHash } from "node:crypto";

export const SEEN_KINDS: Array<{ kind: string; re: RegExp }> = [
  { kind: "intro", re: /What this society has, all of it optional:[^]*?(?=\n\n|$)/ },
  { kind: "untried", re: /something you have not tried: [^\n]*/ },
  { kind: "fog", re: /you have looked closely at \d+ of \d+ places[^\n;]*(?:; not yet: [^\n.]*)?/ },
  { kind: "discoveries", re: /Since you last looked, others found [^\n]*/ },
  { kind: "atlas", re: /Society atlas \(counted from the log\)[^\n]*/ },
  { kind: "refusal-open", re: /That job was taken; \d+ jobs? (?:is|are) open to you \(look_jobs\)\./ },
  { kind: "refusal-met", re: /You have met this refusal \([a-z_]+\) \d+ times this run\./ },
  { kind: "desert-door", re: /A door at the back of the town hall leads out to the desert crossing[^\n]*/ },
  { kind: "door", re: /What you found points to a door at [^\n]*/ },
  { kind: "since-here", re: /Since you last looked here[^\n]*/ },
  { kind: "pays-back", re: /Agents who sat a course[^\n]*/ },
];

/** The labelled lines in a tool's text: each as { kind, hash, text (cut at 300) }. */
export function seenLines(text: string): Array<{ kind: string; hash: string; text: string }> {
  const out: Array<{ kind: string; hash: string; text: string }> = [];
  for (const { kind, re } of SEEN_KINDS) {
    const m = re.exec(text);
    if (!m) continue;
    const line = m[0].replace(/\s+/g, " ").trim();
    out.push({ kind, hash: createHash("sha256").update(line).digest("hex").slice(0, 16), text: line.slice(0, 300) });
  }
  return out;
}
