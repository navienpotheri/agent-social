/**
 * Agent package layout (a directory):
 *
 *   manifest.json              signed asp.package/v0.2 record (issued by the agent)
 *   records/history.ndjson     signed records the package depends on: passports (agent, sponsor), fleet, lineage
 *   harness/harness.json       runtime-neutral harness (spec/package/harness.schema.json) + its files
 *   memory/                    the agent's memory files
 *   experience/sessions.ndjson metadata-only index of past sessions
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
 * Coarse ASP scopes from runtime permission rules, for the manifest's permissions field.
 * A heuristic view for principals; the harness keeps the exact rules.
 */
export function deriveScopes(rules: string[]): string[] {
  const scopes = new Set<string>();
  for (const rule of rules) {
    const tool = rule.split("(")[0];
    const arg = /\((.*)\)/.exec(rule)?.[1] ?? "";
    if (["Read", "Grep", "Glob", "LS", "NotebookRead"].includes(tool)) scopes.add("repo.read");
    else if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) scopes.add("repo.write");
    else if (tool === "WebFetch" || tool === "WebSearch") scopes.add("web.read");
    else if (tool === "Bash" || tool === "PowerShell") {
      if (/^git push/.test(arg)) scopes.add("repo.push");
      else if (/^gh pr (create|merge)/.test(arg)) scopes.add(arg.startsWith("gh pr merge") ? "pr.merge" : "pr.open");
      else if (/(test|pytest|jest|vitest|cargo test|go test)/.test(arg)) scopes.add("tests.run");
      else scopes.add("shell.exec");
    } else if (tool.startsWith("mcp__")) {
      const [, server, name] = tool.split("__");
      scopes.add(`mcp.${server.toLowerCase().replace(/[^a-z0-9_]/g, "_")}${name ? `.${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}` : ""}`);
    } else scopes.add(`tool.${tool.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`);
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
