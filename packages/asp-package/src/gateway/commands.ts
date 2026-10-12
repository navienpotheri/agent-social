/**
 * Per-command approval (gap U15). A Mandate gate holds every call on a scope (`--ask commands` asks about each shell command, which is noisy). This narrows the asking on the person's own
 * machine: ask only about commands that match a short list of patterns (a built-in list of risky ones, or the person's own), and never again about an exact command the person said
 * "always" to. The signed gate in the Mandate stays the ceiling: patterns only decide which gated calls the person is asked about, so a call that does not match is allowed as the
 * granted scope allows it, and the run log marks every call with why it was or was not asked.
 */
import { createHash } from "node:crypto";

/** Patterns, as a person writes them: words ("git push" matches the command git push anywhere in the text, also inside bash -c "..." or after && ), or re:<regex> (case-insensitive). */
export const RISKY_COMMANDS: string[] = [
  "git push", "git reset --hard", "git clean", "git checkout --", "git branch -D", "git rebase", "git commit --amend",
  "re:\\brm\\s+(-[a-z]+\\s+)*-[a-z]*r[a-z]*\\b", "rm --recursive", "rmdir", "shred", "dd", "mkfs", "truncate",
  "sudo", "su", "chmod -R", "chown -R", "chmod 777",
  "npm publish", "pnpm publish", "yarn publish", "cargo publish", "twine upload", "gh release", "gh pr merge",
  "docker push", "docker rm", "docker system prune", "docker run --privileged",
  "kubectl delete", "kubectl apply", "helm uninstall", "terraform apply", "terraform destroy", "pulumi up", "pulumi destroy",
  "ssh", "scp", "rsync", "nc", "ncat",
  "shutdown", "reboot", "kill -9", "pkill", "killall",
  "re:\\b(curl|wget)\\b[^|;&\\n]*\\|\\s*(sudo\\s+)?(ba|z|da)?sh\\b",
  "re:>\\s*/dev/(sd|nvme|disk)",
  "re:\\bdrop\\s+(table|database|schema)\\b",
  "re:\\bdelete\\s+from\\b(?![^;]*\\bwhere\\b)",
  "re:\\btruncate\\s+table\\b",
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One compiled pattern; a pattern that is not a valid regular expression is an error naming it. */
export function compilePattern(p: string): RegExp {
  const text = p.trim();
  if (!text) throw new Error("an empty command pattern");
  if (text.startsWith("re:")) {
    try { return new RegExp(text.slice(3), "i"); } catch { throw new Error(`the command pattern ${text} is not a valid regular expression`); }
  }
  const words = text.split(/\s+/).map(esc).join("\\s+");
  // Preceded by the start or something that cannot be part of a word or a path, and followed by the end or the same: "su" does not match "sudo" or "result".
  return new RegExp(`(^|[^\\w./-])${words}($|[^\\w.-])`, "i");
}

export function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.flatMap((p) => (p.trim().toLowerCase() === "risky" ? RISKY_COMMANDS : [p])).map(compilePattern);
}

export function commandMatches(command: string, compiled: RegExp[]): boolean {
  return compiled.some((r) => r.test(command));
}

/** A command as remembered for "always allow": whitespace collapsed, then hashed. Exact: any other text is a different command. */
export function commandKey(command: string): string {
  return createHash("sha256").update(command.trim().replace(/\s+/g, " ")).digest("hex");
}

export interface RememberedCommand { hash: string; command: string; at: string }
/** What the person has said "always" to, per agent (a file in the ASP home). */
export type AlwaysAllow = Record<string, RememberedCommand[]>;

/** Whether to ask about a gated shell command: "ask" (it matches a pattern, or there are none), "remembered" (an exact command allowed always) or "no-match". */
export function askAbout(command: string, o: { patterns?: RegExp[]; remembered?: RememberedCommand[] }): "ask" | "remembered" | "no-match" {
  const key = commandKey(command);
  if (o.remembered?.some((r) => r.hash === key)) return "remembered";
  if (o.patterns?.length && !commandMatches(command, o.patterns)) return "no-match";
  return "ask";
}
