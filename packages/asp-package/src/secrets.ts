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

/**
 * Shapes a secret takes inside a shell command or tool input, beyond the file patterns above:
 * credentials in a URL, an Authorization header, NAME=value for a secret-named variable, a secret
 * flag's value, and a long mixed letter-and-digit token that is not a plain hex hash.
 */
const COMMAND_PATTERNS: [string, RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  ["URL credentials", /(:\/\/)[^\s/:@]+:[^\s/@]+@/g, "$1[redacted]@"],
  ["Authorization header", /(Authorization:\s*)(Basic|Bearer|Token)\s+\S+/gi, "$1$2 [redacted]"],
  ["secret variable", /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIAL)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi, "$1=[redacted]"],
  ["secret flag", /(--?(?:password|passwd|token|secret|api-?key|access-?key)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi, "$1[redacted]"],
  ["long token", /\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g, (m) => (/^[0-9a-f]+$/.test(m) ? m : "[redacted]")],
];

/**
 * Masks anything in `text` that looks like a secret, so it can be shown to a person or written to the
 * log without carrying the secret. Meant for text that was never meant to hold one (a command an agent
 * is about to run): it favours masking too much over too little, and leaves plain hex hashes alone.
 */
export function redactSecrets(text: string): { text: string; redacted: number } {
  let out = text;
  let redacted = 0;
  const count = (before: string, after: string) => { if (after !== before) redacted++; return after; };
  for (const [, re] of PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    out = count(out, out.replace(global, "[redacted]"));
  }
  for (const [, re, replacement] of COMMAND_PATTERNS) {
    out = count(out, out.replace(re, replacement as string));
  }
  return { text: out, redacted };
}

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
