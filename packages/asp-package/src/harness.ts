import type { Env } from "./secrets.ts";

/** harness/harness.json — see spec/package/harness.schema.json. */
export interface Harness {
  format: "asp.harness/v0.1";
  instructions: { name: string; scope: "project" | "local" | "user" | "rules"; path: string; applies_to?: string[] }[];
  skills: Component[];
  subagents: Component[];
  commands: Component[];
  hooks: Record<string, unknown>;
  mcp_servers: Record<string, McpServer>;
  permissions: { allow: string[]; deny: string[]; ask: string[]; default_mode?: string };
  env: Env;
  model?: string;
  secrets?: string[];
  runtime_specific?: Record<string, unknown>;
}

export interface Component {
  name: string;
  description?: string;
  path: string;
  scope?: "project" | "user";
}

export interface McpServer {
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Env;
  headers?: Env;
  [k: string]: unknown;
}

/** One session from the runtime's history: metadata only, never content. */
export interface SessionSummary {
  session: string;
  runtime: string;
  runtime_version?: string;
  started_at?: string;
  ended_at?: string;
  models: string[];
  prompts: number;
  assistant_turns: number;
  tool_calls: Record<string, number>;
  tool_errors: number;
  output_tokens: number;
}

/** What an adapter captures from a runtime, staged in a directory laid out like a package. */
export interface Capture {
  /** Staging dir holding harness/, memory/ and experience/. */
  dir: string;
  harness: Harness;
  runtime: { name: string; version?: string; model?: string };
  sessions: number;
  warnings: string[];
}

export interface LaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  /** Extra environment for the child process (resolved secrets). Never printed. */
  env: Record<string, string>;
  /** Files the adapter wrote, relative to the run dir. */
  files: string[];
  runDir: string;
  /** Where the runtime keeps the agent's memory during the run, laid out like the package's memory/. */
  memoryDir?: string;
  missingSecrets: string[];
  notes: string[];
  /**
   * Some runtimes exit 0 even after a fatal error inside the run (OpenHands' headless mode does this
   * on an LLM authentication failure). When set, `asp run` scans each line of the child's stdout and
   * treats a match as a failed run regardless of the exit code, skipping write-back.
   */
  checkOutputForFailure?: (line: string) => string | undefined;
}

export interface RuntimeAdapter {
  name: string;
  capture(opts: { project: string; includeUser: boolean; home?: string; staging: string }): Promise<Capture>;
  materialize(opts: {
    pkgDir: string; harness: Harness; project: string; runDir: string; agentName: string; prompt?: string; env: NodeJS.ProcessEnv;
    /** Model to run; overrides the packed one. */
    model?: string;
    /** The runtime the package was captured from; a packed model is used only on that runtime. */
    sourceRuntime?: string;
  }): Promise<LaunchPlan>;
}
