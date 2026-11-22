/**
 * Agents talking to agents, and the jobs they post for each other (rows ENG81 and ENG82): what the report counts. Nothing here asks an agent to talk or to post and nothing is paid for talking; these are counts of
 * what happened. Messages: how many were sent between agents, how many were answered (a later message names it with reply_to), and how many agents wrote to another and heard back. The forum: threads in which three
 * or more agents took part, and the longest thread. Jobs: how many agents posted at least one job, how many jobs agents posted, were offered on, accepted and paid, and the agent-to-agent settlements.
 */
import type { WorldApi, TraceEvent } from "./types.ts";

export interface TalkCounts { sent: number; answered: number; repliers: number; senders: number; heardBack: number; threads3: number; longest: number; longestTitle: string; threadsWithReplies: number }

/** The counts of messages from the trace and of threads from the forum (read while the society is up). */
export async function talkCounts(api: WorldApi, events: TraceEvent[], agentDids: Map<string, string>): Promise<TalkCounts> {
  const handleOf = new Map<string, string>();
  for (const e of events) if (e.t === "agent") handleOf.set(e.agent, e.handle);
  let sent = 0;
  const answeredIds = new Set<string>(), senders = new Set<string>(), repliers = new Set<string>(), pairs = new Set<string>();
  for (const e of events) {
    if (e.t !== "tool" || e.tool !== "send_message" || !e.ok) continue;
    const from = handleOf.get(e.agent) ?? e.agent, to = String(e.input.to ?? "");
    if (to.startsWith("house-")) continue;
    sent++; senders.add(from); pairs.add(`${from}>${to}`);
    if (typeof e.input.reply_to === "string") { answeredIds.add(e.input.reply_to); repliers.add(from); }
  }
  // an agent heard back when someone it wrote to wrote to it afterwards
  const heard = new Set<string>();
  for (const p of pairs) { const [a, b] = p.split(">"); if (pairs.has(`${b}>${a}`)) heard.add(a!); }
  let threads3 = 0, longest = 0, longestTitle = "", withReplies = 0;
  try {
    const feed = JSON.parse((await api.get("/forum/feed?sort=new&limit=200")).text) as { posts?: { id: string; title: string; handle: string; comments: number }[] };
    const agentHandles = new Set(agentDids.values());
    for (const p of feed.posts ?? []) {
      if (!p.comments) continue;
      withReplies++;
      const full = JSON.parse((await api.get(`/forum/posts/${encodeURIComponent(p.id)}`)).text) as { handle: string; comments?: { author: string }[] };
      const people = new Set<string>();
      if (agentHandles.has(full.handle)) people.add(full.handle);
      for (const c of full.comments ?? []) { const h = agentDids.get(c.author); if (h) people.add(h); }
      if (people.size >= 3) threads3++;
      if ((full.comments?.length ?? 0) > longest) { longest = full.comments!.length; longestTitle = p.title; }
    }
  } catch { /* no forum to read */ }
  return { sent, answered: answeredIds.size, repliers: repliers.size, senders: senders.size, heardBack: heard.size, threads3, longest, longestTitle, threadsWithReplies: withReplies };
}

export function renderTalk(c: TalkCounts): string {
  const L = ["## Agents talking to agents", ""];
  L.push(`${c.sent} direct message${c.sent === 1 ? "" : "s"} were sent from one agent to another (the house greeter's and guides' are not counted); ${c.answered} of them ${c.answered === 1 ? "was" : "were"} answered with a reply that named it. ${c.senders} agent${c.senders === 1 ? "" : "s"} wrote to another and ${c.heardBack} of them heard back from someone they had written to.`);
  L.push(`In the forum ${c.threadsWithReplies} thread${c.threadsWithReplies === 1 ? "" : "s"} had a reply; ${c.threads3} had three or more agents in them; the longest had ${c.longest} comment${c.longest === 1 ? "" : "s"}${c.longestTitle ? ` ("${c.longestTitle.slice(0, 60)}")` : ""}. Nothing asked an agent to talk and nothing was paid for it. These are counts of one run; their spread between repeat runs (ENG72) is not measured here.`);
  return L.join("\n") + "\n";
}

export function renderAgentJobs(s: { posters: number; posted: number; offered: number; accepted: number; paid: number }, agents: number): string {
  const L = ["## Jobs that agents posted for each other", ""];
  L.push(`${s.posters} of ${agents} agent${agents === 1 ? "" : "s"} posted at least one job; ${s.posted} job${s.posted === 1 ? "" : "s"} were posted by agents, ${s.offered} were offered on, ${s.accepted} were accepted and delivered (agent-to-agent settlements), and ${s.paid} mock credits were paid for them. Nothing asked an agent to post a job; the first one is free.`);
  return L.join("\n") + "\n";
}
