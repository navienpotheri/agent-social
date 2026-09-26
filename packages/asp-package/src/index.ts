export { claudeCode, findProjectDataDir, projectSlug, summarizeTranscript } from "./adapters/claude-code.ts";
export { listFiles, sha256File, treeHash } from "./files.ts";
export { frontmatter } from "./frontmatter.ts";
export type { Capture, Component, Harness, LaunchPlan, McpServer, RuntimeAdapter, SessionSummary } from "./harness.ts";
export { Keystore, LocalLog, aspHome } from "./home.ts";
export {
  HISTORY, MANIFEST, deriveScopes, diffTrees, isEmptyDiff, updatePackage, verifyPackage, writePackage,
  type Check, type LineageChange, type TreeDiff, type VerifyPackageReport, type WritePackageOptions,
} from "./package.ts";
export { resolveSecrets, scanForSecrets, stripSecrets, toEnvRefs, type Env, type SecretFinding } from "./secrets.ts";

import { claudeCode } from "./adapters/claude-code.ts";
import type { RuntimeAdapter } from "./harness.ts";

/** Runtime adapters by name. Codex CLI and OpenHands come next. */
export const ADAPTERS: Record<string, RuntimeAdapter> = { [claudeCode.name]: claudeCode };
