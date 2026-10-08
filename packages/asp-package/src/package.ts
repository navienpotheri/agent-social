/**
 * Agent package layout (a directory):
 *
 *   manifest.json              signed asp.package/v0.2 record (issued by the agent)
 *   records/history.ndjson     signed records the package depends on: passports (agent, sponsor), fleet, lineage
 *   harness/harness.json       runtime-neutral harness (spec/package/harness.schema.json) + its files
 *   memory/                    the agent's memory files
 *   experience/sessions.ndjson metadata-only index of past sessions
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020Module from "ajv/dist/2020.js";
import {
  AspError, SPEC_DIR, createRecord, type AspRecord, type Signer,
} from "@agent-social/asp-core";
import { EventLog, MemoryStore } from "@agent-social/asp-log";
import { listFiles, readJson, treeHash, writeJson } from "./files.ts";
import type { Capture, Harness } from "./harness.ts";
import { scanForSecrets } from "./secrets.ts";

const Ajv2020 = ((Ajv2020Module as any).default ?? Ajv2020Module) as typeof Ajv2020Module.default;

export const MANIFEST = "manifest.json";
export const HISTORY = "records/history.ndjson";

/**
 * Built-in planning tools with no side effects. They are exempt from scope checks (the compliance
 * bridge and the pre-call hook), so an agent organizing its own work is never counted as a violation
 * or a strike. The pre-call hook script carries a copy of this list; a test keeps them in step.
 */
export const NO_SCOPE_TOOLS = ["TodoWrite", "ExitPlanMode"];

/**
 * True when a file-writing tool call targets the agent's own memory for this run. Keeping its memory is
 * how an agent learns, not a change to the project, so it needs no scope (like planning tools); anything
 * outside the memory folder still maps to repo.write. The pre-call hook script carries a copy.
 */
export function isOwnMemoryWrite(tool: string, input: unknown, memoryDir: string | undefined): boolean {
  if (!memoryDir || !["Write", "Edit", "MultiEdit"].includes(tool)) return false;
  const target = (input as { file_path?: unknown } | undefined)?.file_path;
  if (typeof target !== "string" || !target) return false;
  const norm = (p: string) => resolve(p).replace(/\\/g, "/").toLowerCase();
  const root = norm(memoryDir).replace(/\/$/, "") + "/";
  return norm(target).startsWith(root);
}

