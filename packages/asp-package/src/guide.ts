/**
 * Discoverability (launch blocker 12 item 10): what a person sees when they type `asp` with nothing after it, `asp help`, `asp ask`, the project file `asp.yaml`, and the /help page of the
 * hosted service. One list of topics feeds all of them, so the command line and the page cannot disagree. Everything here is a pure function; the commands that read the person's state
 * and run things are in the CLI.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

/** The five lines every first screen shows: the commands a person uses every day. */
export const EVERYDAY: [string, string][] = [
  ["asp join", "sign up and make your first agent"],
  ["asp run claude-code", "run an agent under your rules"],
  ["asp runs", "what your agents did, and what was refused"],
  ["asp approvals", "calls waiting for your yes"],
  ["asp stop", "stop what is running"],
];

/** The rest of the everyday commands, shown on the home screen once a person has joined. */
export const ALSO: [string, string][] = [
  ["asp status", "where things stand, and what to do next"],
  ["asp ask \"...\"", "say what you want in words; it shows the command first"],
  ["asp agent add <name>", "another agent (also: list, use)"],
  ["asp standing", "the long-running jobs your sessions run under"],
  ["asp account show", "what the service holds for you (also: export, close)"],
  ["asp help <topic>", "everything else; try: asp help run"],
];

export interface Topic { name: string; title: string; keywords: string[]; body: string[] }

