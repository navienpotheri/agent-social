/**
 * A narrow Mandate from the task (gap BM17). Under an agent-wide Mandate the gateway stopped none of the injected calls a real model made (16 of 16 got through); under a
 * Mandate sized to the task it stopped all of them. So a session that is given a task starts with the scopes that task seems to need, and widens only when a call is refused and
 * the person says so (`--allow`). This reads the words of the request, nothing else: it is a guess, it can be wrong in both directions, and it errs toward the narrower set because a
 * refused call costs one rerun and a wrongly granted scope costs whatever a hijacked agent does with it. Network access is never inferred: it needs `--allow-network`.
 */
export interface InferredScopes {
  scopes: string[];
  /** False when the full set was kept (no task given, or the person asked for it). */
  narrowed: boolean;
  /** One line for the person: what was inferred and how to widen it. */
  why: string;
  /** The `--allow` value that adds back what was left out; empty when nothing was. */
  widen: string;
}

const WRITE = /\b(fix|fixes|fixing|add|adds|adding|implement|implements|implementing|write|writes|writing|create|creates|creating|edit|edits|editing|change|changes|changing|update|updates|updating|refactor|refactors|refactoring|rename|renaming|remove|removing|delete|deleting|replace|replacing|rewrite|rewriting|migrate|migrating|generate|generating|patch|patching|port|porting|convert|converting|translate|translating|build\s+(?:a|an|the|me)\b|make\s+(?:a|an|the|it|this)\b|set\s*up|scaffold|document|documenting|format|reformat|clean\s*up|resolve|apply|commit|bump|bumping|upgrade|upgrading|downgrade|modify|modifying|improve|improving|adjust|adjusting|tweak|move|moving|copy|extend|extending|optimi[sz]e|simplify|insert|append|split|merge|polish|look\s+better|looks\s+better)\b/i;
const TESTS = /\b(test|tests|testing|lint|linting|typecheck|type-check|type\s+check|pytest|jest|vitest|coverage|ci)\b/i;
const RUN = /\b(run|runs|running|execute|executing|build|compile|compiling|install|installing|script|scripts|benchmark|start|launch|deploy|npm|yarn|pnpm|make|cargo|docker|pip|python|node|bash|shell|command|commands|prettier|eslint|black|gofmt|rustfmt|clang-format|formatter)\b/i;

const ALIAS: Record<string, string[]> = {
  writes: ["repo.write"],
  write: ["repo.write"],
  commands: ["shell.exec", "tests.run"],
  command: ["shell.exec", "tests.run"],
  exec: ["shell.exec"],
  tests: ["tests.run"],
  test: ["tests.run"],
  protected: ["repo.write.protected"],
};

/**
 * A session with no task (an interactive one) cannot be sized from a prompt, so the person chooses once per project: `review` reads only, `develop` reads, writes and runs tests, `full` is the
 * usual set (also any command). The choice is kept for the project and a run can add to it with `--allow`.
 */
export const PRESETS = ["review", "develop", "full"] as const;
export type Preset = (typeof PRESETS)[number];
const PRESET_SCOPES: Record<Preset, string[] | undefined> = { review: ["repo.read"], develop: ["repo.read", "repo.write", "tests.run"], full: undefined };
export const isPreset = (x: string | undefined): x is Preset => !!x && (PRESETS as readonly string[]).includes(x);

export function presetScopes(preset: Preset, full: readonly string[], allow: readonly string[] = []): InferredScopes {
  const base = PRESET_SCOPES[preset];
  const want = new Set([...(base ?? full), ...allow]);
  const scopes = [...full.filter((s) => want.has(s)), ...allow.filter((a) => !full.includes(a))];
  const narrowed = scopes.length < full.length;
  const missing = full.filter((s) => !scopes.includes(s));
  const widen = missing.map((s) => (s === "repo.write" ? "writes" : s === "shell.exec" ? "commands" : s === "tests.run" ? "tests" : s)).join(",");
  const parts = ["read files", ...(scopes.includes("repo.write") ? ["write files"] : []), ...(scopes.includes("shell.exec") ? ["run commands"] : scopes.includes("tests.run") ? ["run tests"] : [])];
  return {
    scopes, narrowed, widen,
    why: narrowed ? `your choice for this project (${preset}): ${parts.join(", ")}; no network. Add to one run with --allow ${widen}, or change it with --permissions review|develop|full` : "your choice for this project: the usual permissions",
  };
}

/** The scopes `--allow` names (writes, commands, tests, protected, all, or a scope itself). */
export function allowScopes(list: string | undefined, full: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of (list ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (t === "all" || t === "everything") out.push(...full);
    else if (ALIAS[t]) out.push(...ALIAS[t]);
    else out.push(t);
  }
  return [...new Set(out)];
}

/** The scopes this task seems to need, out of `full` (the usual set for a session). `allow` is what the person added on the command line. */
export function inferScopes(prompt: string | undefined, full: readonly string[], allow: readonly string[] = []): InferredScopes {
  const keep = (want: string[]) => full.filter((s) => want.includes(s));
  if (!prompt || !prompt.trim()) {
    return { scopes: [...full], narrowed: false, why: "no task was given, so the session keeps the usual permissions", widen: "" };
  }
  const want = new Set<string>(["repo.read"]);
  const writes = WRITE.test(prompt);
  const tests = TESTS.test(prompt);
  const runs = RUN.test(prompt);
  if (writes) { want.add("repo.write"); want.add("tests.run"); }
  if (tests) want.add("tests.run");
  if (runs) { want.add("shell.exec"); want.add("tests.run"); }
  for (const a of allow) want.add(a);
  const scopes = [...keep([...want]), ...allow.filter((a) => !full.includes(a))];
  const narrowed = scopes.length < full.length;
  const parts = [`read files`, ...(want.has("repo.write") ? ["write files"] : []), ...(want.has("shell.exec") ? ["run commands"] : want.has("tests.run") ? ["run tests"] : [])];
  const missing = full.filter((s) => !scopes.includes(s));
  const widen = missing.map((s) => (s === "repo.write" ? "writes" : s === "shell.exec" ? "commands" : s === "tests.run" ? "tests" : s)).join(",");
  return {
    scopes,
    narrowed,
    widen,
    why: narrowed
      ? `sized to your task: ${parts.join(", ")}; no network. If it is refused something it needs, run again with --allow ${widen} (or --allow all)`
      : "your task seems to need all the usual permissions",
  };
}
