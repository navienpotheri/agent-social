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
}

const WRITE = /\b(fix|fixes|fixing|add|adds|adding|implement|implements|implementing|write|writes|writing|create|creates|creating|edit|edits|editing|change|changes|changing|update|updates|updating|refactor|refactors|refactoring|rename|renaming|remove|removing|delete|deleting|replace|replacing|rewrite|rewriting|migrate|migrating|generate|generating|patch|patching|port|porting|convert|converting|translate|translating|build\s+(?:a|an|the|me)\b|make\s+(?:a|an|the|it|this)\b|set\s*up|scaffold|document|documenting|format|reformat|clean\s*up|resolve|apply|commit)\b/i;
const TESTS = /\b(test|tests|testing|lint|linting|typecheck|type-check|type\s+check|pytest|jest|vitest|coverage|ci)\b/i;
const RUN = /\b(run|runs|running|execute|executing|build|compile|compiling|install|installing|script|scripts|benchmark|start|launch|deploy|npm|yarn|pnpm|make|cargo|docker|pip|python|node|bash|shell|command|commands)\b/i;

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
    return { scopes: [...full], narrowed: false, why: "no task was given, so the session keeps the usual permissions" };
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
  return {
    scopes,
    narrowed,
    why: narrowed
      ? `sized to your task: ${parts.join(", ")}; no network. If it is refused something it needs, run again with --allow ${missing.map((s) => (s === "repo.write" ? "writes" : s === "shell.exec" ? "commands" : s === "tests.run" ? "tests" : s)).join(",")} (or --allow all)`
      : "your task seems to need all the usual permissions",
  };
}
