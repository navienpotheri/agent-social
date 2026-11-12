/**
 * Agents that act outside the model loop (gap H10): code the agent runs by itself (installing a package, scraping a URL it saw in the prompt, downloading a browser, running a
 * test command it chose, committing) is not a tool call the model asked for, so the gateway never sees it. The only thing that bounds it is the sandbox, whose way out is
 * the gateway's egress proxy. This list says which known agents do it and by default, and what to switch off; `asp run` prints the note when the run is not in a sandbox.
 * Seen live: Aider saw a URL in the prompt, offered to scrape it, auto-installed Playwright and began downloading Chromium, none of it through a tool call.
 */
export interface SelfActing {
  /** The program name, as started (without extension). */
  program: string;
  title: string;
  /** What it does by itself, outside the model's tool calls. */
  risky: string[];
  /** What to switch off, when the agent has a switch. */
  switchOff: string[];
}

export const SELF_ACTING: SelfActing[] = [
  { program: "aider", title: "Aider",
    risky: ["offers to scrape any URL it sees in the prompt, and installs a headless browser (Playwright, then a Chromium download) to do it", "runs the lint and test commands it is configured with, and commits to git by itself", "edits through a text format, so its edits are never structured tool calls"],
    switchOff: ["--no-auto-commits", "--no-auto-lint --no-auto-test", "--no-suggest-shell-commands", "do not paste URLs into the prompt"] },
  { program: "openhands", title: "OpenHands",
    risky: ["runs commands and a browser in its own runtime container, with that container's network", "installs packages when a task needs them"],
    switchOff: ["run it with the sandbox so the only way out is the gateway", "disable the browser tool in its config"] },
  { program: "goose", title: "Goose",
    risky: ["its extensions (developer, browser, computer controller) run their own processes and network calls", "auto-approve mode runs shell commands without a model tool call being visible"],
    switchOff: ["turn off the extensions you do not need in its configuration", "keep GOOSE_MODE=approve so it asks before running a command"] },
  { program: "codex", title: "Codex",
    risky: ["runs shell commands from its own sandbox policy, which may allow network", "applies patches and runs them without a separate tool call"],
    switchOff: ["--sandbox read-only or workspace-write without network", "ask-for-approval on"] },
  { program: "claude", title: "Claude Code",
    risky: ["hooks, MCP servers and slash commands run programs of their own", "WebFetch and Bash run from its own permission settings"],
    switchOff: ["review hooks and MCP servers in settings; run it through asp run so the gateway judges the calls"] },
  { program: "agy", title: "Antigravity",
    risky: ["its browser agent navigates pages by itself"], switchOff: ["run with the sandbox; the pre-call hook judges only what it is asked about"] },
];

const base = (arg: string) => arg.replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|bat|ps1|js|mjs|py)$/i, "").toLowerCase();

/** The self-acting entry for a command (its program, or the script after python or node), or undefined. */
export function selfActingFor(command: readonly string[]): SelfActing | undefined {
  const names = [command[0], command[1]].filter((x): x is string => !!x).map(base);
  return SELF_ACTING.find((s) => names.includes(s.program) || (s.program === "claude" && names.includes("claude-code")));
}

/** Lines for the person at the start of a run: empty when the run is in a sandbox (the way out is the gateway) or the program is not on the list. */
export function selfActingNotes(command: readonly string[], sandboxed: boolean): string[] {
  const s = selfActingFor(command);
  if (!s || sandboxed) return [];
  return [
    `${s.title} acts by itself outside the model's tool calls, which the gateway does not see: ${s.risky.join("; ")}.`,
    `Run it with --sandbox so its only way out is the gateway${s.switchOff.length ? `, or switch off: ${s.switchOff.join("; ")}` : ""}.`,
  ];
}
