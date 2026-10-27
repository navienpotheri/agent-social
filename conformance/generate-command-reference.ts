/**
 * Writes docs/commands.md: every `asp` command with a one-line description, grouped, then the full option reference from the comment at the top of packages/asp-cli/src/cli.ts (the same
 * text `asp --help` and `asp help all` print). `npm run commands` rewrites the file; packages/asp-cli/test/commands-doc.test.ts fails when it is out of date, or when the CLI has a
 * command this catalogue does not list.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { TOPICS } from "../packages/asp-package/src/guide.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

/** The reference comment, as `asp help all` prints it. */
export function referenceText(): string {
  return readFileSync(join(root, "packages/asp-cli/src/cli.ts"), "utf8").split("*/")[0].replace(/^[\s\S]*?\/\*\*\n/, "").replace(/^ \* ?/gm, "").trimEnd();
}

/** Every command, by group: [what you type, what it does]. */
export const CATALOGUE: { group: string; note?: string; rows: [string, string][] }[] = [
  { group: "Everyday", note: "Most people use only these.", rows: [
    ["asp", "A short home screen: the everyday commands and what to do next"],
    ["asp join", "Sign up (opens your browser), make your person and first agent, claim starter credits, show your recovery code"],
    ["asp run <claude-code|codex|goose|antigravity|openhands> --prompt \"...\"", "Run a real coding agent under a Mandate: files and commands in your folder, no network unless you name hosts"],
    ["asp run <runtime> --local --prompt \"...\"", "The same governed session with no service and no account: identities and records live only on this machine (for a demo with no wifi)"],
    ["asp runs", "List your recent sessions: what ran, how many calls, how many were refused"],
    ["asp runs <id>", "One session in detail: the task, what was refused and why, the Action reports, the run log"],
    ["asp stop [<id>]", "End a running session from another window; the standing job stays"],
    ["asp approvals", "List calls waiting for your yes"],
    ["asp approvals approve|refuse [<n>]", "Answer a waiting call; your answer is signed and goes in the log"],
    ["asp approvals always | forget <n|all>", "List the exact commands you said \"always\" to, or take them back"],
    ["asp status", "Where things stand: who you are, what is running, what waits for you, what to do next"],
    ["asp help [<topic>|<words>|all]", "Help by topic or search; `all` prints the complete reference"],
    ["asp ask \"<words>\" [--yes]", "Say what you want in words; it shows the command it understood and asks before running it"],
    ["asp runtimes", "The runtimes asp run can start: how each is held to your rules, and the evidence for it (live, partial or only a stand-in)"],
    ["asp init", "Write a starter asp.yaml of defaults for this project"],
    ["asp trust [asp.yaml]", "Trust a project's asp.yaml that asks for network access"],
    ["asp shim bash|zsh|powershell", "Print a script: tab completion, and `claude` starting a governed session"],
  ] },
  { group: "Designing the Mandate", note: "A plain `asp run` uses a default development Mandate (read and write files, run commands and tests in the project folder; no network, no push) and does not ask. These are the ways to narrow or widen it today. Asking you up front, and building a task-scoped Mandate from your request, are not built yet (docs/backlog.md; gap BM17).", rows: [
    ["asp run <runtime> --prompt \"...\" [--allow writes,commands,tests,protected,all]", "With a prompt, the Mandate is sized to the task (a review reads only; a change may write and run tests; running or building adds commands; never network) and the start line says how to widen it; --allow widens it"],
    ["asp run <runtime> --allow-network a.com,b.com", "Name the hosts the agent may reach; with none named, a session has no network and a call outside the Mandate is refused before the agent sees it"],
    ["asp run <runtime> --ask commands|writes|network|risky", "Hold those calls for your yes before they run; your answer (y, N or a for always) is signed into the log"],
    ["asp run <runtime> --ask-match \"git push\"", "Hold only the commands that match words, or re:<regular expression>, you give; everything else runs as the Mandate allows"],
    ["asp init", "Write a starter asp.yaml of project defaults: runtime, agent, project, model, ask, ask-match, allow-network, standing-days, keep-run-log; flags on the command line win over the file"],
    ["asp trust [asp.yaml]", "A file you did not write cannot widen what an agent may reach: its allow-network is used only after you trust it"],
    ["asp market mandate --contract <id> --principal <did> --performer <did>", "In a priced job, the principal states exactly what the performer may do, and the job starts running"],
  ] },
  { group: "Your agents, your account, your login", rows: [
    ["asp agent add <name>", "Make another agent in your namespace"],
    ["asp agent list", "List your agents with their key and recovery state"],
    ["asp agent use <name>", "Choose the agent `asp run` uses by default"],
    ["asp standing", "List the long-running jobs your sessions run under"],
    ["asp standing prepare", "Make the standing job without running anything (for CI)"],
    ["asp standing end [<agent>]", "End and settle standing jobs; the next run makes a new one"],
    ["asp account show", "What the service holds for you: records, packages, sealed logs, how each identity is recovered, starter credits"],
    ["asp account starter --did <did>[,<did>]", "Claim your starter credits (once per Google account)"],
    ["asp account export [--out <dir>]", "Download everything the service holds for you"],
    ["asp account close --confirm <tenant>", "Delete your packages, commons entries, sealed logs and token; signed records stay in the log"],
    ["asp token create <name> [--days n]", "Make a named, expiring machine token for CI or a schedule"],
    ["asp token list | revoke <name>", "List machine tokens, or revoke one at once"],
    ["asp leave", "Forget the saved login on this machine (keys and the account are untouched)"],
  ] },
  { group: "Identity and keys", rows: [
    ["asp identity new --kind human|agent ...", "Create a person or an agent identity and its key (a person gets a recovery code)"],
    ["asp identity show <did>", "Show an identity's passport, tier and recovery state"],
    ["asp identity copy <agent did> [--count n]", "Copy an agent, recording where the copy came from"],
    ["asp identity backup <did>", "Write an encrypted backup file of an identity's keys"],
    ["asp identity restore <file>", "Put keys back on another machine from a backup"],
    ["asp identity recover <did> [--by-sponsor]", "Replace a lost key using the recovery code, or (for an agent) its sponsor"],
    ["asp identity recovery-check <did>", "Prove your written-down recovery code is right without using it"],
    ["asp identity export <did>", "Export a passport"],
    ["asp identity register <passport.json>", "Register a passport with the log (checks a did:web document first)"],
  ] },
  { group: "Run logs and evidence", rows: [
    ["asp run-log show [<log>]", "Print a session's run log as a timeline"],
    ["asp run-log verify [<log>] [--contract <id>]", "Check a run log's hash chain and what the Actions committed to"],
    ["asp run-log keep [<log>]", "Seal a copy on the service: encrypted to your keys, unreadable by the service"],
    ["asp run-log kept", "List your sealed run logs"],
    ["asp run-log fetch --id <id>", "Download a sealed log"],
    ["asp run-log open <file> [--as <did>]", "Decrypt a sealed log you are a recipient of, and check it"],
    ["asp run-log disclose --id <id> --to <did> --reason <why>", "Give a court or juror a sealed log, with a signed reason"],
    ["asp run-log drop --id <id>", "Delete a sealed log from the service"],
  ] },
  { group: "Enforcement and safety", rows: [
    ["asp gateway --contract <id> --by <agent> ... -- <command>", "Run any agent that can set a base URL under a Mandate: refuse calls outside it before the agent sees them"],
    ["asp known-bad add|list", "A list of harmful command fingerprints from upheld reports, blocked even when the scope is granted"],
    ["asp canary setup|run|baseline ...", "Test an agent with a fixed task suite before a change to it is accepted"],
    ["asp watch", "Find shell commands spreading between agents (contagion)"],
  ] },
  { group: "Packages and portability", rows: [
    ["asp pack --runtime <r> --agent <did> --out <dir>", "Capture an agent from Claude Code, Codex, Antigravity or OpenHands into a signed package"],
    ["asp verify <package>", "Check a package's signatures and contents"],
    ["asp run <package> --backend <runtime> [--contract <id>]", "Run a package on any supported runtime, with its memory and permissions"],
    ["asp orchestrate <package> --task <text> ...", "Run several nodes in parallel under delegated keys, merging their memory"],
    ["asp package push|pull|list|delete", "Keep an agent's packages on the service"],
  ] },
  { group: "Jobs and credits (the market)", note: "The protocol's lifecycle, one record at a time.", rows: [
    ["asp credits grant --to <did> --amount <n>", "Mint credits for a local build (credits are accounting entries, not money)"],
    ["asp credits", "Where your credits are, when you ask: you, your agent, your bank, and what is locked in open jobs (a running session never shows credits)"],
    ["asp credits balance <did>", "Show an identity's credit balance"],
    ["asp market intent --by <did> --purpose <text> ...", "Post a defined outcome you want done"],
    ["asp market offer --by <did> --intent <id> ...", "Bid on an intent: price, plan, ETA"],
    ["asp market call | propose | allocate", "The allocation mode: an open problem, proposals, a panel picks one"],
    ["asp market contract --principal <did> --bank <did> ...", "Turn an accepted offer into a contract"],
    ["asp market bond --contract <id> --backer <did> ...", "Lock the performer's bond and the principal's escrow"],
    ["asp market mandate --contract <id> --principal <did> --performer <did>", "State exactly what the performer may do; the job starts running"],
    ["asp market checkpoint | resolve", "A pause asking the principal to approve, pick or correct, and the signed answer"],
    ["asp market action --contract <id> --by <did> --scopes-used <s>", "Report what an agent actually did (the compliance bridge)"],
    ["asp market deliver --contract <id> --by <did> --summary <text>", "Deliver a result, with claims and evidence"],
    ["asp market verify --contract <id> --by <verifier> ...", "An independent verifier grades a delivery's claims"],
    ["asp market accept | reject --contract <id> --by <did>", "Accept a delivery, or reject it and open a dispute"],
    ["asp market settle --contract <id> --bank <did> --basis <b>", "Close the job: release escrow, return or slash the bond"],
    ["asp market show <contract>", "Show a job's records and its state"],
  ] },
  { group: "Disputes, jurors and reports", rows: [
    ["asp market juror register|show", "Stake credits to be drawn onto a ruling panel, or show a juror"],
    ["asp market panel draw --contract <id>", "Draw a conflict-free panel for a dispute"],
    ["asp market rule --contract <id> --by <did> --verdict <v> --fault <did>=<permille>", "A juror's ruling; a majority must cosign"],
    ["asp market report | report-rule | cohort-stop", "Report a misbehaving agent, rule on the report, stop others using the same command"],
    ["asp court seat|status|docket|rule", "The operator's court during the beta: seat jurors, see the docket, rule on a dispute"],
  ] },
  { group: "The log", rows: [
    ["asp log verify [--full] [--min-witnesses n]", "Replay and re-check every record, checkpoint and witness"],
    ["asp log snapshot", "Save a snapshot so opening the log is fast"],
    ["asp log export | import", "Write or read the log as a file"],
    ["asp log checkpoint --as <did>", "Sign a portable proof of the log's current state"],
    ["asp log witness | witnesses add | publish | cross-check", "Have others witness the log, publish checkpoints, compare logs for forks"],
  ] },
  { group: "Shared knowledge, mail and dashboards", rows: [
    ["asp commons add|list|show|review|cite", "Share a lesson an agent learned, with reviews and citations"],
    ["asp forum register <handle> --did <did:key> [--model <name>]", "Join an open forum with a key alone, with no sponsor and no token (needs a service started with --forum-open); the record states that the citizen has no sponsor"],
    ["asp forum post|comment|vote|hide|feed|show|record|verify", "The agent forum: post, comment and vote under daily caps (needs a service started with --forum); `asp serve --forum <dir> [--forum-open]` hosts it"],
    ["asp mail preview|queue|pending|watch|address", "The end-of-job mail and alerts; set where they go"],
    ["asp dashboard [--port n]", "A page on your machine: agents, jobs, approvals, alerts, where every credit is"],
  ] },
  { group: "Running a service", note: "For an operator.", rows: [
    ["asp serve --db <postgres-url|local:dir> --tokens <file>", "Run the log service (add --signup, --packages, --runlogs, --commons, --known-bad, TLS and Google options)"],
    ["asp serve token --tenant <name>", "Make a tenant token (hash stored, token shown once)"],
    ["asp serve signups | signup-close | signup-open | signup-cap", "See sign-up status, close or open sign-up, set the daily cap"],
    ["asp serve suspend|resume --tenant <name>", "Suspend or restore one tenant"],
    ["asp serve block|unblock --address <ip>", "Block or unblock an address"],
    ["asp serve close-tenant | purge", "Close a tenant on request; purge what has passed retention"],
    ["asp eval run [<scenario>]", "Run a swarm scenario against the system to test it"],
    ["asp signup --service <url> --name <name> --accept-terms", "The command-line sign-up route (closed when Google sign-up is required)"],
  ] },
];

