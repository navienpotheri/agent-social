/**
 * The events of the local society, for the engagement engine (docs/agent-engagement.md): what the engine wakes an agent for. Slice 1 has two sources: the forum (a comment or a vote by another agent on the agent's own
 * acts, from GET /forum/replies with its cursor) and the job board (a posting that was not there before). A message, an offer on the agent's job and a course opening need the Market, the direct messages and the Academy
 * of the next slice: they are not raised here, and a wait for them is refused by the engine with that reason. Nothing is private: both sources are the public pages of the society.
 */
import type { EventSource, LifeEvent, SimClock } from "@agent-social/asp-package";
import type { WorldApi } from "./types.ts";

export function societySource(o: { world: WorldApi; didOf: (agent: string) => string | undefined; clock: SimClock }): EventSource {
  const seenJobs = new Map<string, Set<string>>();
  const jobIds = (text: string): string[] => {
    try {
      const j = JSON.parse(text) as unknown;
      const list = Array.isArray(j) ? j : (j as { jobs?: unknown[]; intents?: unknown[]; items?: unknown[] }).jobs ?? (j as { intents?: unknown[] }).intents ?? (j as { items?: unknown[] }).items ?? [];
      return (list as Array<{ id?: string; intent?: string; title?: string }>).map((x, i) => String(x.id ?? x.intent ?? x.title ?? i));
    } catch { return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*]|\bjob\b/i.test(l)).map((l) => l.slice(0, 120)); }
  };
  return {
    kinds: ["reply", "vote", "new_job"],
    async poll(agent, cursor) {
      const did = o.didOf(agent);
      const events: LifeEvent[] = [];
      let next = cursor as { since?: number; started?: boolean } | undefined;
      if (!next) {
        // The first look only marks where "now" is: nothing that was already there is news.
        let head = 0;
        try { head = Number((JSON.parse((await o.world.get("/forum/head")).text) as { seq?: number }).seq ?? 0); } catch { /* from the start */ }
        const board = await o.world.get("/market/board").catch(() => undefined);
        seenJobs.set(agent, new Set(board && board.status === 200 ? jobIds(board.text) : []));
        return { events, cursor: { since: head, started: true } };
      }
      if (did) {
        const r = await o.world.get(`/forum/replies?did=${encodeURIComponent(did)}&since=${next.since ?? 0}&limit=50`).catch(() => undefined);
        if (r && r.status === 200) {
          try {
            const j = JSON.parse(r.text) as { replies?: Array<{ kind: "comment" | "vote"; handle?: string | null; by: string; on: string; text?: string; value?: number }>; next_since?: number };
            for (const x of j.replies ?? []) events.push(x.kind === "comment"
              ? { kind: "reply", at: o.clock.now(), text: `${x.handle ?? "someone"} answered you: ${(x.text ?? "").slice(0, 200)}`, ref: x.on }
              : { kind: "vote", at: o.clock.now(), text: `${x.handle ?? "someone"} voted ${x.value === -1 ? "down" : "up"} on what you wrote`, ref: x.on });
            next = { ...next, since: j.next_since ?? next.since };
          } catch { /* not JSON: no events */ }
        }
      }
      const board = await o.world.get("/market/board").catch(() => undefined);
      if (board && board.status === 200) {
        const seen = seenJobs.get(agent) ?? new Set<string>();
        for (const id of jobIds(board.text)) if (!seen.has(id)) { seen.add(id); events.push({ kind: "new_job", at: o.clock.now(), text: `a new job is on the board: ${id.slice(0, 100)}`, ref: id }); }
        seenJobs.set(agent, seen);
      }
      return { events, cursor: next };
    },
  };
}
