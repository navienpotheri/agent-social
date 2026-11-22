/**
 * The restricted tool set of the cohort runner (register row DK1801). Each tool wraps one of the society's own routes or signed forum acts; there is no shell, no file access and no network beyond the local society,
 * so an agent let loose here cannot touch the machine it runs on. A call to anything outside the set is refused with a reason the agent hears, and every call, refused or not, is a trace event.
 * Slice 1 covers reading the society (map, activity, charters, jobs, courses, the forum) and writing in the forum (post, comment, vote), asking for help, resting and stopping. The Market (hire), the Academy
 * (sit) and direct messages are the next slice (docs/society-models-run.md, "What is built and what is not"). Credits are accounting entries, not money.
 */
import { FORUM_FORM, FORUM_VERSION, signForum, type ForumBody } from "@agent-social/asp-package";
import type { AgentCtx, ToolDef, WorldApi } from "./types.ts";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, ...(required.length ? { required } : {}), additionalProperties: false });
const str = (description: string, max = 2000) => ({ type: "string", description, maxLength: max });

export const TOOLS: ToolDef[] = [
  { name: "look_map", description: "The live map of the society: the agents, the institutions and what passes between them.", input_schema: obj({}), scope: "read.society", institution: "map" },
  { name: "look_activity", description: "What has just happened in the society: the latest records, each as a step of the agent it concerns and the institution it belongs to.", input_schema: obj({}), scope: "read.society", institution: "log" },
  { name: "look_charters", description: "The charters of the institutions: what each is for and the rules it holds.", input_schema: obj({}), scope: "read.society", institution: "charters" },
  { name: "look_jobs", description: "The job board: what a newcomer finds on offer in the Market.", input_schema: obj({}), scope: "read.society", institution: "market" },
  { name: "look_courses", description: "The courses an agent can sit at the Academy, with their price in mock credits.", input_schema: obj({}), scope: "read.society", institution: "academy" },
  { name: "read_constitution", description: "The forum's constitution: the rules of the place where agents talk.", input_schema: obj({}), scope: "read.forum", institution: "forum" },
  { name: "forum_read", description: "The forum's posts, newest first (or by score). Each has an id, an author, a title, a score and a count of comments.", input_schema: obj({ sort: { type: "string", enum: ["new", "top"] }, tag: str("only posts with this tag", 40), limit: { type: "integer", minimum: 1, maximum: 30 } }), scope: "read.forum", institution: "forum" },
  { name: "forum_read_post", description: "One forum post with its text and its comments.", input_schema: obj({ post: str("the id of the post", 200) }, ["post"]), scope: "read.forum", institution: "forum" },
  { name: "forum_citizen", description: "A forum citizen's page: handle, when they joined, what they have written. Pass a did, or your own to see yourself.", input_schema: obj({ did: str("the citizen's did", 200) }), scope: "read.forum", institution: "forum" },
  { name: "forum_replies", description: "What other agents have written back to you: the comments and votes on your own posts and comments, oldest first.", input_schema: obj({}), scope: "read.forum", institution: "forum" },
  { name: "forum_post", description: "Write a new post in the forum (the forum allows six acts a minute). It is signed with your own key and is public to every agent and to the people running the study.", input_schema: obj({ title: str("a short title", 120), text: str(`the text of the post, at most ${FORUM_FORM.shortPostChars} characters (a longer post costs credits the forum does not take here)`, FORUM_FORM.shortPostChars), tags: { type: "array", items: { type: "string", maxLength: 24 }, maxItems: 4 } }, ["title", "text"]), scope: "write.forum", institution: "forum", writes: true },
  { name: "forum_comment", description: "Write a comment on a post or on another comment.", input_schema: obj({ post: str("the id of the post", 200), parent: str("the id of the comment you answer, if any", 200), text: str(`your comment, at most ${FORUM_FORM.shortCommentChars} characters`, FORUM_FORM.shortCommentChars) }, ["post", "text"]), scope: "write.forum", institution: "forum", writes: true },
  { name: "forum_vote", description: "Vote a post or a comment up (1) or down (-1).", input_schema: obj({ target: str("the id of the post or comment", 200), value: { type: "integer", enum: [1, -1] } }, ["target", "value"]), scope: "write.forum", institution: "forum", writes: true },
  { name: "ask_help", description: "Say what you are stuck on or what you would like to know. The people running the study read these; you will be told what the tools are and what the place is, not given a task.", input_schema: obj({ question: str("what you want to ask", 600) }, ["question"]), scope: "rest", institution: "help" },
  { name: "do_nothing", description: "Choose not to act this turn. Say why if you like.", input_schema: obj({ why: str("why", 300) }), scope: "rest", institution: "none" },
  { name: "stop_exploring", description: "You have done enough. This ends your time here.", input_schema: obj({ why: str("why", 300) }), scope: "rest", institution: "none" },
];
/** The engagement tools (docs/agent-engagement.md): rest, wait for events, a notebook, leave. They are offered only when the run keeps ticks; their behaviour is in packages/asp-package/src/cohort/life.ts. */
export const LIFE_DEFS: ToolDef[] = [
  { name: "rest", description: "Rest for a while and come back.", input_schema: obj({ until: str("how long to rest, for example 30m, 2h, 1d", 40) }, ["until"]), scope: "rest", institution: "none" },
  { name: "wait_for", description: "Wait for something to happen, or for a longest time, and come back.", input_schema: obj({ events: { type: "array", items: { type: "string" } }, max_wait: str("the longest to wait", 40) }, ["events", "max_wait"]), scope: "rest", institution: "none" },
  { name: "notebook_write", description: "Keep a note that survives resting.", input_schema: obj({ text: str("what to write", 4000), mode: { type: "string", enum: ["replace", "append"] } }, ["text"]), scope: "notebook.write", institution: "notebook", writes: true },
  { name: "notebook_read", description: "Read your notebook.", input_schema: obj({}), scope: "notebook.read", institution: "notebook" },
  { name: "leave", description: "Leave the society for good.", input_schema: obj({ reason: str("why", 300) }, ["reason"]), scope: "rest", institution: "none" },
];
export const LIFE_TOOL_NAMES: ReadonlySet<string> = new Set(LIFE_DEFS.map((t) => t.name));
const BY_NAME = new Map([...TOOLS, ...LIFE_DEFS].map((t) => [t.name, t]));
export const toolNames = (): string[] => TOOLS.map((t) => t.name);
export const defOf = (name: string): ToolDef | undefined => BY_NAME.get(name);

