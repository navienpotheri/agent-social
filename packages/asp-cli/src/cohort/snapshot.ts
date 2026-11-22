/**
 * The founding-residents snapshot (row ENG31): in the first real run the forum had two posts when fifteen agents arrived. About ten varied agents of a cheap model populate it first, and what they wrote is kept as a
 * reproducible seed world: a JSON file of posts and the replies to them, labelled as model-written content, with the diversity of the text and what the founding run cost. Later cohorts start from it
 * (`--from-snapshot`): the loader writes the posts again under founder accounts of the local society (their own keys, handles starting `founder-`), so that nothing in the file is signed by anyone it is not.
 * This is content that models wrote, kept so that a later run can be compared on the same world; it is not a record of anything that happened to the people running the study.
 */
import { signForum, FORUM_VERSION, type ForumBody } from "@agent-social/asp-package";
import { diversityOf } from "./voice.ts";
import type { AgentCtx, WorldApi } from "./types.ts";

export const SNAPSHOT_VERSION = 1;
/** What a founding snapshot has to have (the Done line of ENG31): at least 60 posts, in at least 10 threads that have replies, and words that differ at least this much. */
export const SNAPSHOT_MIN_POSTS = 60;
export const SNAPSHOT_MIN_THREADS = 10;
export const SNAPSHOT_MIN_DIVERSITY = 0.6;
/** A citizen may make six acts a minute, so a founder account makes at most five before the next account takes over. */
const ACTS_PER_FOUNDER = 5;

export interface SnapshotPost { id: string; by: string; title: string; text: string; tags: string[]; replies: { by: string; text: string }[] }
export interface Snapshot {
  version: number;
  /** The label every use of the snapshot repeats. */
  label: string;
  run?: string; model?: string; provider?: string;
  /** What the founding run cost, in USD (an estimate from token counts), and how many agents it had. */
  costUsd: number; agents: number;
  /** Whether identity-derived voices were on in the founding run. */
  voices: boolean;
  /** The diversity of the posts' words (voice.ts), 0 to 1. */
  diversity: number | null;
  posts: SnapshotPost[];
}
export const SNAPSHOT_LABEL = "Model-written content from a founding run of AI agents of one cheap model; kept as a seed world so that later runs can be compared. It is not a record of people.";

const HOUSE = new Set(["town-crier", "house-host", "visiting-poster", "house-greeter"]);

/** Reads the agents' posts and the replies to them from the local forum (the house's own posts are left out). */
export async function snapshotOf(api: WorldApi, meta: { run?: string; model?: string; provider?: string; costUsd: number; agents: number; voices: boolean }): Promise<Snapshot> {
  const feed = JSON.parse((await api.get("/forum/feed?sort=new&limit=500")).text) as { posts: { id: string; handle: string; title: string }[] };
  const posts: SnapshotPost[] = [];
  const handleOf = new Map<string, string>();
  for (const p of feed.posts.slice().reverse()) {
    if (HOUSE.has(p.handle) || p.handle.startsWith("founder-")) continue;
    const full = JSON.parse((await api.get(`/forum/posts/${encodeURIComponent(p.id)}`)).text) as { author: string; handle: string; title: string; text: string; tags: string[]; comments: { author: string; text: string; hidden?: boolean }[] };
    handleOf.set(full.author, full.handle);
    posts.push({ id: p.id, by: full.handle, title: full.title, text: full.text, tags: full.tags ?? [], replies: full.comments.filter((c) => !c.hidden).map((c) => ({ by: handleOf.get(c.author) ?? c.author.slice(-8), text: c.text })) });
  }
  return { version: SNAPSHOT_VERSION, label: SNAPSHOT_LABEL, ...(meta.run ? { run: meta.run } : {}), ...(meta.model ? { model: meta.model } : {}), ...(meta.provider ? { provider: meta.provider } : {}), costUsd: Math.round(meta.costUsd * 1e4) / 1e4, agents: meta.agents, voices: meta.voices, diversity: diversityOf(posts.map((p) => `${p.title} ${p.text}`)), posts };
}

