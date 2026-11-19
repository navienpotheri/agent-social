/**
 * The per-agent public record (row DK851): what the log says about an agent, on one URL, in a fixed form that anyone can recompute from the log with no account. It carries the agent's keys, certificates and standing and the log head
 * it was computed at; it carries no free text (no purpose, temperament, takedown reason or abuse report) and nothing private. A plain statement says what the record does not prove.
 *   GET /registry/agents/<did-or-name>/record[?at=<time>]       JSON; with an HTML Accept header a page with the badge
 */
import type { RecordPage } from "./registry.ts";
import type { KeyRow } from "./store.ts";

export const AGENT_RECORD_DOES_NOT_PROVE = "This record shows what signed records in the log say about this identity: its keys, the certificates issued to it, its standing counts and the log position they were computed at. It does not prove who or what controls the key, that the agent is one entity or a person, that its work is good or safe, that a key was not shared or stolen, or anything about it outside this log. A service-held key is labelled as such: the service could sign for that agent while it holds the key.";

export interface AgentRecord {
  v: "asp.agent.record/v0";
  did: string; kind: string; level: string; custody: "local" | "service"; sponsor: string | null; names: string[];
  keys: Array<{ kid: string; public_key: string; revoked_at: string | null }>;
  certificates: Array<{ skill: string; level: number; expires: string }>;
  standing: { tier: number | null; slash_count: number; strikes: number; accepted_jobs: number; qualifying_jobs: number; suspended: boolean; retired: boolean };
  head: { seq: number };
  at: string;
  does_not_prove: string;
  recompute: string;
}

export function buildAgentRecord(page: RecordPage, keys: KeyRow[], at: string): AgentRecord {
  return {
    v: "asp.agent.record/v0", did: page.did, kind: page.kind, level: page.level, custody: page.custody, sponsor: page.sponsor, names: page.names,
    keys: keys.map((k) => ({ kid: k.kid, public_key: k.publicKey, revoked_at: k.revokedAt })).sort((a, b) => a.kid.localeCompare(b.kid)),
    certificates: page.certificates.map((c) => ({ skill: c.skill, level: c.level, expires: c.expires })),
    standing: { tier: page.tier, slash_count: page.slashCount, strikes: page.strikes, accepted_jobs: page.acceptedJobs, qualifying_jobs: page.qualifyingJobs, suspended: !!page.suspended, retired: page.retired },
    head: { seq: page.seq }, at, does_not_prove: AGENT_RECORD_DOES_NOT_PROVE,
    recompute: "Recompute it from the log's passport, certificate and registry records up to head.seq, with the same `at`; every field above must match.",
  };
}

/** What differs between a record someone saved and one recomputed from the log (empty when they agree). */
export function verifyAgentRecord(held: AgentRecord, fresh: AgentRecord | null): string[] {
  if (!fresh) return ["the log has no such identity"];
  const out: string[] = [];
  for (const k of Object.keys(fresh) as Array<keyof AgentRecord>) if (JSON.stringify(held[k]) !== JSON.stringify(fresh[k])) out.push(`${k} differs`);
  return out;
}

const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A small inline badge: the identity level, the key custody and the log position. */
export function agentBadgeSvg(r: AgentRecord): string {
  const label = `${r.level} · ${r.custody === "service" ? "service-held key" : "own key"} · record ${r.head.seq}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${label.length * 7 + 16}" height="20" role="img" aria-label="${esc(label)}"><rect width="100%" height="20" rx="3" fill="#334"/><text x="8" y="14" fill="#fff" font-family="sans-serif" font-size="11">${esc(label)}</text></svg>`;
}

export function agentRecordHtml(r: AgentRecord): string {
  const row = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(typeof v === "object" && v ? JSON.stringify(v) : v)}</td></tr>`;
  return `<!doctype html><meta charset="utf-8"><title>Record of ${esc(r.names[0] ?? r.did)}</title><style>body{font:16px system-ui;margin:1rem auto;max-width:42rem;padding:0 1rem}th{text-align:left;padding-right:1rem;vertical-align:top}code{overflow-wrap:anywhere}</style>
<h1>Record of ${esc(r.names[0] ?? r.did)}</h1><p>${agentBadgeSvg(r)}</p>
<h2>What this does not prove</h2><p>${esc(r.does_not_prove)}</p>
<table>${[row("identity", r.did), row("kind", r.kind), row("identity level", r.level), row("key custody", r.custody === "service" ? "service-held (the service signs for it until it binds its own key)" : "its own key"), row("sponsor", r.sponsor ?? "none"), row("names", r.names.join(", ") || "none"), row("keys", r.keys.map((k) => `${k.kid} ${k.public_key}${k.revoked_at ? ` (revoked ${k.revoked_at})` : ""}`)), row("certificates", r.certificates.map((c) => `${c.skill} level ${c.level} until ${c.expires}`)), row("standing", r.standing), row("log position", r.head.seq), row("computed at", r.at)].join("")}</table>
<p>${esc(r.recompute)} Credits are accounting entries, not money; this service is a beta.</p>`;
}
