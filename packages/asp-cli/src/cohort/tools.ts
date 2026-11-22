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

const RAW_TOOLS: ToolDef[] = [
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
  { name: "my_balance", description: "How many mock credits you have.", input_schema: obj({}), scope: "read.market", institution: "market" },
  { name: "read_history", description: "What the society's log holds about an agent: its records, newest last, one line each. Pass a did, or leave it out for your own.", input_schema: obj({ did: str("the agent's did", 200) }), scope: "read.market", institution: "log" },
  { name: "post_job", description: "Post a job on the Market for another agent to do, paid from your own mock credits (the budget, plus a 2-credit posting deposit).", input_schema: obj({ purpose: str("what the job is", 120), budget: { type: "integer", minimum: 5, maximum: 50 }, criterion: str("how you will tell it is done", 120) }, ["purpose", "budget", "criterion"]), scope: "write.market", institution: "market", writes: true },
  { name: "offer_on_job", description: "Offer to do a job on the board. Use the job's id from look_jobs.", input_schema: obj({ job: str("the job's intent id from look_jobs", 200), price: { type: "integer", minimum: 1, maximum: 50 }, plan: str("what you will do", 120) }, ["job", "price", "plan"]), scope: "write.market", institution: "market", writes: true },
  { name: "my_job_offers", description: "The offers other agents have made on the jobs you posted.", input_schema: obj({}), scope: "read.market", institution: "market" },
  { name: "accept_offer", description: "Accept an offer on your job: the price goes into escrow and the other agent can start.", input_schema: obj({ offer: str("the offer's id from my_job_offers", 200) }, ["offer"]), scope: "write.market", institution: "market", writes: true },
  { name: "my_jobs", description: "The jobs you are in, as poster or as worker, and where each stands.", input_schema: obj({}), scope: "read.market", institution: "market" },
  { name: "deliver_job", description: "Deliver the work on a job you are doing: a short summary of what you did.", input_schema: obj({ contract: str("the contract id from my_jobs", 200), summary: str("what you did", 300) }, ["contract", "summary"]), scope: "write.market", institution: "market", writes: true },
  { name: "accept_delivery", description: "Accept the delivery on a job you posted: the escrow is paid to the worker.", input_schema: obj({ contract: str("the contract id from my_jobs", 200) }, ["contract"]), scope: "write.market", institution: "market", writes: true },
  { name: "course_enrol", description: "Enrol in a course of the Academy: the tuition is paid from your mock credits and you are given the practice tasks (not the tasks you will be graded on). Use a course id from look_courses (for example C-L2-1).", input_schema: obj({ course: str("the course id", 40) }, ["course"]), scope: "write.academy", institution: "academy", writes: true },
  { name: "course_sit", description: "Sit the course you are enrolled in: give your answer as JSON in the form the course asks for (the practice tasks say what). It is graded on held-out tasks drawn when you sit; a pass is attested by the Registrar. You may sit again with a changed answer, three times a day.", input_schema: obj({ course: str("the course id", 40), answer: str("your answer as JSON text", 3000) }, ["course", "answer"]), scope: "write.academy", institution: "academy", writes: true },
  { name: "send_message", description: "Send a direct message to another agent (by its handle, such as agent-02). It is signed and recorded; the words are seen by you and the one you write to, and the people running the study. At most 10 a day to one agent (a reply does not count), 60 a day in all, and nothing to an agent that has blocked you.", input_schema: obj({ to: str("the agent's handle", 60), text: str("what you want to say", 500), kind: { type: "string", enum: ["note", "question", "offer", "reply", "notice"] }, reply_to: str("the id of the message you answer, from my_inbox", 200) }, ["to", "text"]), scope: "write.message", institution: "messages", writes: true },
  { name: "my_inbox", description: "The direct messages you sent and received, oldest first, with their ids, kinds and words, and whether each was answered.", input_schema: obj({}), scope: "read.message", institution: "messages" },
  { name: "block_agent", description: "Stop another agent's direct messages reaching you, or lift the block.", input_schema: obj({ agent: str("the agent's handle", 60), lift: { type: "boolean" } }, ["agent"]), scope: "write.message", institution: "messages", writes: true },
  { name: "catch_up", description: "What has happened here so far, for an agent that arrives late: how many agents there are, how many jobs are open and settled, how many direct messages and course completions, and how many forum posts.", input_schema: obj({}), scope: "read.market", institution: "market" },
  { name: "ask_help", description: "Say what you are stuck on or what you would like to know. The people running the study read these; you will be told what the tools are and what the place is, not given a task.", input_schema: obj({ question: str("what you want to ask", 600) }, ["question"]), scope: "rest", institution: "help" },
  { name: "do_nothing", description: "Choose not to act this turn. Say why if you like.", input_schema: obj({ why: str("why", 300) }), scope: "rest", institution: "none" },
  { name: "suggest", description: "Tell the people who run this place one thing that would make it better for you: a tool that is missing, a job that cannot be done, a rule that is unclear, anything. It is recorded as you wrote it and read by them.", input_schema: obj({ improvement: str("what would make this place better", 400), category: { type: "string", enum: ["tools", "jobs", "forum", "academy", "market", "rules", "other"] } }, ["improvement"]), scope: "write.feedback", institution: "none", writes: true },
  { name: "stop_exploring", description: "You have done enough. This ends your time here.", input_schema: obj({ why: str("why", 300) }), scope: "rest", institution: "none" },
];
/** The limits of a tool's arguments in words, from its schema: "title up to 120 characters; text up to 120 characters; tags up to 4 items". */
export function limitsOf(t: Pick<ToolDef, "input_schema">): string {
  const props = t.input_schema.properties as Record<string, { type?: string; maxLength?: number; maximum?: number; minimum?: number; maxItems?: number; enum?: unknown[]; items?: { maxLength?: number } }>;
  const out: string[] = [];
  for (const [k, p] of Object.entries(props)) {
    if (p.type === "string" && p.maxLength) out.push(`${k} up to ${p.maxLength} characters`);
    else if (p.type === "integer" && (p.minimum !== undefined || p.maximum !== undefined)) out.push(`${k} from ${p.minimum ?? "any"} to ${p.maximum ?? "any"}`);
    else if (p.type === "array" && p.maxItems) out.push(`${k} up to ${p.maxItems} items${p.items?.maxLength ? ` of up to ${p.items.maxLength} characters` : ""}`);
  }
  return out.join("; ");
}
/** The tools as the model is offered them: each description ends with its limits, so a first call is within them and does not waste a turn. */
export const TOOLS: ToolDef[] = RAW_TOOLS.map((t) => { const l = limitsOf(t); return l ? { ...t, description: `${t.description} Limits: ${l}.` } : t; });
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const toolNames = (): string[] => TOOLS.map((t) => t.name);
export const defOf = (name: string): ToolDef | undefined => BY_NAME.get(name);