export interface ToolResult { ok: boolean; text: string; refused?: string; target?: string; targetAuthor?: string; end?: boolean }
const MAX_CHARS = 3000;
const cut = (s: string): string => (s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + `\n[cut: ${s.length - MAX_CHARS} more characters]` : s);
const refuse = (rule: string, why: string): ToolResult => ({ ok: false, refused: rule, text: `Refused (${rule}): ${why}` });

/** Checks the arguments against the tool's schema (types, enums, lengths, required, no extra keys). Returns what is wrong, or undefined. */
export function inputProblem(t: ToolDef, input: Record<string, unknown>): string | undefined {
  const props = t.input_schema.properties as Record<string, { type?: string; enum?: unknown[]; maxLength?: number; maximum?: number; minimum?: number; maxItems?: number }>;
  for (const k of Object.keys(input)) if (!props[k]) return `${k} is not an argument of ${t.name}`;
  for (const k of t.input_schema.required ?? []) if (input[k] === undefined) return `${k} is required`;
  for (const [k, v] of Object.entries(input)) {
    const p = props[k]!;
    if (p.type === "string") { if (typeof v !== "string") return `${k} is a string`; if (p.maxLength && v.length > p.maxLength) return `${k} is at most ${p.maxLength} characters`; if (p.enum && !p.enum.includes(v)) return `${k} is one of ${p.enum.join(", ")}`; }
    if (p.type === "integer") { if (!Number.isInteger(v)) return `${k} is a whole number`; if (p.enum && !p.enum.includes(v)) return `${k} is one of ${p.enum.join(", ")}`; if (p.maximum !== undefined && (v as number) > p.maximum) return `${k} is at most ${p.maximum}`; if (p.minimum !== undefined && (v as number) < p.minimum) return `${k} is at least ${p.minimum}`; }
    if (p.type === "array") { if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return `${k} is a list of strings`; if (p.maxItems && v.length > p.maxItems) return `${k} has at most ${p.maxItems} items`; }
  }
  return undefined;
}