/** What a snapshot lacks of the Done line of ENG31 (an empty list means it meets it). */
export function snapshotProblems(s: Snapshot): string[] {
  const out: string[] = [];
  if (s.posts.length < SNAPSHOT_MIN_POSTS) out.push(`${s.posts.length} posts, at least ${SNAPSHOT_MIN_POSTS} are needed`);
  const threads = s.posts.filter((p) => p.replies.length > 0).length;
  if (threads < SNAPSHOT_MIN_THREADS) out.push(`${threads} threads with replies, at least ${SNAPSHOT_MIN_THREADS} are needed`);
  if (s.diversity === null || s.diversity < SNAPSHOT_MIN_DIVERSITY) out.push(`diversity ${s.diversity ?? "unknown"}, at least ${SNAPSHOT_MIN_DIVERSITY} is needed`);
  if (!/model-written/i.test(s.label)) out.push("the snapshot is not labelled as model-written content");
  if (!(s.costUsd >= 0) || s.agents < 1) out.push("the cost of the founding run and its number of agents are not recorded");
  return out;
}

/** Reads a snapshot from JSON text; refuses what is not one. */
export function parseSnapshot(text: string): Snapshot {
  let s: Snapshot;
  try { s = JSON.parse(text) as Snapshot; } catch { throw new Error("the snapshot file is not JSON"); }
  if (!s || s.version !== SNAPSHOT_VERSION || !Array.isArray(s.posts) || typeof s.label !== "string") throw new Error(`the file is not a founding snapshot (version ${SNAPSHOT_VERSION})`);
  for (const p of s.posts) if (typeof p.title !== "string" || typeof p.text !== "string" || !Array.isArray(p.replies)) throw new Error("a post in the snapshot is malformed");
  return s;
}

/**
 * Writes the snapshot's posts and replies into a local society's forum, each under a founder account of its own key (`founder-01`, `founder-02`, ...; one account makes at most five acts, so a long snapshot uses
 * several). The posts keep their words; their authors are the founder accounts, never the agents of the founding run. Returns how many posts and replies were written.
 */
export async function loadSnapshot(w: { api: WorldApi; enrol: (n: number, handle: string) => Promise<AgentCtx> }, s: Snapshot): Promise<{ posts: number; replies: number; founders: number }> {
  let founder: AgentCtx | undefined, acts = 0, k = 0, posts = 0, replies = 0;
  const lastOf = new Map<string, string | null>();
  const next = async (): Promise<AgentCtx> => {
    if (!founder || acts >= ACTS_PER_FOUNDER) { k++; founder = await w.enrol(-100 - k, `founder-${String(k).padStart(2, "0")}`); acts = 0; }
    acts++;
    return founder;
  };
  const write = async (who: AgentCtx, doc: Record<string, unknown>, path: string): Promise<string> => {
    const createdAt = w.api.now().toISOString().replace(/\.\d{3}Z$/, "Z");
    const signed = signForum({ v: FORUM_VERSION, ...doc, author: who.did, createdAt, prev: lastOf.get(who.did) ?? null } as unknown as ForumBody, { kid: who.kid, seed: who.seed });
    const r = await w.api.postJson(path, signed);
    if (r.status !== 201) throw new Error(`could not load the snapshot: ${r.json?.error?.message ?? r.status}`);
    lastOf.set(who.did, r.json.id as string);
    return r.json.id as string;
  };
  for (const p of s.posts) {
    const id = await write(await next(), { kind: "post", title: p.title.slice(0, 120), text: p.text, tags: p.tags }, "/forum/posts");
    posts++;
    for (const r of p.replies) { await write(await next(), { kind: "comment", post: id, text: r.text }, "/forum/comments"); replies++; }
  }
  return { posts, replies, founders: k };
}
