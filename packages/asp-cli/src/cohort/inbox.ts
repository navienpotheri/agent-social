/**
 * The inbox view (diagnosis fix 2, section 57): in the 2026-11-24 run `my_inbox` was 31% of all tool-result characters, listed everything oldest first and was cut at the tool-result limit, so the newest messages, the ones
 * from other agents, were in the part nobody saw. The view now shows a short list: messages from agents first, then the house's notes; newest first within each; a house note that was already read is one short line; each
 * message cut at 300 characters with the id to read it whole (`my_inbox` with `id`); at most eight shown, the rest counted. What an agent can do is unchanged: every message is still there and still readable whole.
 */
export interface InboxMsg { id: string; from: string; to: string; kind: string; at: string; text?: string; replyTo?: string; answered: boolean }

export const SHOWN = 8;
export const CUT = 300;
const isHouse = (h: string): boolean => h.startsWith("house") || h === "town-crier";
const line = (me: string, x: InboxMsg, text: string): string => `${x.id}  ${x.from === me ? `to ${x.to}` : `from ${x.from}`}  [${x.kind}]${x.from === me ? (x.answered ? "  answered" : "  not answered yet") : (x.answered ? "  you answered" : "  not answered by you")}${text ? `: ${text}` : ""}`;

export function renderInbox(me: string, msgs: InboxMsg[], seen: Set<string>, id?: string): { text: string; shown: string[] } {
  if (id) {
    const x = msgs.find((m) => m.id === id);
    return x ? { text: line(me, x, x.text ?? ""), shown: [x.id] } : { text: `There is no message with that id in your inbox.`, shown: [] };
  }
  if (!msgs.length) return { text: "You have no messages yet.", shown: [] };
  const newest = [...msgs].reverse(); // the log is oldest first
  const fromAgents = newest.filter((x) => !isHouse(x.from === me ? x.to : x.from));
  const fromHouse = newest.filter((x) => isHouse(x.from === me ? x.to : x.from));
  const ordered = [...fromAgents, ...fromHouse].slice(0, SHOWN);
  const out: string[] = [], shown: string[] = [];
  for (const x of ordered) {
    const folded = isHouse(x.from) && x.to === me && seen.has(x.id) && x.answered === false;
    if (folded) { out.push(`${x.id.slice(0, 14)}...  from ${x.from}  [${x.kind}]  already read: ${(x.text ?? "").replace(/\s+/g, " ").slice(0, 60)}${(x.text ?? "").length > 60 ? "..." : ""}`); continue; }
    const t = (x.text ?? "").replace(/\s+/g, " ");
    out.push(line(me, x, t.length > CUT ? `${t.slice(0, CUT)}... (my_inbox with id ${x.id} shows it whole)` : t));
    shown.push(x.id);
  }
  const rest = msgs.length - ordered.length;
  return { text: `${out.join("\n")}${rest > 0 ? `\n${rest} older message${rest === 1 ? "" : "s"} not shown (my_inbox with an id shows any message whole).` : ""}`, shown };
}