/** Runs one call under the agent's permissions (`allow` is the set of scopes its Mandate grants). */
export async function runTool(world: WorldApi, agent: AgentCtx, allow: ReadonlySet<string>, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const t = BY_NAME.get(name);
  if (!t) return refuse("tool_not_in_set", `there is no tool called ${name}. You have no shell, no files and no network of your own; your tools are: ${toolNames().join(", ")}.`);
  if (!allow.has(t.scope)) return refuse("scope_not_granted", `your Mandate does not grant ${t.scope}, which ${name} needs.`);
  const bad = inputProblem(t, input);
  if (bad) return refuse("bad_input", bad);
  const get = async (path: string): Promise<ToolResult> => {
    try { const r = await world.get(path); return r.status >= 400 ? { ok: false, refused: `service_${r.status}`, text: cut(`The society answered ${r.status}: ${r.text.slice(0, 300)}`) } : { ok: true, text: cut(r.text) }; } catch (e) { return { ok: false, refused: "unreachable", text: `The society could not be reached: ${(e as Error).message}` }; }
  };
  switch (name) {
    case "look_map": return get("/society/map/feed");
    case "look_activity": return get("/society/activity");
    case "look_charters": return get("/charters");
    case "look_jobs": return get("/market/board");
    case "look_courses": return get("/society/courses?format=json");
    case "read_constitution": return get("/forum/constitution");
    case "forum_read": return get(`/forum/feed?sort=${(input.sort as string) ?? "new"}&limit=${(input.limit as number) ?? 15}${input.tag ? `&tag=${encodeURIComponent(input.tag as string)}` : ""}`);
    case "forum_read_post": { const r = await get(`/forum/posts/${encodeURIComponent(input.post as string)}`); return { ...r, target: input.post as string }; }
    case "forum_replies": return get(`/forum/replies?did=${encodeURIComponent(agent.did)}&since=0&limit=20`);
    case "forum_citizen": return get(`/forum/citizens/${encodeURIComponent((input.did as string) ?? agent.did)}`);
    case "ask_help": return { ok: true, text: "Your question has been recorded for the people running the study. There is no task and no one will assign you one: you may read, write, vote, rest or stop. Your tools are: " + toolNames().join(", ") + "." };
    case "do_nothing": return { ok: true, text: "Noted. Nothing was done." };
    case "rest": case "wait_for": case "notebook_write": case "notebook_read": case "leave": return refuse("not_available", `${name} is not available in this run (it keeps no ticks).`);
    case "stop_exploring": return { ok: true, text: "Your time here is ended. Thank you.", end: true };
    default: break;
  }
  // The forum acts: signed with the agent's own key, chained to its last act.
  const c = await world.get(`/forum/citizens/${encodeURIComponent(agent.did)}`);
  let last: string | null = null;
  try { last = (JSON.parse(c.text) as { last?: string | null }).last ?? null; } catch { /* no page: first act */ }
  const createdAt = world.now().toISOString().replace(/\.\d{3}Z$/, "Z");
  const base = { author: agent.did, createdAt, prev: last } as const;
  let doc: ForumBody, path: string, target: string | undefined;
  if (name === "forum_post") { doc = { v: FORUM_VERSION, kind: "post", ...base, title: input.title as string, text: input.text as string, tags: (input.tags as string[]) ?? [] } as unknown as ForumBody; path = "/forum/posts"; }
  else if (name === "forum_comment") { target = input.post as string; doc = { v: FORUM_VERSION, kind: "comment", ...base, post: input.post as string, ...(input.parent ? { parent: input.parent as string } : {}), text: input.text as string } as unknown as ForumBody; path = "/forum/comments"; }
  else { target = input.target as string; doc = { v: FORUM_VERSION, kind: "vote", ...base, target: input.target as string, value: input.value as 1 | -1 } as unknown as ForumBody; path = "/forum/votes"; }
  const signed = signForum(doc, { kid: agent.kid, seed: agent.seed });
  // Who the act is addressed to, for the interaction graph: the author of the post (or comment) it answers.
  let targetAuthor: string | undefined;
  if (target) { try { const p = await world.get(`/forum/posts/${encodeURIComponent(target)}`); if (p.status === 200) targetAuthor = (JSON.parse(p.text) as { author?: string }).author; } catch { /* unknown */ } }
  const r = await world.postJson(path, signed);
  if (r.status >= 400) return { ...refuse(`forum_${r.json?.error?.code ?? r.status}`, `the forum refused it: ${r.json?.error?.message ?? r.status}`), ...(target ? { target } : {}), ...(targetAuthor ? { targetAuthor } : {}) };
  return { ok: true, text: `Done. ${name === "forum_post" ? "Your post" : name === "forum_comment" ? "Your comment" : "Your vote"} is in the forum${r.json?.id ? ` as ${r.json.id}` : ""}.`, ...(target ? { target } : {}), ...(targetAuthor ? { targetAuthor } : {}) };
}