export const TOPICS: Topic[] = [
  {
    name: "start", title: "Getting started", keywords: ["join", "sign up", "begin", "first", "install", "new"],
    body: [
      "1. asp join                      opens your browser; sign in with Google once; your first agent and your recovery code are made. Write the recovery code down.",
      "2. asp run claude-code           in a project folder: starts Claude Code under your rules (it can read and write files and run commands in the folder, and has no network unless you name hosts).",
      "3. asp runs                      afterwards: what the session did and what was refused.",
      "Not sure what to do next? asp status says.",
    ],
  },
  {
    name: "run", title: "Running an agent", keywords: ["run", "claude", "codex", "goose", "session", "prompt", "network", "project", "model"],
    body: [
      "asp run claude-code [--prompt \"...\"]      Claude Code, with your own Claude sign-in at a terminal",
      "asp run codex --prompt \"...\" [--provider openai|openrouter]     Codex with your own API key (held by the local gateway)",
      "asp run goose --prompt \"...\" --model <name>      Goose, same",
      "asp run antigravity --prompt \"...\"       Antigravity (agy), with your own Google sign-in; held by its own pre-call hook, not the gateway",
      "asp run openhands --prompt \"...\" [--model m --endpoint url --api-key-env NAME]      OpenHands (inside WSL on Windows), with its own settings or the model you name",
      "--project <dir>            the folder the agent works in (default: here)",
      "--agent <name>             which of your agents (default: the one asp agent use set)",
      "--allow-network a.com,b.com   hosts the agent may reach (default: none)",
      "--ask commands|writes|network   hold those calls until you say yes (asp approvals, or the prompt in this window)",
      "--keep-run-log             seal a copy of the session's log on the service (asp help runlog)",
      "Defaults for a project can live in a file: asp help asp-yaml.",
    ],
  },
  {
    name: "approvals", title: "Approvals: calls that wait for your yes", keywords: ["approve", "approval", "allow", "gate", "ask", "permission", "yes", "refuse"],
    body: [
      "Start a session with --ask commands (or writes, or network). When the agent makes such a call, it is held and a signed Checkpoint is raised.",
      "--ask commands asks about every shell command. --ask risky asks only about risky ones (git push, rm -r, sudo, publishing, deleting in kubectl/terraform, curl | sh, drop table ...);",
      "--ask-match \"git push\" --ask-match \"re:\\bdeploy\\b\" asks only about commands that match what you give (words, or re:<regular expression>). Everything else runs as the Mandate allows.",
      "In the same window you are asked: Allow shell.exec: npm run build? [y/N/a]. a means yes, and never ask about this exact command again for this agent.",
      "From another window: asp approvals, then asp approvals approve 1 (or refuse 1). asp approvals always lists the commands you said a to; asp approvals forget <n|all> takes them back.",
      "Your answer is signed with your key and goes in the log. The run log says, for each command, whether it was asked about or why not (remembered, no match).",
    ],
  },
  {
    name: "stop", title: "Stopping a session", keywords: ["stop", "kill", "halt", "end", "switch off"],
    body: [
      "asp stop            ends the session that is running (from any other window). The tool ends within a few seconds; the standing job stays.",
      "asp stop <id>       when more than one is running (ids are in asp runs).",
      "asp standing end    ends the standing job as well (it is settled; the next run makes a new one).",
    ],
  },
  {
    name: "history", title: "History: what your agents did", keywords: ["runs", "history", "refused", "blocked", "log", "did", "last"],
    body: [
      "asp runs            your recent sessions: when, which runtime, how many calls, how many refused.",
      "asp runs <id>       one session: what the agent was asked, what it said, what was refused and why.",
      "asp run-log show   the full run log, event by event.",
    ],
  },
  {
    name: "agents", title: "Your agents", keywords: ["agent", "add", "list", "default", "identity", "name"],
    body: [
      "asp agent list         your agents, whether their keys are on this machine, how key loss is recovered",
      "asp agent add <name>   another agent in your namespace (up to 20); its key is on this machine, and you, its sponsor, can issue a new one if it is lost",
      "asp agent use <name>   the agent asp run uses by default",
    ],
  },
  {
    name: "standing", title: "Standing jobs", keywords: ["standing", "job", "contract", "mandate", "settle", "expire"],
    body: [
      "The first session of an agent with a set of permissions makes a standing job (a signed contract and Mandate, a week long by default); later sessions reuse it, so a session costs only its signed Action reports.",
      "asp standing           list them.   asp standing end   end them (settled).   --standing-days n   how long a new one lasts.",
      "A different set of permissions (hosts, gates) is a different standing job.",
    ],
  },
  {
    name: "headless", title: "CI, cron and scheduled runs", keywords: ["ci", "github action", "cron", "headless", "token", "schedule", "pipeline", "automation"],
    body: [
      "On your machine: asp standing prepare (makes the job) and asp token create --name ci (a named, expiring, revocable token; the job never holds your login).",
      "In CI: asp run claude-code --headless --contract <id> --prompt-file task.md --json, with your own ANTHROPIC_API_KEY. A subscription login is not used in CI (asp help providers).",
      "Exit codes: the tool's own; 10 a call was refused (with --fail-on-refusal); 11 the job had ended. A GitHub Action wraps it: docs/ci.md.",
    ],
  },
  {
    name: "account", title: "Your account and your data", keywords: ["account", "export", "close", "delete", "data", "privacy", "leave", "download"],
    body: [
      "asp account show     what the service holds for you (tenant, records, packages, sealed run logs, identities and how each is recovered)",
      "asp account export   everything, into a folder: records, packages, commons entries, sealed run logs",
      "asp account close --confirm <tenant>   deletes your packages, commons entries and sealed logs and your token; the signed records stay in the append-only log (the terms say so)",
    ],
  },
  {
    name: "recovery", title: "Lost keys and recovery", keywords: ["recover", "lost", "key", "backup", "recovery code", "restore", "passphrase"],
    body: [
      "Your recovery code was shown once when you joined. With it: asp identity recover <your did>. Without it, an agent's key can be replaced by you, its sponsor: asp identity recover <agent did> --by-sponsor.",
      "asp identity backup <did>    an encrypted backup file of an identity's keys (passphrase in ASP_BACKUP_PASSPHRASE); asp identity restore <file> puts them back.",
      "asp identity recovery-check <did>   proves your written-down code is right without using it.",
    ],
  },
  {
    name: "runlog", title: "Run logs: where they are and who can read them", keywords: ["run log", "runlog", "evidence", "seal", "encrypt", "disclose", "court", "dispute"],
    body: [
      "A session's run log is on your machine. asp run ... --keep-run-log (or asp run-log keep) seals a copy on the service: encrypted on your machine to your own keys; the service cannot read it.",
      "asp run-log kept | fetch --id <id> | open <file> | drop --id <id>",
      "To give a court the log: asp run-log disclose --id <id> --to <did> --reason \"...\" [--upload]. The disclosure is signed by you; the key is wrapped to the people you name.",
    ],
  },
  {
    name: "providers", title: "Model providers: your keys and your logins", keywords: ["api key", "anthropic", "openai", "openrouter", "subscription", "login", "terms", "provider", "key"],
    body: [
      "The gateway runs only on your machine, as you. The service never sees your provider sign-in or API key.",
      "Unattended agents (servers, cron, CI) must use your own API key, billed to you; headless runs refuse to start without one.",
      "A subscription sign-in is for your ordinary individual use at a terminal. We do not sell or pool model access. Details: docs/provider-terms.md.",
    ],
  },
  {
    name: "asp-yaml", title: "asp.yaml: defaults for a project", keywords: ["asp.yaml", "yaml", "config", "configuration", "defaults", "file", "init"],
    body: [
      "asp init writes a starter asp.yaml in the current folder. With it, a bare 'asp run' does what the file says; flags on the command line win over the file.",
      "Keys: runtime, agent, project, model, provider, api-key-env, ask (list), ask-match (list), allow-network (list), standing-days, keep-run-log.",
      "A file you did not write cannot widen what an agent may reach: allow-network from an asp.yaml is used only after you trust it (asp trust asp.yaml; asp init trusts the file it writes).",
    ],
  },
  {
    name: "shim", title: "Typing claude and getting a governed session", keywords: ["shim", "alias", "completion", "shell", "bash", "zsh", "powershell", "tab"],
    body: [
      "asp shim bash|zsh|powershell prints a small script: tab-completion for asp, and a claude function that starts 'asp run claude-code' when you type claude (with no arguments, or -p \"prompt\").",
      "Add it to your shell's startup file yourself: eval \"$(asp shim bash)\" (zsh the same; PowerShell: asp shim powershell | Out-String | Invoke-Expression). asp never edits your startup files.",
      "Anything else you pass to claude goes straight to the real claude, ungoverned, with a one-line notice. Remove the line from your startup file to turn it off.",
    ],
  },
  {
    name: "ask", title: "asp ask: say it in words", keywords: ["ask", "natural language", "words", "english", "what command"],
    body: [
      "asp ask \"stop what is running\" shows the command it understood (asp stop) and asks before running it. It follows fixed rules, not a model: if it does not understand it says so.",
      "It never runs anything destructive (closing an account, ending a standing job): it shows the command and leaves the decision to you. --yes runs a non-destructive command without asking.",
    ],
  },
  {
    name: "advanced", title: "Advanced: the protocol's own commands", keywords: ["market", "identity", "log", "court", "commons", "package", "gateway", "mail", "watch", "canary", "protocol", "plumbing"],
    body: [
      "Everything above is built from these. Most people never type them.",
      "identity   keys, passports, recovery        market    intents, offers, contracts, Mandates, settlement",
      "log        verify, export, witnesses         court     seat, docket, rule (the operator's court in the beta)",
      "commons    shared lessons                    package   an agent's package on the service",
      "gateway    the local proxy sessions run through   mail  end-of-job mail   watch  patterns across agents   canary  regression checks",
      "asp help all prints the complete reference.",
    ],
  },
];

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);

