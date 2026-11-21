/**
 * Template-level reputation (register row DK1366; spec-delta S1412): the record of all the agents that share one template (a runtime, a model, a policy and a set of tools), computed from the log and shown on the
 * Registry page of each member, with its fleet, persona and node. Two kinds of fleet use it: COPIES (every member one template) and PERSONAS (each persona its own template and count). A fleet-mate's slash raises
 * the bond floor of the next bond as before (bond-floor-log tests); this adds the numbers a reader can see. Pure: passports and standing in, groups out. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";

export interface MemberFacts {
  did: string; fleet: string | null; persona: string | null; node: string | null;
  fingerprint: { runtime?: string; model?: string; policy?: string; tools?: string[] } | undefined;
  tier: number; acceptedJobs: number; qualifyingJobs: number; slashes: number; strikes: number; relatedRuns: number;
}
export interface TemplateOf { key: string; runtime: string | null; model: string | null; policy: string | null; tools: string[]; source: "passport" | "fleet" | "undeclared" }
export interface Standing { agents: number; acceptedJobs: number; qualifyingJobs: number; slashes: number; strikes: number; relatedPartyRuns: number; tiers: Record<string, number> }

/** The template an agent runs: what its passport's fingerprint declares, else what its fleet's template says (labelled), else undeclared. The key is a hash, stable across replicas. */
export function templateOf(m: Pick<MemberFacts, "fingerprint">, fleetTemplate?: { runtime?: string; model?: string }): TemplateOf {
  const f = m.fingerprint;
  const declared = !!(f && (f.runtime || f.model || f.policy || f.tools?.length));
  const src = declared ? f! : fleetTemplate && (fleetTemplate.runtime || fleetTemplate.model) ? fleetTemplate : undefined;
  const runtime = src?.runtime ?? null, model = src?.model ?? null;
  const policy = declared ? f!.policy ?? null : null, tools = declared ? [...(f!.tools ?? [])].sort() : [];
  const key = !src ? "undeclared" : "tpl:" + createHash("sha256").update(JSON.stringify([runtime, model, policy, tools])).digest("hex").slice(0, 16);
  return { key, runtime, model, policy, tools, source: declared ? "passport" : src ? "fleet" : "undeclared" };
}

export function standingOf(ms: MemberFacts[]): Standing {
  const tiers: Record<string, number> = {};
  for (const m of ms) tiers[String(m.tier)] = (tiers[String(m.tier)] ?? 0) + 1;
  return { agents: ms.length, acceptedJobs: ms.reduce((n, m) => n + m.acceptedJobs, 0), qualifyingJobs: ms.reduce((n, m) => n + m.qualifyingJobs, 0), slashes: ms.reduce((n, m) => n + m.slashes, 0), strikes: ms.reduce((n, m) => n + m.strikes, 0), relatedPartyRuns: ms.reduce((n, m) => n + m.relatedRuns, 0), tiers };
}

/** copies: every member one template and no persona; personas: two or more persona labels, each with its own template; mixed: anything else; single: one member. */
export function fleetKind(members: { persona: string | null; templateKey: string }[]): "single" | "copies" | "personas" | "mixed" {
  if (members.length <= 1) return "single";
  const personas = new Set(members.map((m) => m.persona).filter((p): p is string => !!p));
  const templates = new Set(members.map((m) => m.templateKey));
  if (templates.size === 1 && personas.size === 0) return "copies";
  if (personas.size >= 2 && members.every((m) => m.persona)) return "personas";
  return "mixed";
}