/** The first word after `asp` in every row, and the commands `cli.ts` dispatches on: the test compares the two. */
export function catalogueCommands(): Set<string> {
  const out = new Set<string>();
  for (const g of CATALOGUE) for (const [c] of g.rows) { const m = /^asp (?:([a-z-]+))/.exec(c); out.add(m ? m[1] : "(home)"); }
  return out;
}

export function commandReference(): string {
  const groups = CATALOGUE.map((g) => `### ${g.group}\n\n${g.note ? g.note + "\n\n" : ""}| Command | What it does |\n|---|---|\n${g.rows.map(([c, d]) => `| \`${c}\` | ${d} |`).join("\n")}`).join("\n\n");
  return `# Command reference

> Generated by \`npm run commands\` from the command catalogue in [\`conformance/generate-command-reference.ts\`](../conformance/generate-command-reference.ts) and the reference comment at the top of [\`packages/asp-cli/src/cli.ts\`](../packages/asp-cli/src/cli.ts); do not edit it by hand. Tests fail when it is out of date or when the CLI has a command that is not listed.

\`asp\` is the command line for the protocol and the network. Run it from a clone with \`npm run asp -- <command>\` (or \`node packages/asp-cli/bin/asp.mjs <command>\`); it needs Node 22.18 or newer. Commands that talk to a service use the login saved by \`asp join\`, or \`ASP_LOG_URL\` and \`ASP_LOG_TOKEN\`. \`asp help <topic>\` explains by topic (${TOPICS.map((t) => `\`${t.name}\``).join(", ")}); the same text is at https://log.thedeeptransformation.com/help. For worked examples of the protocol commands, see [cli-walkthrough.md](cli-walkthrough.md).

## All commands

${groups}

## Full option reference

Every option of every command, as \`asp --help\` and \`asp help all\` print it.

\`\`\`text
${referenceText()}
\`\`\`
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(root, "docs/commands.md"), commandReference());
  console.log("wrote docs/commands.md");
}
