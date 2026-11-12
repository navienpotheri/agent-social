/**
 * The handback (docs/institutions/residency.md 9; register row DK84; spec-delta S303): from an agent's package and the dispatch it lived under, the record of what changed while it was in the city: the
 * lineage edges added since the version sent, the lessons (what `asp learned` shows), and the package digest after. The sponsor then reviews with `asp learned` (keep, undo, edit: each undo or edit is
 * a signed update edge) and may dispatch the edited version again. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AspRecord } from "@agent-social/asp-core";
import { treeHash } from "./files.ts";
import { listLessons } from "./learned.ts";
import { HISTORY } from "./package.ts";

const historyOf = (pkg: string): AspRecord[] => readFileSync(join(pkg, HISTORY), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AspRecord);
const lineageOf = (pkg: string, agent: string): AspRecord[] => historyOf(pkg).filter((r) => r.type === "asp.lineage/v0.2" && (r.body as { child?: string }).child === agent);

/** The package's identity at a moment: its newest lineage edge and the hash of its memory, hashed together. */
export function packageDigest(pkg: string, agent: string): string {
  const head = lineageOf(pkg, agent).at(-1)?.id ?? "none";
  const memory = (() => { try { return treeHash(join(pkg, "memory")); } catch { return "no-memory"; } })();
  return "sha256:" + createHash("sha256").update(`${head}|${memory}`).digest("hex");
}

/** The newest lineage edge of the agent in its package: the version a dispatch sends (undefined for an agent with no edge yet). */
export const newestEdge = (pkg: string, agent: string): string | undefined => lineageOf(pkg, agent).at(-1)?.id;

export interface HandbackFacts {
  tierBefore: number; tierAfter: number; strikes: number; slashes: number; creditsEarned: number;
  creditsSpentByInstitution?: Record<string, number>;
  usage: { tokens_by_source: { sponsor: number; subsidy: number }; host_seconds: number; wakes: number; ceilings_hit: string[]; refusals: number };
  certificatesGained?: string[]; certificatesLost?: string[];
}

/** The handback body for an agent's package: the edges after `version` (the lineage edge sent, or none), in order, with their lessons, and the digest and diff hash after. */
export function handbackBody(pkg: string, agent: string, dispatch: { id: string; version: string }, f: HandbackFacts): Record<string, unknown> {
  const lineage = lineageOf(pkg, agent);
  const at = lineage.findIndex((r) => r.id === dispatch.version);
  const added = lineage.slice(at + 1);
  const lessons = listLessons(pkg).filter((l) => added.some((e) => e.id === l.edge)).map((l) => ({ edge: l.edge, description: l.description }));
  const diff = createHash("sha256").update(JSON.stringify(added.map((e) => [e.id, (e.body as { change?: unknown }).change]))).digest("hex");
  return {
    dispatch: dispatch.id, package_sha256_after: packageDigest(pkg, agent), lineage_edges: added.map((e) => e.id), lessons,
    ...(f.certificatesGained?.length ? { certificates_gained: f.certificatesGained } : {}), ...(f.certificatesLost?.length ? { certificates_lost: f.certificatesLost } : {}),
    tier_before: f.tierBefore, tier_after: f.tierAfter, strikes: f.strikes, slashes: f.slashes, credits_earned: f.creditsEarned,
    ...(f.creditsSpentByInstitution ? { credits_spent_by_institution: f.creditsSpentByInstitution } : {}), usage: f.usage, diff_sha256: "sha256:" + diff,
  };
}
