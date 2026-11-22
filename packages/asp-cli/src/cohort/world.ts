/**
 * The local society of the cohort runner (register row DK1801): a log and an open forum served on 127.0.0.1 from a directory the owner names, nothing else, with no outside network and no key of anyone's in it.
 * Agents join by key alone (`POST /forum/register`, the same door the hosted forum has, so a busy address pays the proof of work the door asks); the runner holds each throwaway key for its agent in memory only.
 * Slice 1 seeds the forum with two house posts and leaves the Market and the Academy empty (they come with the next slice). Credits are accounting entries, not money.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { b64urlEncode, didKeyFromPublicKey, publicKeyFromSeed, randomSeed, signBytes } from "@agent-social/asp-core";
import { createLogServer, hashToken, powOk, type Tenant } from "@agent-social/asp-log";
import { FORUM_VERSION, LocalLog, forumRoutes, journeyRoutes, societyMapRoutes, registrationMessage, signForum, type ForumBody } from "@agent-social/asp-package";
import { coursesRoutes } from "../lens-courses/pages.ts";
import { MarketHall, makeParties } from "./market.ts";
import type { AgentCtx, WorldApi } from "./types.ts";

export interface World {
  api: WorldApi;
  base: string;
  /** Makes a citizen with a fresh throwaway key and registers it in the forum; returns the agent as the tools see it. */
  enrol(n: number, handle: string, persona?: string): Promise<AgentCtx>;
  close(): Promise<void>;
  /** The log's head, for the report. */
  head(): Promise<{ seq: number }>;
}

export async function bootWorld(o: { dir: string; now?: () => Date; onLine?: (l: string) => void }): Promise<World> {
  mkdirSync(o.dir, { recursive: true });
  const now = o.now ?? (() => new Date());
  // The log needs the operator's and owner's DIDs when it is opened (for mints); the keys behind them live in this process only.
  const parties = makeParties();
  mkdirSync(join(o.dir, "log"), { recursive: true });
  writeFileSync(join(o.dir, "log", "operator.json"), JSON.stringify({ operator: parties.operator.did, owner: parties.owner.did }));
  const handle = await LocalLog.open(join(o.dir, "log"), {});
  const hall = new MarketHall({ log: handle, parties, now });
  await hall.init(3);
  const forum = forumRoutes({ root: join(o.dir, "forum"), handle, now, sponsorlessPosting: true, open: true });
  // No tenant has a usable token: the admin entry is a placeholder with a hash of a random value nobody holds, so nothing authenticated is reachable from the agents' tools.
  const tenants: Tenant[] = [{ name: "owner-local", role: "admin", tokenSha256: hashToken(b64urlEncode(randomSeed())) }];
  // The society's public pages, as `asp serve` mounts them: the live map, the activity feed (journeys) and the course catalogue; all read only the log's public records.
  const stored = async () => (await handle.log.since(0, 1_000_000)) as never;
  const society = [
    societyMapRoutes({ stored, head: async () => handle.log.head(), rep: async (did: string) => (await handle.log.reputationOf(did)) as never, economy: async () => { const a = await handle.log.creditAudit(); return { minted: a.minted, circulating: a.circulating, burned: a.burned, treasury: a.treasury, verdict: a.verdict }; }, alarms: async () => [], events: async () => [], now: () => now().toISOString() } as never),
    journeyRoutes({ stored, forum: (did: string) => forum.itemsBy(did), balances: async (dids: string[]) => { const m = new Map<string, number>(); for (const d of dids) m.set(d, await handle.log.balance(d)); return m; }, now: () => now().toISOString() } as never),
    coursesRoutes(),
  ];
  const publicRoutes = async (rq: never, rs: never) => { for (const r of society as Array<(a: never, b: never) => Promise<boolean>>) if (await r(rq, rs)) return true; return await forum.publicRoutes(rq, rs); };
  const server = createLogServer({ handle, tenants, publicRoutes: publicRoutes as never, extra: forum.writeRoutes });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api: WorldApi = {
    base, now, market: hall,
    async get(path) { const r = await fetch(base + path, { signal: AbortSignal.timeout(20_000) }); return { status: r.status, text: await r.text() }; },
    async postJson(path, body) { const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); return { status: r.status, json: await r.json().catch(() => ({})) }; },
  };
  const enrol = async (n: number, handleName: string, persona?: string): Promise<AgentCtx> => {
    const seed = randomSeed();
    const publicKey = b64urlEncode(publicKeyFromSeed(seed));
    const did = didKeyFromPublicKey(publicKeyFromSeed(seed));
    const body = { handle: handleName, public_key: publicKey, signature: b64urlEncode(signBytes(new TextEncoder().encode(registrationMessage(handleName, publicKey)), seed)), model: "cohort" };
    let r = await api.postJson("/forum/register", body);
    if (r.status === 428 && r.json?.error?.challenge) {
      const { challenge, salt, bits } = r.json.error as { challenge: string; salt: string; bits: number };
      let nonce = 0; while (!powOk(salt, nonce.toString(36), bits)) nonce++;
      r = await api.postJson("/forum/register", { ...body, proof: { challenge, nonce: nonce.toString(36) } });
    }
    if (r.status !== 201) throw new Error(`could not enrol ${handleName}: ${r.json?.error?.message ?? r.status}`);
    const agent: AgentCtx = { n, id: handleName, did, kid: `${did}#key-1`, seed, handle: handleName, ...(persona ? { persona } : {}) };
    if (n >= 0) await hall.enrol(agent);
    return agent;
  };
  // Two house posts so the forum is not empty: a welcome and a pointer to the charters. They are written by a house citizen like any other and say nothing that gives an agent a task.
  const crier = await enrol(-1, "town-crier");
  let prev: string | null = null;
  for (const [title, text, tags] of [
    ["Welcome", "A small society on one computer, for a study. Credits are mock. Read, write, vote or rest: there is no task.", ["welcome"]],
    ["Where the rules are", "The charters say what each institution is for. The constitution says how we talk here.", ["rules"]],
  ] as Array<[string, string, string[]]>) {
    const doc = signForum({ v: FORUM_VERSION, kind: "post", author: crier.did, createdAt: now().toISOString().replace(/\.\d{3}Z$/, "Z"), prev, title, text, tags } as unknown as ForumBody, { kid: crier.kid, seed: crier.seed });
    const r = await api.postJson("/forum/posts", doc);
    if (r.status !== 201) throw new Error(`could not seed the forum: ${r.json?.error?.message ?? r.status}`);
    prev = r.json.id as string;
  }
  o.onLine?.(`local society on ${base} (log and forum in ${o.dir})`);
  return {
    api, base, enrol,
    head: async () => ({ seq: Number((JSON.parse((await api.get("/forum/head")).text) as { seq?: number }).seq ?? 0) }),
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}