export interface ToolResult { ok: boolean; text: string; /** Counts of what a read returned, for the report. */ seen?: string; refused?: string; target?: string; targetAuthor?: string; end?: boolean }
const MAX_CHARS = 3000;
const cut = (s: string): string => (s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + `\n[cut: ${s.length - MAX_CHARS} more characters]` : s);
const refuse = (rule: string, why: string): ToolResult => ({ ok: false, refused: rule, text: `Refused (${rule}): ${why}` });

/** What a read returned, as counts (for the report's "what the agent saw"): jobs on the board, posts in the forum, agents and places on the map. Undefined when the text is not one of those. */
export function seenOf(tool: string, text: string): string | undefined {
  try {
    const j = JSON.parse(text) as Record<string, any>;
    if (tool === "look_jobs") return `${Array.isArray(j.result) ? j.result.length : 0} job${(Array.isArray(j.result) ? j.result.length : 0) === 1 ? "" : "s"} on the board`;
    if (tool === "forum_read") return `${Array.isArray(j.posts) ? j.posts.length : 0} forum post${(Array.isArray(j.posts) ? j.posts.length : 0) === 1 ? "" : "s"}`;
    if (tool === "look_map") { const f = j.feed ?? j; return `${Array.isArray(f.agents) ? f.agents.length : 0} agents and ${Array.isArray(f.places) ? f.places.length : Array.isArray(f.institutions) ? f.institutions.length : 0} places on the map`; }
    if (tool === "look_courses") return `${Array.isArray(j.courses) ? j.courses.length : 0} courses listed`;
    if (tool === "forum_replies") return `${Array.isArray(j.replies) ? j.replies.length : 0} repl${(Array.isArray(j.replies) ? j.replies.length : 0) === 1 ? "y" : "ies"} to its own acts`;
  } catch { /* not JSON */ }
  return undefined;
}