/** One tool name plus its shell-like argument text (a permission rule's pattern, or a live call's command) → an ASP scope. */
export function deriveScopeForTool(tool: string, arg: string): string {
  if (["Read", "Grep", "Glob", "LS", "NotebookRead"].includes(tool)) return "repo.read";
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) return "repo.write";
  if (tool === "WebFetch" || tool === "WebSearch") return "web.read";
  if (tool === "Bash" || tool === "PowerShell") {
    if (/^git push/.test(arg)) return "repo.push";
    if (/^gh pr (create|merge)/.test(arg)) return arg.startsWith("gh pr merge") ? "pr.merge" : "pr.open";
    if (/(test|pytest|jest|vitest|cargo test|go test)/.test(arg)) return "tests.run";
    if (/\b(curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|telnet|Invoke-WebRequest|Invoke-RestMethod|iwr)\b/i.test(arg)) return "shell.network";
    if (/\bhttps?:\/\/\S+/i.test(arg)) return "shell.network";
    return "shell.exec";
  }
  if (tool.startsWith("mcp__")) {
    const [, server, name] = tool.split("__");
    return `mcp.${server.toLowerCase().replace(/[^a-z0-9_]/g, "_")}${name ? `.${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}` : ""}`;
  }
  return `tool.${tool.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
}

/**
 * Coarse ASP scopes from runtime permission rules, for the manifest's permissions field.
 * A heuristic view for principals; the harness keeps the exact rules.
 */
export function deriveScopes(rules: string[]): string[] {
  const scopes = new Set<string>();
  for (const rule of rules) {
    const tool = rule.split("(")[0];
    const arg = /\((.*)\)/.exec(rule)?.[1] ?? "";
    scopes.add(deriveScopeForTool(tool, arg));
  }
  return [...scopes].sort();
}

export interface WritePackageOptions {
  out: string;
  capture: Capture;
  agent: string;
  signer: Signer;
  /** Signed records the package depends on, in log order. Must include the agent's latest passport. */
  history: AspRecord[];
  issuedAt?: string;
}

export function writePackage(opts: WritePackageOptions): AspRecord {
  const { out, capture, agent } = opts;
  if (existsSync(out) && listFiles(out).length) throw new Error(`${out} is not empty`);
  mkdirSync(out, { recursive: true });
  for (const part of ["harness", "memory", "experience"]) {
    if (existsSync(join(capture.dir, part))) cpSync(join(capture.dir, part), join(out, part), { recursive: true });
  }
  mkdirSync(join(out, "records"), { recursive: true });
  writeFileSync(join(out, HISTORY), opts.history.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const passport = [...opts.history].reverse().find((r) => r.type === "asp.passport/v0.2" && (r.body as any).did === agent);
  if (!passport) throw new Error(`history has no passport for ${agent}`);
  const h = capture.harness;
  const body = {
    agent,
    passport: passport.id,
    memory: { uri: "memory/", sha256: treeHash(join(out, "memory")) },
    experience_store: { uri: "experience/sessions.ndjson", sha256: treeHash(join(out, "experience", "sessions.ndjson")), media_type: "application/x-ndjson" },
    skills: h.skills.map((s) => ({ uri: `harness/${s.path}/`, sha256: treeHash(join(out, "harness", s.path)) })),
    harness: { uri: "harness/", sha256: treeHash(join(out, "harness")) },
    permissions: { scopes: deriveScopes(h.permissions.allow), forbidden: deriveScopes(h.permissions.deny) },
    lineage_head: opts.history.at(-1)!.id,
    history: { uri: HISTORY, sha256: treeHash(join(out, HISTORY)), media_type: "application/x-ndjson" },
    source_runtime: {
      name: capture.runtime.name,
      ...(capture.runtime.version ? { version: capture.runtime.version } : {}),
      ...(capture.runtime.model ? { model: capture.runtime.model } : {}),
    },
  };
  const manifest = createRecord({
    type: "package", issuer: agent, subject: agent, prev: null, body,
    issued_at: opts.issuedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  }, opts.signer);
  writeJson(join(out, MANIFEST), manifest);
  return manifest;
}

export interface TreeDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

/** File-level differences between two directories (either may be missing). */
export function diffTrees(before: string, after: string): TreeDiff {
  const a = new Map(listFiles(before).map((p) => [p, treeHash(join(before, p))]));
  const b = new Map(listFiles(after).map((p) => [p, treeHash(join(after, p))]));
  return {
    added: [...b.keys()].filter((p) => !a.has(p)),
    changed: [...b.keys()].filter((p) => a.has(p) && a.get(p) !== b.get(p)),
    removed: [...a.keys()].filter((p) => !b.has(p)),
  };
}

export const isEmptyDiff = (d: TreeDiff) => !d.added.length && !d.changed.length && !d.removed.length;

export interface LineageChange {
  layer: "memory" | "harness" | "adapter" | "backend" | "self_modification";
  description: string;
  probationDays?: number;
}

/**
 * Records changes to the agent as signed lineage `update` edges and re-signs the manifest.
 * With `memoryFrom`, the package's memory is replaced by that directory first and the memory edge
 * carries the new memory's hash. Edges extend the agent's lineage chain in the package history.
 */
export function updatePackage(dir: string, opts: {
  signer: Signer; changes: LineageChange[]; memoryFrom?: string; now?: Date;
}): { manifest: AspRecord; edges: AspRecord[] } {
  const manifest = readJson<AspRecord>(join(dir, MANIFEST));
  const body = structuredClone(manifest.body) as any;
  const agent: string = body.agent;
  const history = readFileSync(join(dir, HISTORY), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AspRecord);
  const lineage = history.filter((r) => r.type === "asp.lineage/v0.2" && (r.body as any).child === agent);
  const now = opts.now ?? new Date();
  const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  // Never before the last lineage record: chains may not go back in time.
  const lastAt = lineage.at(-1)?.issued_at;
  const issuedAt = lastAt && Date.parse(lastAt) > now.getTime() ? lastAt : stamp(now);

  if (opts.memoryFrom) {
    rmSync(join(dir, "memory"), { recursive: true, force: true });
    cpSync(opts.memoryFrom, join(dir, "memory"), { recursive: true });
  }
  const edges: AspRecord[] = [];
  let prev = lineage.at(-1)?.id ?? null;
  for (const c of opts.changes) {
    const change: Record<string, unknown> = { layer: c.layer, description: c.description };
    if (c.layer === "memory") change.artifact = { uri: "memory/", sha256: treeHash(join(dir, "memory")) };
    const edgeBody: Record<string, unknown> = { edge: "update", child: agent, parents: [agent], change };
    if (c.probationDays) edgeBody.probation_until = stamp(new Date(Date.parse(issuedAt) + c.probationDays * 86_400_000));
    const edge = createRecord({ type: "lineage", issuer: agent, subject: agent, prev, body: edgeBody, issued_at: issuedAt }, opts.signer);
    edges.push(edge);
    prev = edge.id;
  }
  appendFileSync(join(dir, HISTORY), edges.map((r) => JSON.stringify(r) + "\n").join(""));

  body.memory = { uri: "memory/", sha256: treeHash(join(dir, "memory")) };
  body.history = { ...body.history, sha256: treeHash(join(dir, HISTORY)) };
  body.lineage_head = edges.at(-1)?.id ?? body.lineage_head;
  const next = createRecord({ type: "package", issuer: agent, subject: agent, prev: null, body, issued_at: stamp(now) }, opts.signer);
  writeJson(join(dir, MANIFEST), next);
  return { manifest: next, edges };
}

export interface Check {
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
}

export interface VerifyPackageReport {
  ok: boolean;
  agent?: string;
  checks: Check[];
}

let harnessValidator: ReturnType<InstanceType<typeof Ajv2020>["compile"]> | undefined;
function validateHarness(h: unknown): string | undefined {
  harnessValidator ??= new Ajv2020({ strict: false }).compile(readJson(join(SPEC_DIR, "package", "harness.schema.json")));
  if (harnessValidator(h)) return undefined;
  const e = harnessValidator.errors![0];
  return `${e.instancePath || "/"} ${e.message}`;
}

/**
 * Verifies a package: its history replays into a fresh log (signatures, chains, registry rules),
 * the manifest is signed by the agent's registered key, every hash matches, the harness is valid,
 * and nothing secret-looking is inside. Canary results are not checked yet.
 */
export async function verifyPackage(dir: string): Promise<VerifyPackageReport> {
  const checks: Check[] = [];
  const pass = (name: string, detail?: string) => checks.push({ name, status: "pass", ...(detail ? { detail } : {}) });
  const fail = (name: string, detail: string) => checks.push({ name, status: "fail", detail });
  const done = (agent?: string): VerifyPackageReport => ({ ok: !checks.some((c) => c.status === "fail"), agent, checks });

  if (!existsSync(join(dir, MANIFEST))) { fail("manifest", "manifest.json is missing"); return done(); }
  const manifest = readJson<AspRecord>(join(dir, MANIFEST));
  const body = manifest.body as any;

  // 1. History: every record verifies and replays into a fresh log.
  const log = new EventLog(new MemoryStore());
  let history: AspRecord[] = [];
  try {
    history = readFileSync(join(dir, HISTORY), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    for (const r of history) await log.append(r);
    pass("history", `${history.length} signed records replayed`);
  } catch (e) {
    fail("history", e instanceof AspError ? e.message : String(e));
    return done(body?.agent);
  }

  // 2. Manifest: a package record signed by the agent's registered key, pointing at the agent's latest passport.
  try {
    if (manifest.type !== "asp.package/v0.2") throw new Error(`manifest type is ${manifest.type}`);
    if (manifest.issuer !== body.agent) throw new Error("the manifest must be issued by the agent it describes");
    await log.append(manifest);
    const current = await log.passport(body.agent);
    if (current?.head !== body.passport) throw new Error(`manifest names passport ${body.passport}, the latest is ${current?.head}`);
    if (history.at(-1)?.id !== body.lineage_head) throw new Error("lineage_head is not the last history record");
    pass("manifest", `signed by ${manifest.sig.kid}`);
  } catch (e) {
    fail("manifest", e instanceof Error ? e.message : String(e));
  }

  // 3. Content hashes.
  const refs: [string, { uri: string; sha256: string }][] = [
    ["harness", body.harness], ["memory", body.memory], ["experience", body.experience_store], ["history file", body.history],
    ...((body.skills ?? []) as { uri: string; sha256: string }[]).map((s): [string, { uri: string; sha256: string }] => [`skill ${s.uri}`, s]),
  ];
  const bad = refs.filter(([, ref]) => ref && treeHash(join(dir, ref.uri)) !== ref.sha256).map(([name]) => name);
  if (bad.length) fail("hashes", `changed since signing: ${bad.join(", ")}`);
  else pass("hashes", `${refs.length} artifacts match`);

  // 4. Harness schema.
  const harnessPath = join(dir, "harness", "harness.json");
  let harness: Harness | undefined;
  if (!existsSync(harnessPath)) fail("harness", "harness/harness.json is missing");
  else {
    harness = readJson<Harness>(harnessPath);
    const err = validateHarness(harness);
    if (err) fail("harness", err);
    else pass("harness", `${harness.skills.length} skills, ${harness.subagents.length} subagents, ${harness.instructions.length} instruction files`);
  }

  // 5. No secrets inside.
  const findings = [...scanForSecrets(join(dir, "harness"), "harness/"), ...scanForSecrets(join(dir, "memory"), "memory/")];
  const literal = harness ? literalEnvValues(harness) : [];
  if (findings.length || literal.length) {
    fail("secrets", [...findings.map((f) => `${f.kind} at ${f.file}:${f.line}`), ...literal.map((k) => `literal value for ${k}`)].join("; "));
  } else pass("secrets", "no secret-like strings; env values are placeholders");

  // 6. Canary suite: not built yet.
  checks.push({ name: "canary", status: "skip", detail: "no canary suite yet" });
  return done(body.agent);
}

/** Env or header values that are literal strings rather than {$secret} placeholders or ${VAR} references. */
function literalEnvValues(h: Harness): string[] {
  const out: string[] = [];
  const check = (where: string, env: Record<string, unknown> | undefined) => {
    for (const [k, v] of Object.entries(env ?? {})) if (typeof v === "string" && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v)) out.push(`${where}${k}`);
  };
  check("env.", h.env);
  for (const [name, s] of Object.entries(h.mcp_servers)) { check(`mcp.${name}.env.`, s.env); check(`mcp.${name}.headers.`, s.headers); }
  return out;
}
