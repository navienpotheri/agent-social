import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles } from "./files.ts";

export type EnvValue = string | { $secret: string };
export type Env = Record<string, EnvValue>;

/** A value that only references an environment variable, e.g. "${GITHUB_TOKEN}". */
const PURE_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}$/;

const secretName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^([^A-Z])/, "S_$1");

/**
 * Replaces every literal value with a {$secret} placeholder named after its key, so no secret
 * leaves the machine. Values that already reference an env var keep that variable's name.
 * Collects the names in `secrets`.
 */
export function stripSecrets(env: Record<string, string> | undefined, secrets: Set<string>, prefix = ""): Env {
  const out: Env = {};
  for (const [k, v] of Object.entries(env ?? {})) {
    const ref = PURE_REF.exec(v);
    const name = ref ? ref[1] : secretName(prefix + k);
    secrets.add(name);
    out[k] = { $secret: name };
  }
  return out;
}

/** Placeholders back to "${NAME}" references, for runtimes that expand them from the environment. */
export function toEnvRefs(env: Env | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env ?? {})) out[k] = typeof v === "string" ? v : `\${${v.$secret}}`;
  return out;
}

/** Resolves placeholders from an environment; returns the names that are missing. */
export function resolveSecrets(env: Env | undefined, from: NodeJS.ProcessEnv): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const [k, v] of Object.entries(env ?? {})) {
    if (typeof v === "string") values[k] = v;
    else if (from[v.$secret] !== undefined) values[k] = from[v.$secret]!;
    else missing.push(v.$secret);
  }
  return { values, missing };
}

const PATTERNS: [string, RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI-style API key", /\bsk-(proj-)?[A-Za-z0-9]{20,}/],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["AWS access key id", /\b(AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/],
  ["password assignment", /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"'\s${}]{8,}["']/i],
];

export interface SecretFinding {
  file: string;
  line: number;
  kind: string;
}

/** Scans text files under dir for secret-like strings. Reports where, never the value. */
export function scanForSecrets(dir: string, prefix = ""): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const rel of listFiles(dir)) {
    const buf = readFileSync(join(dir, rel));
    if (buf.includes(0)) continue; // binary
    const lines = buf.toString("utf8").split(/\r?\n/);
    lines.forEach((text, i) => {
      for (const [kind, re] of PATTERNS) {
        if (re.test(text)) {
          findings.push({ file: prefix + rel, line: i + 1, kind });
          break;
        }
      }
    });
  }
  return findings;
}