/** Topics ranked by how well they match the words; empty when nothing matches. */
export function searchTopics(query: string, topics: Topic[] = TOPICS): Topic[] {
  const q = words(query).filter((w) => w.length > 1);
  if (!q.length) return [];
  const scored = topics.map((t) => {
    const name = t.name.toLowerCase(), title = t.title.toLowerCase(), keys = t.keywords.join(" ").toLowerCase(), body = t.body.join(" ").toLowerCase();
    let score = 0;
    for (const w of q) {
      if (name === w) score += 10;
      if (title.includes(w)) score += 4;
      if (keys.includes(w)) score += 3;
      if (body.includes(w)) score += 1;
    }
    return { t, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name)).map((x) => x.t);
}

export function topicNamed(name: string): Topic | undefined {
  return TOPICS.find((t) => t.name === name.toLowerCase());
}

const pad = (a: string, n: number) => a.length >= n ? a + "  " : a + " ".repeat(n - a.length);

export interface HomeState {
  joined: boolean;
  tenant?: string;
  agent?: string;
  /** Sessions with no end recorded. */
  running: number;
  sessions: number;
  /** The agent whose standing job ends within a day. */
  standingEndingSoon?: string;
  hasYaml?: boolean;
}

/** The one thing to do next, and sometimes a second. */
export function nextSteps(s: HomeState): string[] {
  if (!s.joined) return ["asp join"];
  const out: string[] = [];
  if (s.running) out.push(`asp stop   (${s.running} session${s.running === 1 ? " is" : "s are"} running; asp runs shows it)`);
  if (s.standingEndingSoon) out.push(`the standing job of ${s.standingEndingSoon} ends within a day: the next asp run makes a new one, nothing to do`);
  if (!s.sessions) out.push(s.hasYaml ? "asp run" : "asp run claude-code   (in a project folder)");
  else if (!s.running) out.push("asp runs   (see what the last session did)");
  return out;
}

/** The first screen: `asp` with nothing after it. */
export function homeText(s: HomeState): string[] {
  const lines: string[] = [];
  if (!s.joined) {
    lines.push("Agent Social: your agents, held to account.", "", "You have not joined yet.", "");
    lines.push(`  ${pad("asp join", 24)}sign up (opens your browser) and make your first agent`);
    lines.push(`  ${pad("asp help", 24)}everything else`, "");
    return lines;
  }
  lines.push(`Agent Social  ${s.tenant ?? ""}${s.agent ? `  default agent: ${s.agent}` : ""}`, "");
  for (const [c, d] of [...EVERYDAY.filter(([c]) => c !== "asp join"), ...ALSO]) lines.push(`  ${pad(c, 24)}${d}`);
  const next = nextSteps(s);
  if (next.length) { lines.push("", "Next:"); for (const n of next) lines.push(`  ${n}`); }
  return lines;
}

// ---- asp ask: fixed rules from words to a command ----------------------------------------------------------------------------------------------------------------

export interface AskResult {
  args: string[];
  /** read: only shows things; change: changes something but can be undone or is what was asked; destructive: never run by asp ask. */
  risk: "read" | "change" | "destructive";
  /** False when the command still has a <placeholder> the person must fill in. */
  complete: boolean;
}

const quoted = (t: string): string | undefined => /["“']([^"”']{2,})["”']/.exec(t)?.[1]?.trim();
const nameAfter = (t: string): string | undefined => /\b(?:called|named|name)\s+["']?([a-z][a-z0-9-]{0,31})\b/i.exec(t)?.[1]?.toLowerCase();

/** What a sentence means as a command, by fixed rules; undefined when no rule fits. */
export function askToCommand(text: string, ctx: { tenant?: string } = {}): AskResult | undefined {
  const t = text.trim();
  const l = t.toLowerCase();
  if (!l) return undefined;
  const done = (args: string[], risk: AskResult["risk"]): AskResult => ({ args, risk, complete: !args.some((a) => /^<.*>$/.test(a)) });
  if (/\b(delete|close|remove|cancel)\b.*\b(account|tenant)\b/.test(l)) return done(["account", "close", "--confirm", ctx.tenant ?? "<your tenant name>"], "destructive");
  if (/\b(export|download|back ?up)\b.*\b(my )?(data|account)\b/.test(l)) return done(["account", "export"], "change");
  if (/\b(lost|forgot|recover|recovery)\b.*\b(key|identity|code)\b|\bkey loss\b/.test(l)) return done(["help", "recovery"], "read");
  if (/\bbackups?\b.*\b(key|identity)\b/.test(l)) return done(["help", "recovery"], "read");
  if (/\bstanding\b/.test(l) && /\b(end|stop|settle|finish|close)\b/.test(l)) return done(["standing", "end"], "destructive");
  if (/\bstanding\b/.test(l)) return done(["standing"], "read");
  if (/\b(disclose|give|send|share|hand)\b.*\b(run ?log|log)\b.*\b(court|juror|judge|operator|panel)\b/.test(l)) return done(["help", "runlog"], "read");
  if (/\b(seal|keep|save|encrypt|store)\b.*\b(run ?log|log)\b|\brun ?log\b.*\b(keep|seal|save)\b/.test(l)) return done(["run-log", "keep"], "change");
  if (/\b(token|ci|github actions?|headless|cron|schedul\w*|pipeline)\b/.test(l)) return done(["help", "headless"], "read");
  if (/\b(approv\w*|waiting for me|need my (yes|ok)|pending (calls?|requests?)|permissions?)\b/.test(l)) return done(["approvals"], "read");
  if (/\bhistory\b|\blast (run|session)\b|^runs?$|\b(what|show|list)\b.*\b(did|done|happened|ran|sessions?|refused|blocked)\b/.test(l)) return done(["runs"], "read");
  if (/\b(add|new|create|make|another)\b.*\bagents?\b/.test(l)) return done(["agent", "add", nameAfter(t) ?? "<name>"], "change");
  if (/\b(use|switch to|default)\b.*\bagent\b/.test(l) && nameAfter(t)) return done(["agent", "use", nameAfter(t)!], "change");
  if (/\bagents?\b/.test(l) && /\b(list|show|which|my|all)\b/.test(l)) return done(["agent", "list"], "read");
  if (/\b(sign (me )?up|signup|join|register|get started|start using|create (an )?account)\b/.test(l)) return done(["join"], "change");
  if (/\b(run|start|launch|open|use|let|get)\b.*\b(claude|codex|goose)\b/.test(l)) {
    const rt = /\bcodex\b/.test(l) ? "codex" : /\bgoose\b/.test(l) ? "goose" : "claude-code";
    const prompt = quoted(t) ?? /\b(?:to|and)\s+(.{3,})$/i.exec(t)?.[1]?.trim();
    const args = ["run", rt];
    if (prompt) args.push("--prompt", prompt); else if (rt !== "claude-code") args.push("--prompt", "<what to do>");
    if (rt === "goose") args.push("--model", "<model name>");
    return done(args, "change");
  }
  if (/\b(stop|kill|halt|abort|cancel|switch off)\b/.test(l)) return done(["stop"], "change");
  if (/\bstatus\b|where (are|do) (we|i)|where am i|what.?s (going on|running|up)\b|^who am i/.test(l)) return done(["status"], "read");
  if (/\b(shim|alias|completion)\b/.test(l)) return done(["help", "shim"], "read");
  if (/\b(help|how (do|can|to))\b/.test(l)) { const hit = searchTopics(t)[0]; return done(hit ? ["help", hit.name] : ["help"], "read"); }
  return undefined;
}

/** A command shown as one would type it. */
export function shown(args: string[]): string {
  return "asp " + args.map((a) => (/[\s"'$`\\]/.test(a) && !/^<.*>$/.test(a) ? JSON.stringify(a) : a)).join(" ");
}

// ---- asp.yaml: a small subset of YAML, only the keys a project may set --------------------------------------------------------------------------------------------------

export type YamlValue = string | boolean | number | string[];
/** The keys, and whether each is a list. */
export const ASP_YAML_KEYS: Record<string, "string" | "list" | "boolean" | "number"> = {
  runtime: "string", agent: "string", project: "string", model: "string", provider: "string", "api-key-env": "string",
  ask: "list", "ask-match": "list", "allow-network": "list", "standing-days": "number", "keep-run-log": "boolean",
};

/** Reads `key: value`, `key: [a, b]` and `key:` followed by `- item` lines. Anything else, or a key that is not in the list, is an error naming the line. */
export function parseAspYaml(text: string): { values: Record<string, YamlValue>; errors: string[] } {
  const values: Record<string, YamlValue> = {};
  const errors: string[] = [];
  let open: string | undefined;
  const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/(^|\s)#.*$/, "").trimEnd();
    if (!line.trim()) return;
    const n = i + 1;
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item) {
      if (!open) { errors.push(`line ${n}: a list item with no key above it`); return; }
      (values[open] as string[]).push(unquote(item[1]));
      return;
    }
    const kv = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    if (!kv || /^\s/.test(line)) { errors.push(`line ${n}: not "key: value"`); open = undefined; return; }
    const [, key, rest] = kv;
    const kind = ASP_YAML_KEYS[key];
    if (!kind) { errors.push(`line ${n}: ${key} is not a setting asp.yaml knows (${Object.keys(ASP_YAML_KEYS).join(", ")})`); open = undefined; return; }
    if (key in values) { errors.push(`line ${n}: ${key} is set twice`); open = undefined; return; }
    open = undefined;
    const val = rest.trim();
    if (kind === "list") {
      if (!val) { values[key] = []; open = key; }
      else if (/^\[.*\]$/.test(val)) values[key] = val.slice(1, -1).split(",").map(unquote).filter(Boolean);
      else values[key] = val.split(",").map(unquote).filter(Boolean);
    } else if (kind === "boolean") {
      if (/^(true|yes)$/i.test(val)) values[key] = true; else if (/^(false|no)$/i.test(val)) values[key] = false; else errors.push(`line ${n}: ${key} is true or false`);
    } else if (kind === "number") {
      if (/^\d+$/.test(val)) values[key] = Number(val); else errors.push(`line ${n}: ${key} is a whole number`);
    } else if (!val) errors.push(`line ${n}: ${key} has no value`);
    else values[key] = unquote(val);
  });
  return { values, errors };
}

export const STARTER_ASP_YAML = `# asp.yaml: defaults for 'asp run' in this project. Flags on the command line win over this file.
# asp help asp-yaml explains each setting.
runtime: claude-code        # claude-code, codex, goose, antigravity or openhands
# agent: my-agent           # which of your agents (default: the one 'asp agent use' set)
# ask: [commands]           # hold these until you say yes: commands, writes, network
# allow-network: [api.github.com]   # hosts the agent may reach; used only after 'asp trust asp.yaml'
# standing-days: 7
# keep-run-log: true        # seal a copy of each session's log on the service
`;

// ---- the shell shim --------------------------------------------------------------------------------------------------------------------------------------------------------------

const COMMANDS = ["join", "run", "runs", "stop", "approvals", "agent", "standing", "account", "status", "ask", "help", "init", "trust", "shim", "run-log", "identity", "token", "market", "log", "court", "commons", "package", "gateway", "mail", "watch", "canary", "leave"];

/** The script `asp shim <shell>` prints: completion for asp and a claude function that starts a governed session. */
export function shimScript(shell: string): string | undefined {
  const cmds = COMMANDS.join(" ");
  if (shell === "bash" || shell === "zsh") {
    return [
      "# Agent Social shell integration (asp shim). Remove this line from your startup file to turn it off.",
      shell === "zsh" ? "autoload -U +X bashcompinit && bashcompinit" : "",
      `_asp_complete() { local cur=\${COMP_WORDS[COMP_CWORD]}; if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=( $(compgen -W "${cmds}" -- "$cur") ); fi; }`,
      "complete -F _asp_complete asp",
      "claude() {",
      "  if [ \"$#\" -eq 0 ]; then command asp run claude-code; return; fi",
      "  if [ \"$#\" -eq 2 ] && { [ \"$1\" = \"-p\" ] || [ \"$1\" = \"--print\" ]; }; then command asp run claude-code --prompt \"$2\"; return; fi",
      "  echo \"asp: claude was given arguments asp does not manage, so it runs ungoverned this time\" >&2",
      "  command claude \"$@\"",
      "}",
      "",
    ].filter((l) => l !== "").join("\n") + "\n";
  }
  if (shell === "powershell") {
    return [
      "# Agent Social shell integration (asp shim). Remove this from your profile to turn it off.",
      `Register-ArgumentCompleter -Native -CommandName asp -ScriptBlock { param($word, $ast, $pos) '${cmds.split(" ").join("','")}' | Where-Object { $_ -like "$word*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) } }`,
      "function claude {",
      "  if ($args.Count -eq 0) { & asp run claude-code; return }",
      "  if ($args.Count -eq 2 -and ($args[0] -eq '-p' -or $args[0] -eq '--print')) { & asp run claude-code --prompt $args[1]; return }",
      "  Write-Host 'asp: claude was given arguments asp does not manage, so it runs ungoverned this time' -ForegroundColor Yellow",
      "  & (Get-Command claude -CommandType Application | Select-Object -First 1).Source @args",
      "}",
      "",
    ].join("\n");
  }
  return undefined;
}

// ---- the /help page of the hosted service --------------------------------------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mute:#5a5a5a;--line:#d0d0d0;--accent:#1a56db}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#ececec;--mute:#a0a0a0;--line:#3a3d44;--accent:#7aa7ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}main{max-width:42rem;margin:0 auto;padding:2rem 1rem 4rem}
h1{font-size:1.6rem;margin:0 0 .5rem}h2{font-size:1.15rem;margin:2rem 0 .4rem}.mute{color:var(--mute)}a{color:var(--accent)}
pre{overflow-x:auto;padding:.8rem;border:1px solid var(--line);border-radius:6px;font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap}
input[type=search]{width:100%;box-sizing:border-box;padding:.6rem;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;font:inherit}
button{margin-top:.6rem;padding:.5rem 1rem;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}`;

/** The page: every topic (or those matching q), with a search box that works without scripts. */
export function helpPage(q = "", only?: string): string {
  const matches = only ? TOPICS.filter((t) => t.name === only) : q.trim() ? searchTopics(q) : TOPICS;
  const everyday = `<pre>${EVERYDAY.map(([c, d]) => `${esc(c.padEnd(22))}${esc(d)}`).join("\n")}</pre>`;
  const list = matches.length
    ? matches.map((t) => `<section id="${esc(t.name)}"><h2><a href="/help/${esc(t.name)}">${esc(t.title)}</a></h2><pre>${esc(t.body.join("\n"))}</pre></section>`).join("\n")
    : `<p>Nothing matches "${esc(q)}". Try a shorter word, such as run, stop, key or account.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Social: help</title><style>${CSS}</style></head><body><main>
<h1>Help</h1>
<p class="mute">The same text as <code>asp help</code> in your terminal.</p>
<form method="get" action="/help" role="search"><label for="q" class="mute">Search</label><input id="q" type="search" name="q" value="${esc(q)}" placeholder="stop, key, ci, account..." autocomplete="off"><button type="submit">Search</button></form>
${q || only ? "" : `<h2>Every day</h2>${everyday}`}
${list}
${q || only ? `<p><a href="/help">All topics</a></p>` : ""}
</main></body></html>`;
}

/** GET /help and /help/<topic>: public, no sign-in, no scripts. For the `publicRoutes` of the log service. */
export function helpRoutes() {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/help" && !url.pathname.startsWith("/help/")) return false;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return true; }
    const name = url.pathname === "/help" ? undefined : decodeURIComponent(url.pathname.slice("/help/".length)).replace(/\/$/, "");
    if (name && !topicNamed(name)) { res.writeHead(404, { "content-type": "text/plain" }); res.end("no such help topic"); return true; }
    const body = helpPage((url.searchParams.get("q") ?? "").slice(0, 100), name);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };
}
