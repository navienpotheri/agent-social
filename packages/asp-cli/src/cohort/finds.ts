/**
 * The Finds thread (row ENG73): a labelled house thread, "Finds: what have you come across?", opened when the run has things to find (field lessons, discoveries, the tour). It is a place to say what an agent came across,
 * read only at the Town Hall (`inspect town-hall` shows the latest few), and nothing is paid for writing in it: the surprise is the reward, and a reward would invite spam. After a find, the reply carries one neutral line
 * that others may like to hear of it, not required. The report quotes what was written and counts how many of the agents that found something wrote there.
 */
import type { WorldApi } from "./types.ts";

export async function findsSection(api: WorldApi, agents: { did: string; handle: string }[], finders: Set<string>): Promise<string> {
  const L = ["## What agents wrote about finds", ""];
  let comments: { author: string; text: string }[] = [];
  try { comments = (JSON.parse((await api.get(`/forum/posts/${encodeURIComponent(api.findsThread ?? "")}`)).text) as { comments?: { author: string; text: string }[] }).comments ?? []; } catch { /* no thread */ }
  const handle = new Map(agents.map((a) => [a.did, a.handle]));
  const mine = comments.filter((c) => handle.has(c.author));
  const posters = new Set(mine.map((c) => handle.get(c.author)!));
  const finderPosters = [...finders].filter((h) => posters.has(h));
  L.push(`${finders.size} agent${finders.size === 1 ? "" : "s"} found something (a field lesson, a discovery or a place that opened); ${finderPosters.length} of them wrote in the Finds thread, and ${posters.size} agent${posters.size === 1 ? "" : "s"} in all wrote there. Writing there is not paid; a tip that another agent uses and cites earns its author a small credit.`);
  if (mine.length) { L.push(""); for (const c of mine.slice(0, 8)) L.push(`- ${handle.get(c.author)}${finders.has(handle.get(c.author)!) ? " (found something)" : ""}: "${c.text.replace(/\s+/g, " ").slice(0, 90)}"`); }
  else { L.push(""); L.push("No agent wrote in the Finds thread."); }
  return L.join("\n") + "\n";
}

export const TIP_PAY = 1;
export const TIP_CAP_PER_AUTHOR = 10;
/**
 * A tip in the Finds thread earns when another agent uses it: the agent that takes a card, and cites the post that told it where the card was, pays the author one mock credit, once for each citing agent and post, up to a
 * cap for each author (the same rule as a citation in the library). An empty post, or one that does not say where or what the card is, earns nothing, and posting alone earns nothing. Credits are mock.
 */
export class Tips {
  private readonly cited = new Set<string>();
  private readonly paid = new Map<string, number>();
  total = 0;
  cite(citer: string, commentId: string, author: string): { ok: boolean; why?: string; credits: number } {
    if (citer === author) return { ok: false, why: "you cannot cite your own post", credits: 0 };
    const key = `${citer}|${commentId}`;
    if (this.cited.has(key)) return { ok: false, why: "you have already cited this post", credits: 0 };
    this.cited.add(key);
    const p = this.paid.get(author) ?? 0;
    const credits = p + TIP_PAY <= TIP_CAP_PER_AUTHOR ? TIP_PAY : 0;
    this.paid.set(author, p + credits); this.total += credits;
    return { ok: true, credits };
  }
}
