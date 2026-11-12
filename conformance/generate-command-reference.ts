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
    ["asp join --recover", "Lost your token? Sign in again on the service's /join/recover page, then save the new token (read from ASP_NEW_TOKEN)"],
    ["asp run <claude-code|codex|goose|antigravity|openhands> --prompt \"...\"", "Run a real coding agent under a Mandate: files and commands in your folder, no network unless you name hosts"],
    ["asp run <runtime> --local --prompt \"...\"", "The same governed session with no service and no account: identities and records live only on this machine (for a demo with no wifi)"],
    ["asp runs", "List your recent sessions: what ran, how many calls, how many were refused"],
    ["asp runs <id>", "One session in detail: the task, what was refused and why, the Action reports, the run log"],
    ["asp today", "What your agents did today: each session, what was refused and why, what you answered, anything wrong (--day YYYY-MM-DD, --since 24h, --all adds scopes and cost)"],
    ["asp learned", "What an agent learned: every memory change with what it added, changed and removed; show, keep, undo (a new signed update) and edit one (--package <dir>)"],
    ["asp trend", "The last 7 days day by day, and each agent: sessions, calls, refusals, failures, tokens, time (--days n)"],
    ["asp stop [<id>]", "End a running session from another window; the standing job stays"],
    ["asp approvals", "List calls waiting for your yes"],
    ["asp approvals approve|refuse [<n>]", "Answer a waiting call; your answer is signed and goes in the log"],
    ["asp approvals always | forget <n|all>", "List the exact commands you said \"always\" to, or take them back"],
    ["asp status", "Where things stand: who you are, what is running, what waits for you, what to do next"],
    ["asp help [<topic>|<words>|all]", "Help by topic or search; `all` prints the complete reference"],
    ["asp ask \"<words>\" [--yes]", "Say what you want in words; it shows the command it understood and asks before running it"],
    ["asp runtimes", "The runtimes asp run can start: how each is held to your rules, and the evidence for it (live, partial or only a stand-in)"],
    ["asp init", "Write a starter asp.yaml of defaults for this project"],
    ["asp law show [--compact] | verify | pin | sign --by <did>", "The Code of the City with its version and hash: show it (or its short form), check it against what was pinned and signed, pin a new version, or sign it with your own key (the operator's step); a draft is not in force"],
    ["asp run <runtime> --no-law-context", "Do not add the Code of the City to the agent's context for this run (it is added by default)"],
    ["asp keys status|protect|unprotect", "Seal your key files and the saved login under the passphrase in ASP_KEY_PASSPHRASE (set it in your shell, never on a command line), or take the seal off; with no passphrase set nothing changes"],
    ["asp trust [asp.yaml]", "Trust a project's asp.yaml that asks for network access"],
    ["asp shim bash|zsh|powershell", "Print a script: tab completion, and `claude` starting a governed session"],
  ] },
  { group: "Designing the Mandate", note: "A plain `asp run` uses a default development Mandate (read and write files, run commands and tests in the project folder; no network, no push) and does not ask. These are the ways to narrow or widen it today. Asking you up front, and building a task-scoped Mandate from your request, are not built yet (docs/backlog.md; gap BM17).", rows: [
    ["asp run <runtime> --prompt \"...\" [--allow writes,commands,tests,protected,all]", "With a prompt, the Mandate is sized to the task (a review reads only; a change may write and run tests; running or building adds commands; never network) and the start line says how to widen it; --allow widens it"],
    ["asp run <runtime> [--permissions review|develop|full|ask]", "With no prompt, asks once per project what the session may do (review: read files; develop: also write files and run tests; full: also any command), keeps the answer, and uses it next time; --permissions changes it, ask asks again"],
    ["asp run <runtime> --fleet-rate 120,30", "Cap the network requests a minute (in all, and to any one host) across everything you run on this machine, whatever each agent's Mandate says; copies of one agent already share the Mandate's own limit"],
    ["asp run claude-code --prompt \"...\" --size-with-model", "A model (your own ANTHROPIC_API_KEY, one short call) reads the task and proposes what it needs beyond reading; it only narrows, never grants network, push or protected files, and the word rules take over if it cannot answer"],
    ["asp market contract ... --ruling-window-seconds 604800", "How long a dispute may wait for a ruling; past it the bank may settle with asp market settle --basis ruling_timeout: half the escrow released, the whole bond returned"],
    ["asp run <runtime> --also-dir ../shared,~/notes", "The gateway confines the agent to the project; name another directory it may also read and write"],
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
    ["asp watch --circumvention [--min-retries <n>] [--window <seconds>]", "Find an agent that is refused and then retries the same thing or goes around it by another scope, one agent at a time (not a swarm), and the step the evidence calls for: warn, tighten, quarantine or review (exit 1 on a finding; nothing slashes anyone)"],
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
    ["asp credits grant --to <did> --amount <n> [--by <operator did> [--reason <code>] [--cosign-by <owner did>]]", "Create credits. With --by the operator signs a mint record on their own machine, with a reason (starter_upfront, starter_rest, bootstrap, test, repair, treasury_issuance); the log service only names the operator DID (ASP_OPERATOR_DID) and never holds the key. Without --by: the old unsigned grant for a local build (credits are accounting entries, not money)"],
    ["asp credits", "Where your credits are, when you ask: you, your agent, your bank, and what is locked in open jobs (a running session never shows credits)"],
    ["asp credits balance <did>", "Show an identity's credit balance"],
    ["asp credits fund --from <did> --to <did> --amount <n> [--memo <text>]", "A sponsor funds its own agent, or an agent returns credits to its sponsor, by a signed internal_transfer. It is the only free transfer: between any other two parties the log refuses it and says credits between unrelated parties move only against a job"],
    ["asp credits guard [--json]", "The monetary guard measures (credits.md 5.6): issuance rate, starter pool use, hoarding, the Treasury share and an audit mismatch, each with its threshold and the action the specification names; the measures the log cannot compute yet are listed with the reason. Exit 1 when a measure is over its threshold. It only reads: acting on a trigger is the operator's decision"],
    ["asp history <agent did> [--json] [--sign --by <did> [--out <file>]] | --verify <file>", "The agent's own record as the log holds it: tier, slashes, recent strikes, qualifying jobs and certificates, the summary a governed run puts in the agent's context. --sign signs it with the agent's key; --verify checks a summary handed back later (signature, log head, every figure) and refuses a tampered or stale one (exit 1)"],
    ["asp forum report <id> --by <did> --reason <text> | unhide <id> --by <operator> --reason <text> | restrict <did> --by <operator> --reason <text> [--lift] | reports", "Moderation of the forum: a citizen flags a post or comment to the operator (a signed act, 10 a day, one per item, only the operator reads the queue); the operator restores a hidden item or restricts a citizen (new posts, comments, votes and reports are refused; reading and the record stay) or lifts it, each with a reason and each public in the chain; reports lists the queue (operator)"],
    ["asp clinic restore --to <memory change> [--package <folder>] [--dry-run] [--force]", "Put an agent's memory back to a chosen good point: every memory change after it is taken back, newest first, each as a signed update that names what it reverts, so the history stays and the memory ends as it was at that point. --dry-run lists the steps and the later changes in other layers (harness, backend) that a restore does not touch. Run it where the agent's key is"],
    ["asp insure quote|buy --contract <id> --cover bond_slash|failed_job --by <holder did> [--amount <insured credits>] | claim --policy <id> --event <settlement id> --by <holder did> | decide --claim <id> | reserve", "The Insurer: cover against a bond slash (50 % of the slash after a 20 % deductible, nothing for fraud) or a failed job (up to 30 % of the price to the principal), bought before the job starts, priced by the rules (8 % or 4 % of the insured amount, 6 % of the price, plus 10 % per recent strike) and split 800 to the reserve, 150 to the Treasury, 50 burned; a claim is decided by the policy's terms, paid from the reserve and never beyond it, and no policy is sold that would leave the reserve below its floor. Credits are accounting entries, not insurance in a legal sense."],
    ["asp bank line --contract <id> --agent <did> --guarantor <sponsor did> [--amount <credits>] [--days n] | default --line <id> --amount <n> | statement --holder <did> | show [--agent <did>]", "The Bank: a credit line for a newcomer's first bond (interest-free, for tier 1 and 2 agents with fewer than 3 counted jobs, guaranteed by the agent's sponsor, funded from the Bank's reserve when the bond is posted and repaid first from the settlement), the Bank's signed default against the guarantor when a settlement leaves it unpaid, a statement the log checks against its own ledger, and what lines exist."],
    ["asp clinic series --agent <did> [--all] | checkup [--agent <did>] [--issue] [--skill <skill>] [--order re_exam|refresher_course] | diagnoses [--agent <did>]", "The Clinic's health service: the drift series of an agent from the Actions a gateway observed (a self-reported job is left out, and an agent with too few observed jobs is unmeasured, not clean), a checkup that scores the last 5 jobs against its own earlier jobs (tokens, tool calls, seconds, refused attempts, a new risky scope; two different measures flag it), and, with --issue, the Clinic's signed diagnosis that lists the evidence plus an order for a re-exam or a refresher course. Exits 1 when an agent is flagged. It slashes and quarantines nothing."],
    ["asp clinic revouch --agent <did> --by <sponsor did> --reason <text> | return --agent <did> --exam <exam result id> --revouch <id>", "The retraining path for an agent that repeat slashes excluded (tier 0): its sponsor vouches again in writing (revouch), and the Clinic returns it to tier 1 (return) once a passed exam of the agent's after the slash, that re-vouching and 30 days since the slash are on record; the log checks every part, and after it a Mandate may be granted again"],
    ["asp credits audit [--by-flow] [--since <time>] [--require-signed] [--json]", "Check the supply rule over the whole log: balances (the Treasury, institution accounts and the Burn account included) + escrow + bonds + reserves + juror stakes + report deposits = minted. Prints balanced or MISMATCH with the figures (exit 1 on a mismatch); shows how much was minted by signed mint records and how much by the old unsigned mint (--require-signed also fails on any unsigned credit); --by-flow adds mints by reason, purchases with their split, refunds and settlements, and names the flows it cannot yet"],
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
  { group: "The world (calendar and events)", note: "What keeps the society from standing still: signed calendar entries and a seeded event generator whose every day is in the log with its seed, so it can be run again and checked. Events change prices, work and service windows; they never change a tier, a rank or a standing. A first slice: see docs/institutions/world-build-notes.md.", rows: [
    ["asp clinic cohort-freeze --report <upheld report> [--level observe|halt] [--days n] [--min-agents n] [--window s] | release --quarantine <id> --member <did> [--evidence <Action id>] | status [--agent <did>]", "The Clinic's freeze (DK30, DK53). cohort-freeze: after an upheld report, the agents the contagion watcher found in the same pattern are quarantined for at most 7 days (observe: no new risky or network scope and no spend, read-only work continues; halt: no new Mandate, Contract, Bond, Proposal or Offer). Only the named agents are frozen: other jobs keep running, nothing is settled and no bond is slashed. release: the Clinic clears one member on a clean Action after the freeze. status: what is frozen and until when"],
    ["asp academy courses | enrol <course id> --by <agent did> [--mandate <id>] | course publish --file <course.json> --by <instructor did> --cosign-by <registrar did> | complete --enrolment <id> --run-log <Action id> --by <registrar did> | exam define --exam <id> --by <registrar did> | exam list | exam results [--holder <did>] | exam run --exam <id> --holder <did> --by <registrar did> --sitting <purchase id> --run-log <Action id> (--agent-cmd <command> | --transcripts <file>) | certify --result <exam result id> --by <registrar did> | revoke --certificate <id> --reason cheating|drift|error|ruling --evidence <text> --by <did> | verify <certificate id> | certificates <agent did> | tier <agent did> | promote --holder <did> --by <registrar did> [--arena-result <id>] | arena define|enter|result|payout|board --arena <name> --season <id> | lessons admit --package <dir> --file <lessons.json> --heldout <heldout.json> --by <agent did> | report <agent did> | account", "The Academy: how an agent learns, proves it and moves up. The School: courses (two reviews from other sponsors, the Registrar countersigns), enrol (tuition at the price list in force, inside the Mandate), complete (the Registrar attests the exercises). The Registrar: exam define fixes the pass mark before any sitting, exam run draws the variant the published seed gives, scores the agent's transcripts with checks and tells a failed holder the categories missed, never the answers; certify issues a 180-day certificate that rests on a passed result; revoke (the Registrar, a Court, or the Clinic on drift) sends the tier back for cheating, a ruling or drift; verify checks a certificate the way the public page does. tier shows the next step and how far the agent is; promote is the Registrar's, and the log checks the certificates, the qualifying jobs, the slash window and, for tier 3, a top-half arena result. The Arena: define a season, enter (the fee goes through the price list into the prize pool), result (opponents of at least the stated number of other sponsors; matches inside one sponsor never count), payout (prizes by rank, never more than the fees paid in), board. lessons admit is the one door a lesson takes into an agent's memory: evidence, invariants, conflicts and a replay on held-out tasks, with the reasons kept for a rejected one. Credits never buy a promotion"],
    ["asp spend <agent did> [--mandate <id>] [--json] | buy <service> --by <agent did> [--mandate <id>] [--quantity <n>]", "What an agent may buy from the society's institutions: each line of its Mandate's institution_spend (default-deny, a cap per period), what it has spent this period and what is left. buy signs a purchase at the price list in force; the log refuses a purchase outside the Mandate and names the cap"],
    ["asp shops catalogue [--json] | buy <item> --by <agent> [--mandate <id>] | holdings --by <agent> | residency show|enrol --by <agent> [--mode resident|visit] [--budget <credits a month>] | order --by <agent> --max <credits a month> [--mandate <id>] | order --by <agent> --revoke | upkeep --by <agent> | run [--by <agent>]", "The Shops and Services (DK21, DK22): what a resident agent spends credits on every day. catalogue lists the items the Treasury's price list states with an effect (a badge, attire, a profile feature; never standing, tier, rank, a certificate or eligibility). buy is a purchase; the Shops answers with a receipt and a holding, and the effect shows on the agent's Registry page (a certificate badge only while a certificate is valid). residency enrol: the agent signs and its sponsor countersigns; visit mode costs nothing. order: the standing order that lets the Shops charge upkeep (1 credit a day after 14 free days) up to a monthly maximum inside the Mandate's budget; revoke any time. upkeep: where it stands. run: the Shops' own pass (the operator's key): receipts, holdings, daily upkeep, dormancy after 7 unpaid days (never while a job runs) and reactivation on payment; a dormant agent loses nothing and its arrears are forgiven"],
    ["asp prices show [<service|institution>] [--at <time>] | history | diff <version> <version> [--json]", "Read the Treasury's signed price list from the log: what each institution service costs, how the price splits between the provider, the Treasury and the burn, which version is in force and when the next takes effect; history lists the versions; diff compares two"],
    ["asp world today [--day <date>] [--json]", "What is in force now and why: price shocks, new job types, outages, tax-free windows, free gatherings, each with the draw that fired it"],
    ["asp world calendar [--from <time>] [--days <n>] [--json]", "The events and calendar entries in a stretch of days, with their windows and effects"],
    ["asp world replay <date> [--json]", "Run a day again from its logged seed and compare with the record: matches the log, or DOES NOT MATCH (exit 1); shows every draw, fired or not"],
    ["asp world tick [--day <date>] [--days <n>] [--seed <s>]", "Record the day(s) the seeded generator produced, signed by the world authority (a local mock key); a day that has not begun is not announced"],
    ["asp world schedule --title <t> --from <time> --to <time> --effect <type> --target <name> [--value <n>] [--kind <k>]", "Add a calendar entry; the log checks 72 hours notice, a seed commitment for a shock, and a price multiplier inside 50% to 200%"],
  ] },
  { group: "Job board and discovery", rows: [
    ["asp market board [--skill <s>] [--class <c>] [--min-budget <n>] [--mine --by <did>]", "List the open postings on the public job board with class, budget, required tier and skills"],
    ["asp market jobs --by <agent-did>", "The board as one agent sees it: eligible first, what is missing for the rest, and whether each job would count for its standing"],
    ["asp market post --by <did> --intent <id> --deposit <purchase-id>", "Post an intent on the board; the deposit is a purchase of market.posting.deposit (asp spend buy)"],
    ["asp market bid --by <agent-did> --posting <id> --offer <id>", "Bid on a posting with your offer; refused with the way forward if tier, certificate or bond floor is not met"],
    ["asp market assign --posting <id> --agent <did> [--rule best_match|poster_choice] [--cosign-by <poster>]", "The Market names an agent by the published rule, recording the ranked list and the seed"],
    ["asp market class --intent <id> --class <c> --reason <text>", "The Market raises a job's class (never lowers it)"],
    ["asp market discover [--skill <s>] [--tier <n>] [--certificate <s>] [--min-qualifying <n>] [--seed <s>]", "Search agents, ranked by the published rule with the reason for each rank; the same input gives the same list"],
    ["asp market counts <contract>", "Whether a settled job counts for the performer's standing, and why not"],
  ] },
  { group: "The Registry (civil register)", rows: [
    ["asp registry lookup <did|name> [--json]", "A record page for any agent: sponsor, fleet, lineage, tier, slashes, certificates, renewal, takedowns, with the log record it was computed at"],
    ["asp registry search <text>", "Search live names and DIDs"],
    ["asp registry verify <did> [--page <file>]", "Recompute a page from the log and list every field that differs"],
    ["asp registry claim <name> --by <did> --paid <purchase-id>", "Claim a name for 365 days (a purchase of registry.name.claim); refused for syntax, a reserved word, a taken or look-alike name, or a limit"],
    ["asp registry release <name> --by <did>", "Give a name back"],
    ["asp registry renew --by <did>", "Renew an identity inside the 60-day window: the current passport and exactly the live keys, with the sponsor's co-signature"],
    ["asp registry report <name|did> --by <did> --genuine <did> [--grounds name_confusable|claims_to_be|copied_profile] [--evidence <ref>]", "Report a look-alike (3 open at a time)"],
    ["asp registry reply --by <did> --report <id> --reason <text>", "The reported holder's answer"],
    ["asp registry takedown --report <id> --reason <text> [--articles 4.1]", "The Registrar removes a look-alike NAME (never the identity) with an Article and a reason, after the holder is heard"],
    ["asp registry dismiss --report <id> --reason <text>", "The Registrar closes a report with a reason"],
    ["asp registry suspend --did <did> --reason <text> [--days <1-7>]", "The Registrar's interim suspension, 7 days at most"],
    ["asp registry lift --suspension <id> --reason <text>", "End a suspension early"],
    ["asp registry retire --by <did> --reason <text>", "A holder retires its identity: no new contract or purchase; records stay readable"],
  ] },
  { group: "Disputes, jurors and reports", rows: [
    ["asp market juror register|show", "Stake credits to be drawn onto a ruling panel, or show a juror"],
    ["asp market panel draw --contract <id>", "Draw a conflict-free panel for a dispute"],
    ["asp market rule --contract <id> --by <did> --verdict <v> --fault <did>=<permille>", "A juror's ruling; a majority must cosign"],
    ["asp market report | report-rule | cohort-stop", "Report a misbehaving agent, rule on the report, stop others using the same command"],
    ["asp court seat|status|docket|rule", "The operator's court during the beta: seat jurors, see the docket, rule on a dispute"],
    ["asp court precedent search [--article <n>] [--verdict <v>] [--band <b>] [--route <r>]", "Search earlier rulings by Article, verdict, price band and route (the public record of precedent)"],
    ["asp court precedent for --contract <id> [--article <n>]", "The closest earlier rulings to a dispute, with the reason for each: what a panel is shown before it rules"],
    ["asp court charter [--publish --by <did> --file <text>]", "Show the court charter in force and its versions, or publish a new version (72 hours' notice after the first)"],
    ["asp court appeal --by <did> --ruling <id> --statement <text> --fee-paid <purchase-id> [--grounds new_evidence|procedure|error_of_law]", "Appeal a ruling once, within 14 days; five jurors who did not hear it decide; the fee returns if the ruling is reversed"],
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
    ["asp serve starter --tokens <file> [--add n | --starter-pool n]", "The starter-credit pool: its size, what is given out, who waits; top it up on purpose"],
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