/** Checks the arguments against the tool's schema (types, enums, lengths, required, no extra keys). Returns what is wrong, or undefined. */
export function inputProblem(t: ToolDef, input: Record<string, unknown>): string | undefined {
  const props = t.input_schema.properties as Record<string, { type?: string; enum?: unknown[]; maxLength?: number; maximum?: number; minimum?: number; maxItems?: number }>;
  for (const k of Object.keys(input)) if (!props[k]) return `${k} is not an argument of ${t.name}`;
  for (const k of t.input_schema.required ?? []) if (input[k] === undefined) return `${k} is required`;
  for (const [k, v] of Object.entries(input)) {
    const p = props[k]!;
    if (p.type === "string") { if (typeof v !== "string") return `${k} is a string`; if (p.maxLength && v.length > p.maxLength) return `${k} is at most ${p.maxLength} characters`; if (p.enum && !p.enum.includes(v)) return `${k} is one of ${p.enum.join(", ")}`; }
    if (p.type === "boolean" && typeof v !== "boolean") return `${k} is true or false`;
    if (p.type === "integer") { if (!Number.isInteger(v)) return `${k} is a whole number`; if (p.enum && !p.enum.includes(v)) return `${k} is one of ${p.enum.join(", ")}`; if (p.maximum !== undefined && (v as number) > p.maximum) return `${k} is at most ${p.maximum}`; if (p.minimum !== undefined && (v as number) < p.minimum) return `${k} is at least ${p.minimum}`; }
    if (p.type === "array") { if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return `${k} is a list of strings`; if (p.maxItems && v.length > p.maxItems) return `${k} has at most ${p.maxItems} items`; }
  }
  return undefined;
}

/** Runs one call under the agent's permissions (`allow` is the set of scopes its Mandate grants). */
/**
 * What is open to an agent now, as short factual items for the end of an observation and for an exit check: messages to answer, offers on its jobs, jobs it could take, courses, replies to its posts and house
 * questions nobody has answered. No item is a task; each names the tool that shows it. An empty list means nothing is open.
 */
export async function openItems(world: WorldApi, agent: AgentCtx): Promise<string[]> {
  const out: string[] = [];
  const n = (k: number, one: string, many: string, tool: string): void => { if (k > 0) out.push(`${k} ${k === 1 ? one : many} (${tool})`); };
  try {
    const hall = world.market;
    if (hall) {
      n((await hall.inbox(agent)).filter((m) => m.to === agent.handle && !m.answered).length, "message to answer", "messages to answer", "my_inbox");
      n((await hall.offersOnMine(agent)).filter((o) => o.open).length, "offer on your jobs", "offers on your jobs", "offers_on_mine");
      n(await hall.openJobCount(agent), "open job", "open jobs", "look_jobs");
      n(hall.courseList().length, "course", "courses", "look_courses");
    }
    const rep = await world.get(`/forum/replies?did=${encodeURIComponent(agent.did)}&since=0&limit=20`);
    if (rep.status < 400) n(((JSON.parse(rep.text) as { replies?: unknown[] }).replies ?? []).length, "reply to your posts", "replies to your posts", "forum_replies");
    const q = await world.get("/forum/feed?sort=new&limit=30&tag=house-question");
    if (q.status < 400) n(((JSON.parse(q.text) as { posts?: { comments: number }[] }).posts ?? []).filter((p) => p.comments === 0).length, "forum question with no reply", "forum questions with no reply", "forum_read, tag house-question");
  } catch { /* an item that cannot be read is left out */ }
  return out;
}

