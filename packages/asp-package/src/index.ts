export { claudeCode, findProjectDataDir, projectSlug, summarizeTranscript } from "./adapters/claude-code.ts";
export { appendCheckpoint, findEquivocations, readCheckpoints, signCheckpoint, verifyCheckpointSignature, type LogCheckpoint } from "./checkpoint.ts";
export { finishPackage, packDirectory, resolvePackage, unpackToTemp, type ResolvedPackage } from "./archive.ts";
export { codex, resolveCodexCommand, summarizeRollout, tomlValue } from "./adapters/codex.ts";
export { openhands } from "./adapters/openhands.ts";
export { toWslPath, wslEnvFor } from "./wsl.ts";
export { listFiles, sha256File, treeHash } from "./files.ts";
export { frontmatter } from "./frontmatter.ts";
export type { Capture, Component, Harness, LaunchPlan, McpServer, RuntimeAdapter, SessionSummary } from "./harness.ts";
export { Keystore, LocalLog, aspHome } from "./home.ts";
export {
  HISTORY, MANIFEST, NO_SCOPE_TOOLS, deriveScopeForTool, deriveScopes, diffTrees, isEmptyDiff, updatePackage, verifyPackage, writePackage,
  type Check, type LineageChange, type TreeDiff, type VerifyPackageReport, type WritePackageOptions,
} from "./package.ts";
export { redactSecrets, resolveSecrets, scanForSecrets, stripSecrets, toEnvRefs, type Env, type SecretFinding } from "./secrets.ts";

import { claudeCode } from "./adapters/claude-code.ts";
import { codex } from "./adapters/codex.ts";
import { openhands } from "./adapters/openhands.ts";
import type { RuntimeAdapter } from "./harness.ts";

/** Runtime adapters by name. */
export const ADAPTERS: Record<string, RuntimeAdapter> = { [claudeCode.name]: claudeCode, [codex.name]: codex, [openhands.name]: openhands };