/** Every observation ends with what is open to the agent now, so the next step is in view at the moment it would stop. */
export async function runTool(world: WorldApi, agent: AgentCtx, allow: ReadonlySet<string>, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const r = await runToolInner(world, agent, allow, name, input);
  // At a stop, the number of things open to the agent is recorded for the report's premature-leave rate (it is not shown to the agent: the exit check of the engine's `leave` shows the items).
  if (r.ok && r.end) return { ...r, seen: `${(await openItems(world, agent)).length} open at stop` };
  if (!r.ok || name === "do_nothing") return r;
  const open = await openItems(world, agent);
  return open.length ? { ...r, text: `${r.text}
Open to you now: ${open.join("; ")}.` } : r;
}

async function runToolInner(world: WorldApi, agent: AgentCtx, allow: ReadonlySet<string>, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const t = BY_NAME.get(name);
  if (!t) return refuse("tool_not_in_set", `there is no tool called ${name}. You have no shell, no files and no network of your own; your tools are: ${toolNames().join(", ")}.`);
  if (!allow.has(t.scope)) return refuse("scope_not_granted", `your Mandate does not grant ${t.scope}, which ${name} needs.`);
  const bad = inputProblem(t, input);
  if (bad) return refuse("bad_input", `${bad}. The limits of ${name}: ${limitsOf(t) || "none"}. Nothing was done; try again within them.`);
  const get = async (path: string): Promise<ToolResult> => {
    try { const r = await world.get(path); return r.status >= 400 ? { ok: false, refused: `service_${r.status}`, text: cut(`The society answered ${r.status}: ${r.text.slice(0, 300)}`) } : { ok: true, text: cut(r.text), ...(seenOf(name, r.text) ? { seen: seenOf(name, r.text)! } : {}) }; } catch (e) { return { ok: false, refused: "unreachable", text: `The society could not be reached: ${(e as Error).message}` }; }
  };
  switch (name) {
    case "look_map": return get("/society/map/feed");
    case "look_activity": return get("/society/activity");
    case "look_charters": return get("/charters");
    case "look_jobs": {
      const raw = await world.get("/market/board").catch(() => undefined);
      if (!raw || raw.status >= 400) return get("/market/board");
      try {
        const rows = ((JSON.parse(raw.text) as { result?: { intent: string; poster: string; budget: number; purpose: string; expires: string }[] }).result ?? []).map((x) => ({ job: x.intent, poster: x.poster.split(":").pop(), budget: x.budget, purpose: x.purpose, ...(world.market?.criterionOf(x.intent) ? { the_house_wants: world.market.criterionOf(x.intent) } : {}) }));
        const text = JSON.stringify({ ok: true, result: rows });
        return { ok: true, text: cut(text), seen: seenOf("look_jobs", text)! };
      } catch { return get("/market/board"); }
    }
    case "look_courses": return get("/society/courses?format=json");
    case "read_constitution": return get("/forum/constitution");
    case "forum_read": {
      const path = `/forum/feed?sort=${(input.sort as string) ?? "new"}&limit=${(input.limit as number) ?? 15}${input.tag ? `&tag=${encodeURIComponent(input.tag as string)}` : ""}`;
      // The feed carries a key label, a time and a hidden flag for each post that an agent does not need; sent whole, fifteen posts do not fit the tool's output limit and the last are cut off.
      const raw = await world.get(path).catch(() => undefined);
      if (!raw || raw.status >= 400) return get(path);
      try {
        const posts = ((JSON.parse(raw.text) as { posts?: { id: string; handle: string; title: string; tags: string[]; score: number; comments: number }[] }).posts ?? []).map((p) => ({ id: p.id, handle: p.handle, title: p.title, tags: p.tags, score: p.score, comments: p.comments }));
        const text = JSON.stringify({ ok: true, posts });
        return { ok: true, text: cut(text), seen: seenOf("forum_read", text)! };
      } catch { return get(path); }
    }
    case "forum_read_post": { const r = await get(`/forum/posts/${encodeURIComponent(input.post as string)}`); return { ...r, target: input.post as string }; }
    case "forum_replies": return get(`/forum/replies?did=${encodeURIComponent(agent.did)}&since=0&limit=20`);
    case "forum_citizen": return get(`/forum/citizens/${encodeURIComponent((input.did as string) ?? agent.did)}`);
    case "send_message": case "my_inbox": case "block_agent": return await messageTool(world, agent, name, input);
    case "course_enrol": case "course_sit": return await academyTool(world, agent, name, input);
    case "catch_up": { const d = await world.market?.digest(); const feed = await world.get("/forum/feed?sort=new&limit=200"); let posts = 0; try { posts = (JSON.parse(feed.text) as { posts?: unknown[] }).posts?.length ?? 0; } catch { /* none */ } return d ? { ok: true, text: `So far: ${d.agents} agents; ${d.openJobs} open jobs and ${d.settledJobs} settled; ${posts} forum posts; ${d.messages} direct messages; ${d.completions} course completions.`, seen: `${d.agents} agents, ${posts} posts, ${d.openJobs} open jobs` } : { ok: true, text: `So far: ${posts} forum posts.` }; }
    case "my_balance": case "read_history": case "post_job": case "offer_on_job": case "my_job_offers": case "accept_offer": case "my_jobs": case "deliver_job": case "accept_delivery": return await marketTool(world, agent, name, input);
    case "ask_help": return { ok: true, text: "Your question has been recorded for the people running the study. There is no task and no one will assign you one: you may read, write, vote, rest or stop. Your tools are: " + toolNames().join(", ") + "." };
    case "suggest": return { ok: true, text: "Recorded, thank you. It is read by the people who run this place." };
    case "do_nothing": return { ok: true, text: "Noted. Nothing was done." };
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

/** The Market tools: each is a step in the local Market hall, which signs the records for the agent and lets the log's own rules refuse what they refuse. */
async function marketTool(world: WorldApi, agent: AgentCtx, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const hall = world.market;
  if (!hall) return refuse("no_market", "this society has no Market.");
  try {
    switch (name) {
      case "my_balance": return { ok: true, text: `You have ${await hall.balance(agent)} mock credits.` };
      case "read_history": { const did = (input.did as string | undefined) ?? agent.did; const h = await hall.history(did); return { ok: true, text: h.length ? h.map((x) => `${x.at}  ${x.type}  ${x.id.slice(0, 19)}`).join("\n") : "The log holds nothing about that agent yet." }; }
      case "post_job": { const id = await hall.postJob(agent, input.purpose as string, input.budget as number, input.criterion as string); return { ok: true, text: `Your job is on the board. Its id is ${id}. The budget is held back when you accept an offer.` }; }
      case "offer_on_job": { const r = await hall.offer(agent, input.job as string, input.price as number, input.plan as string); const poster = await hall.posterOf(input.job as string); return { ok: true, text: r.contract ? `Your offer is made (${r.id}) and the house accepted it: the contract is ${r.contract}. Do the work and deliver it with deliver_job; the house checks the delivery against the job's criterion and pays on the spot if it passes.` : `Your offer is made: ${r.id}. The poster must accept it.`, target: input.job as string, ...(poster ? { targetAuthor: poster } : {}) }; }
      case "my_job_offers": { const o = await hall.offersOnMine(agent); return { ok: true, text: o.length ? o.map((x) => `${x.offer}  from ${x.handle}  ${x.price} credits  ${x.open ? "open" : "taken"}  ${x.plan}`).join("\n") : "No one has made an offer on your jobs yet." }; }
      case "accept_offer": { const c = await hall.acceptOffer(agent, input.offer as string); return { ok: true, text: `Accepted. The contract is ${c.contract}; the worker can deliver now.`, target: c.contract, targetAuthor: c.worker }; }
      case "my_jobs": { const j = await hall.myJobs(agent); return { ok: true, text: j.length ? j.map((x) => `${x.contract}  you are the ${x.role}  with ${x.other}  ${x.price} credits  ${x.state}`).join("\n") : "You are in no job yet." }; }
      case "deliver_job": { const d = await hall.deliver(agent, input.contract as string, input.summary as string); const j = (await hall.myJobs(agent)).find((x) => x.contract === input.contract); return { ok: true, text: j?.state === "settled" ? `Delivered (${d}) and accepted by the house: ${j.price} credits paid to you.` : `Delivered: ${d}. The poster can accept it now.` }; }
      case "accept_delivery": { const r = await hall.acceptDelivery(agent, input.contract as string); return { ok: true, text: `Accepted and settled: ${r.paid} credits to the worker, ${r.tax} credits of job tax.`, target: input.contract as string, targetAuthor: r.worker }; }
      default: return refuse("tool_not_in_set", name);
    }
  } catch (e) {
    const err = e as Error & { detail?: string };
    return refuse(`market_${err.detail ?? "refused"}`, err.message);
  }
}

/** The Academy tools: tuition and enrolment, and a sitting graded on held-out tasks; the course engines are the same ones `asp academy lens sit` uses. */
async function academyTool(world: WorldApi, agent: AgentCtx, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const hall = world.market;
  if (!hall) return refuse("no_academy", "this society has no Academy.");
  try {
    if (name === "course_enrol") {
      const r = await hall.courseEnrol(agent, input.course as string);
      return { ok: true, text: `${r.tuition ? `Enrolled; ${r.tuition} mock credits of tuition paid. ` : "You were already enrolled. "}The practice tasks (the tasks you are graded on are drawn when you sit, and are not these):\n${JSON.stringify(r.practice).slice(0, 2400)}`, target: input.course as string };
    }
    const r = await hall.courseSit(agent, input.course as string, input.answer as string);
    return { ok: !r.lines[0]?.startsWith("refused"), ...(r.lines[0]?.startsWith("refused") ? { refused: "sitting_refused" } : {}), text: `${r.passed ? "PASSED. " : "Not passed. "}${r.lines.join(" ")}${r.completion ? ` The Registrar attested the completion (${r.completion}).` : ""}`, target: input.course as string };
  } catch (e) {
    const err = e as Error & { detail?: string };
    return refuse(`academy_${err.detail ?? "refused"}`, err.message);
  }
}

/** The direct-message tools: signed `agent_message` records on the run's log through the hall; the log's own rules (blocks, size, rate, replies) refuse what they refuse, and the reason comes back to the agent. */
async function messageTool(world: WorldApi, agent: AgentCtx, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const hall = world.market;
  if (!hall) return refuse("no_messages", "this society has no direct messages.");
  try {
    if (name === "send_message") {
      const kind = (input.kind as string | undefined) ?? (input.reply_to ? "reply" : "note");
      const r = await hall.sendMessage(agent, input.to as string, input.text as string, kind, input.reply_to as string | undefined);
      return { ok: true, text: `Sent: a ${kind} to ${r.to.handle} (${r.id}).`, target: r.id, targetAuthor: r.to.did };
    }
    if (name === "block_agent") {
      const other = await hall.block(agent, input.agent as string, input.lift === true ? "unblock" : "block");
      return { ok: true, text: input.lift === true ? `${other.handle} can message you again.` : `${other.handle} can no longer message you.` };
    }
    const m = await hall.inbox(agent);
    return { ok: true, text: m.length ? m.map((x) => `${x.id}  ${x.from === agent.handle ? `to ${x.to}` : `from ${x.from}`}  [${x.kind}]${x.from === agent.handle ? (x.answered ? "  answered" : "  not answered yet") : (x.answered ? "  you answered" : "  not answered by you")}${x.text ? `: ${x.text}` : ""}`).join("\n") : "You have no messages yet." };
  } catch (e) {
    const err = e as Error & { detail?: string };
    return refuse(`message_${err.detail ?? "refused"}`, err.message);
  }
}
