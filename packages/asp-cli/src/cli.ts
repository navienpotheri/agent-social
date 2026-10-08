#!/usr/bin/env node
/**
 * asp: the Agent Social portability tool.
 *
 *   asp identity new --kind human (--did <did> | --method did:key) [--sponsor <did>]
 *   asp identity new --kind agent (--did <did> | --method did:key) --sponsor <did> [--fleet <did>] [--purpose <text>]
 *     --did <did> uses a DID you already have (e.g. did:web:your-own-domain:...). --method did:key
 *     generates a fresh key and derives a self-certifying DID from it: no domain to bring, lose
 *     access to, or depend on anyone else for.
 *   asp identity show <did>
 *     Includes `reputation` (tier, slash count) for an agent that's ever been slashed as a Bond's
 *     backer, or that has a declared tier to fall back on — derived, not itself a signed record.
 *   asp pack --runtime claude-code|codex|openhands --agent <did> [--project <dir>] [--include-user] [--out <dir>]
 *     Includes memory/PENALTIES.md if the agent has ever been slashed and self-signed the lineage
 *     entry for it (asp market settle does this automatically) — every runtime materializes it into
 *     the agent's own memory alongside everything else it packed.
 *   asp verify <package> [--json]
 *   asp run <package> --backend claude-code|codex|openhands [--project <dir>] [--prompt <text>] [--model <m>] [--dry-run] [--no-write-back] [--contract <id>]
 *     --model <m> --endpoint <url> [--api-key-env <NAME>]: run an open-weight model served from an
 *     OpenAI-compatible endpoint (Ollama, vLLM, ...) on OpenHands or Codex. --api-key-env names the
 *     environment variable holding the key; local servers get a placeholder.
 *     After a successful run, a backend swap and any memory the agent changed are recorded in the
 *     package as signed lineage updates, and the manifest is re-signed.
 *     --contract: the compliance bridge (docs/backlog.md). If the adapter supports it (Claude Code
 *     does, via --output-format stream-json), real tool-call scopes seen during the run are
 *     collected and reported as an asp.action/v0.2 record against that contract's live Mandate —
 *     not self-declared after the fact. The first call outside the Mandate is a violation: the
 *     process is stopped (kill switch) and the job settles with full fault (escrow back to the
 *     principal, the bond slashed). On Claude Code a pre-call hook also blocks such a call before
 *     it runs. A blocked call did no harm, so it is a signed strike (the action record's
 *     blocked_attempts), not the full settlement: the run is stopped only after --max-strikes
 *     blocked attempts (default 3) or when an out-of-scope call actually ran. The action record for
 *     a violation is refused, so it can never get laundered into a clean-looking log.
 *   asp orchestrate <package> --backend <runtime> --task <text> [--task <text> ...] [--project <dir>]
 *                   [--max-parallel N] [--model <m>] [--dry-run]
 *     Runs one task per node, in parallel, each under its own signed, short-lived delegated key
 *     (an asp.node/v0.2 record; see spec/schemas/node.schema.json). Nodes only write memory; a single
 *     consolidation step then merges what every node learned into one signed lineage update for the
 *     agent, deduplicating identical lines and keeping conflicting ones side by side rather than
 *     silently discarding either. This is the spec's Learning-section pattern: "nodes only write
 *     experience... a consolidation step... produces one update to the person".
 *   asp log verify
 *   asp log checkpoint --as <did>
 *     Signs {seq, log_hash, signed_at} with <did>'s key and appends it to checkpoints.ndjson (decision
 *     D5): a portable, externally-checkable proof of the log's state at that point, published nowhere
 *     by asp itself. `log verify` re-checks every stored checkpoint against an independent replay.
 *
 *   asp credits grant --to <did> --amount <n>
 *     Bootstraps a DID's credit balance. Local, unsigned, not part of the tamper-evident log — a
 *     closed-loop ledger with no cash-out still needs some way to get the first credits in (MOCKS.md #13).
 *   asp credits balance <did>
 *
 *   Assignment mode (one performer bidding directly):
 *   asp market intent --by <did> --purpose <text> [--criteria <text> ...] --budget <n> --deadline <iso> [--verification deterministic|principal|arbiter] [--review-deadline <iso>] [--verifier <did>]
 *     --review-deadline (principal-mode verification only) is mirrored onto the Contract by
 *     `asp market contract`, and lets `asp market settle --basis silence` close the job once it's
 *     passed, without the principal ever signing an acceptance.
 *   asp market offer --by <did> --intent <id> --price <n> --plan <text> --eta <iso> [--bond-offered <n>]
 *
 *   Allocation mode (several Proposals compete for one Call; a panel member picks one):
 *   asp market call --by <did> --purpose <text> --budget <n> --panel <did> [--panel <did> ...] [--criteria <text> ...] --deadline <iso>
 *   asp market propose --by <did> --call <id> --plan <text> --budget-asked <n> [--team <did> ...]
 *   asp market allocate --by <did> --proposal <id> [--verdict <text>]
 *     `--by` must be one of the Call's panel DIDs (the log rejects others: not_on_call_panel).
 *
 *   asp market contract --principal <did> --bank <did> [--performer <did>] [--parent-contract <id>]
 *                        (--intent <id> --offer <id> | --call <id> --proposal <id>)
 *     Issued by the principal, co-signed by the performer. In assignment mode, purpose/criteria/
 *     deadline/verification come from the Intent and price from the Offer (performer defaults to the
 *     Offer's issuer). In allocation mode, they come from the Call and the allocated Proposal
 *     (performer defaults to the Proposal's team[0]; --verification, since Call has none).
 *     --parent-contract: subcontract nesting — the parent's own performer becomes this contract's
 *     principal (checked, not just recorded), funding it from its own balance; no automatic netting
 *     back to the parent's escrow. The parent must exist and not already be Settled.
 *   asp market bond --contract <id> --backer <did> --amount <n> --escrow-payer <did> --escrow-amount <n>
 *     Locks real credits: debits both the escrow payer and the backer for real (rejects with
 *     insufficient_balance rather than starting a job uncovered).
 *   asp market mandate --contract <id> --principal <did> --performer <did> [--scopes <s> ...] [--spend-cap <n>] [--gate <scope> ...] [--irreversible checkpoint|forbid|allow]
 *     --gate names granted scopes the irreversible policy applies to: with checkpoint (the default) a
 *     call to one needs the principal's approval first (asp run holds the call, raises a Checkpoint, and
 *     waits for asp market resolve; --approval-wait <seconds>, default 600, then it is refused); with
 *     forbid it is blocked outright; with allow it is ungated. Needs a runtime with a pre-call hook.
 *   asp market checkpoint --contract <id> --by <performer> --question <text> [--kind before_irreversible|plan|high_impact|delivery] [--summary <proposed action>] [--expires <iso>]
 *   asp market resolve --contract <id> --by <principal> --verdict approved|corrected|picked|expired [--correction <text>] [--about <checkpoint id>]
 *     The principal's signed answer to an open Checkpoint; corrected (with the reason) is how a request is refused.
 *   asp market deliver --contract <id> --by <did> --summary <text> [--claim "<text>::<measured|simulated|predicted>[::<uri>=<sha256>]" ...]
 *     Also redelivers after a reject (the lifecycle's own redelivery_available guard applies; at
 *     most one redelivery). Each --claim says what the Delivery asserts and how well established it is.
 *   asp market verify --contract <id> --by <verifier> --verdict confirmed|partly_confirmed|not_confirmed [--grade <claim index>=<grade> ...] [--about <id>]
 *     Outcome verification: the verifier named on the contract (asp market intent|contract --verifier
 *     <did>; never the principal, the performer, or anyone they sponsor) re-checks the Delivery and
 *     grades each claim (measured, simulated, predicted, unverified). With a verifier named, the log
 *     refuses to accept (or settle on silence) a Delivery without a confirming verification.
 *   asp market accept|reject --contract <id> --by <did> [--about <id>] [--reasons <text> ...]
 *     A reject moves the job to Disputed, open to either a redelivery or a ruling.
 *   asp market juror register --by <did> --stake <n>
 *     Self-registers (or re-registers, chaining onto the last one) to be eligible for random draw
 *     onto a Courts ruling panel, staking real credits from the ledger. A lower stake returns the
 *     difference; 0 withdraws.
 *   asp market juror show <did>
 *   asp market panel draw --contract <id> [--size <n>]
 *     Shows the panel a Disputed contract's ruling would draw — conflict-free (excludes the
 *     principal, the performer, and anyone they sponsor), deterministic (seeded from the rejection
 *     that opened the dispute, so it's reproducible, including by EventLog.verify()'s replay).
 *     Default panel size 3.
 *   asp market rule --contract <id> --by <did> [--cosign-by <did> ...] --verdict for_performer|for_principal|split --fault <did>=<permille> [...]
 *     A ruling on a Disputed job. If at least one juror is registered anywhere, the issuer plus
 *     cosigners must include a majority of the panel `panel draw` would show (panel_quorum);
 *     otherwise any neutral DID may rule, unchanged from the original mocked Courts (MOCKS.md #4).
 *   asp market settle --contract <id> --bank <did> --basis accepted|ruling|revoked|silence
 *                      [--escrow-released <n>] [--bond-returned <n>] [--bond-slashed <n>] [--fees <n>]
 *                      [--pro-rata <permille>] [--cites <id>] [--principal <did>] [--agent-permille <n>]
 *     The performer's passport sets the earnings_split (kept share, snapshotted at Bond time); the rest of its pay goes
 *     to its sponsor. --agent-permille only restates it (earnings_split_mismatch if it differs).
 *     --fees comes out of the same escrow, on top of --escrow-released, and credits to a local mock
 *     platform account (EventLog.PLATFORM_DID) standing in for a real platform/Insurer recipient.
 *     `silence`: requires the Contract to carry a review_deadline (from a principal-mode Intent)
 *     that the settlement's own timestamp is already past — no --cites needed, since no acceptance
 *     was ever signed. Distributes exactly what the Bond locked: pay to the performer, unreleased escrow back to the
 *     more than was locked (over_release). `revoked` is cosigned by the principal; `accepted`/`ruling`
 *     cite the acceptance or ruling Attestation (defaults to the chain's latest one). For `ruling`,
 *     omitting --escrow-released/--bond-slashed derives them from the cited ruling's fault on the
 *     performer — the formula the log itself enforces (settlement_mismatches_ruling otherwise), so
 *     you don't have to hand-compute it. --bond-returned still defaults to 0 either way.
 *     A slash also self-signs a lineage penalty for the backer, if its key is available locally
 *     (see `asp pack`'s note on memory/PENALTIES.md).
 *   asp market action --contract <id> --by <did> --scopes-used <s> [...] [--summary <text>]
 *     The compliance bridge, by hand (see `asp run --contract` for automatic emission from real
 *     tool calls). Checked against the contract's live Mandate; refused if any scope wasn't granted.
 *   asp market show <contract>
 *     Prints the job's state, its full chain, and (once bonded) the ledger lock for that contract.
 *
 * Global: --home <dir> (default $ASP_HOME or ~/.asp), --user-home <dir> (the home dir holding .claude/.codex; default ~).
 */
import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  b64urlDecode, b64urlEncode, cosign, createRecord, didKeyFromPublicKey, didOf, publicKeyFromSeed, randomSeed, sha256Id,
  type AspRecord, type Signer,
} from "@agent-social/asp-core";
import {
  ADAPTERS, Keystore, LocalLog, appendCheckpoint, aspHome, diffTrees, finishPackage, isEmptyDiff, packDirectory,
  readCheckpoints, redactSecrets, resolvePackage, scanForSecrets, signCheckpoint, updatePackage, verifyCheckpointSignature,
  verifyPackage, writePackage,
  type Harness, type LineageChange, type RuntimeAdapter,
} from "@agent-social/asp-package";

class UsageError extends Error {}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const slug = (s: string) => s.replace(/^did:[a-z0-9]+:/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
const quote = (a: string) => (/^[A-Za-z0-9_./:=@-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
}

const OPTIONS = {
  home: { type: "string" },
  "claude-home": { type: "string" },
  "user-home": { type: "string" },
  model: { type: "string" },
  endpoint: { type: "string" },
  "api-key-env": { type: "string" },
  kind: { type: "string" },
  did: { type: "string" },
  method: { type: "string" },
  sponsor: { type: "string" },
  fleet: { type: "string" },
  purpose: { type: "string" },
  runtime: { type: "string" },
  backend: { type: "string" },
  agent: { type: "string" },
  project: { type: "string" },
  out: { type: "string" },
  prompt: { type: "string" },
  "include-user": { type: "boolean" },
  "dry-run": { type: "boolean" },
  "no-write-back": { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  task: { type: "string", multiple: true },
  "max-parallel": { type: "string" },
  as: { type: "string" },

  // asp credits / asp market (Stage 2 slice 1)
  to: { type: "string" },
  amount: { type: "string" },
  by: { type: "string" },
  price: { type: "string" },
  budget: { type: "string" },
  deadline: { type: "string" },
  verification: { type: "string" },
  "review-deadline": { type: "string" },
  "parent-contract": { type: "string" },
  fees: { type: "string" },
  criteria: { type: "string", multiple: true },
  intent: { type: "string" },
  offer: { type: "string" },
  plan: { type: "string" },
  eta: { type: "string" },
  "bond-offered": { type: "string" },
  contract: { type: "string" },
  principal: { type: "string" },
  performer: { type: "string" },
  bank: { type: "string" },
  backer: { type: "string" },
  "escrow-payer": { type: "string" },
  "escrow-amount": { type: "string" },
  scopes: { type: "string", multiple: true },
  "spend-cap": { type: "string" },
  summary: { type: "string" },
  about: { type: "string" },
  reasons: { type: "string", multiple: true },
  basis: { type: "string" },
  "escrow-released": { type: "string" },
  "bond-returned": { type: "string" },
  "bond-slashed": { type: "string" },
  "pro-rata": { type: "string" },
  "agent-permille": { type: "string" },
  cites: { type: "string" },

  // asp market call|propose|allocate|rule (allocation mode + the dispute/ruling path)
  panel: { type: "string", multiple: true },
  call: { type: "string" },
  proposal: { type: "string" },
  team: { type: "string", multiple: true },
  "budget-asked": { type: "string" },
  verdict: { type: "string" },
  fault: { type: "string", multiple: true },
  "cosign-by": { type: "string", multiple: true },

  // asp market juror|panel (Courts, a real staked random panel)
  stake: { type: "string" },
  size: { type: "string" },

  // asp market action (the compliance bridge) / asp run --contract
  "scopes-used": { type: "string", multiple: true },
  "max-strikes": { type: "string" },
  // asp market verify / deliver --claim / intent|contract --verifier (outcome verification)
  verifier: { type: "string" },
  // approval gates: asp market mandate --gate / --irreversible; asp market checkpoint|resolve; asp run --approval-wait
  gate: { type: "string", multiple: true },
  irreversible: { type: "string" },
  "approval-wait": { type: "string" },
  expires: { type: "string" },
  correction: { type: "string" },
  question: { type: "string" },
  claim: { type: "string", multiple: true },
  grade: { type: "string", multiple: true },
  artifact: { type: "string", multiple: true },
} as const;

export async function main(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    io.err(String((e as Error).message));
    return 2;
  }
  const { values: v, positionals: [cmd, sub, ...rest] } = parsed;
  if (!cmd || v.help) {
    io.out(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^[\s\S]*?\/\*\*\n/, "").replace(/^ \* ?/gm, ""));
    return cmd ? 0 : 2;
  }
  const home = aspHome(v.home ?? io.env.ASP_HOME);
  const need = (name: keyof typeof v) => {
    const val = v[name];
    if (val === undefined || val === "") throw new UsageError(`--${name} is required`);
    return val as string;
  };

  try {
    if (cmd === "identity" && sub === "new") return await identityNew(home, v, need, io);
    if (cmd === "identity" && sub === "show") return await identityShow(home, rest[0] ?? v.did, io);
    if (cmd === "pack") return await pack(home, v, need, io);
    if (cmd === "verify") return await verify(sub, v.json ?? false, io);
    if (cmd === "run") return await run(home, sub, v, need, io);
    if (cmd === "orchestrate") return await orchestrate(home, sub, v, need, io);
    if (cmd === "log" && sub === "verify") return await logVerify(home, io);
    if (cmd === "log" && sub === "checkpoint") return await logCheckpoint(home, v, need, io);
    if (cmd === "credits" && sub === "grant") return await creditsGrant(home, v, need, io);
    if (cmd === "credits" && sub === "balance") return await creditsBalance(home, rest[0] ?? v.to, io);
    if (cmd === "market") return await market(home, sub, rest, v, need, io);
    throw new UsageError(`unknown command: ${[cmd, sub].filter(Boolean).join(" ")}`);
  } catch (e) {
    io.err(e instanceof UsageError ? `usage: ${e.message}` : `error: ${(e as Error).message}`);
    return e instanceof UsageError ? 2 : 1;
  }
}

type Values = {
  [K in keyof typeof OPTIONS]?: K extends "task" | "criteria" | "scopes" | "reasons" | "panel" | "team" | "fault" | "cosign-by" | "scopes-used" | "artifact" | "claim" | "grade" | "gate" ? string[]
    : (typeof OPTIONS)[K]["type"] extends "boolean" ? boolean : string;
};
type Need = (name: keyof typeof OPTIONS) => string;

async function identityNew(home: string, v: Values, need: Need, io: Io): Promise<number> {
  const kind = need("kind");
  if (kind !== "human" && kind !== "agent") throw new UsageError("--kind is human or agent");
  const keys = new Keystore(home);
  const log = await LocalLog.open(home);

  // did:web (--did) requires a domain you control; did:key (--method did:key) is self-certifying —
  // derived from a fresh key, so there is no domain to bring, lose, or depend on anyone else for
  // (2026-09-27: raised against did:web-only identity undercutting "take your agent and leave").
  let did: string;
  let signer: Signer & { publicKey: Uint8Array };
  if (v.did) {
    did = v.did;
    const kid = `${did}#key-1`;
    signer = keys.find(kid) ?? keys.create(kid);
  } else if (v.method === "did:key") {
    const seed = randomSeed();
    did = didKeyFromPublicKey(publicKeyFromSeed(seed));
    signer = keys.createFromSeed(`${did}#key-1`, seed);
  } else {
    throw new UsageError("give --did <did> (e.g. did:web:your-domain:...), or --method did:key for a self-certifying identity that needs no domain");
  }
  if (await log.log.passport(did)) throw new Error(`${did} already has a passport`);
  const kid = `${did}#key-1`;

  let issuerSigner: Signer & { publicKey: Uint8Array };
  let body: Record<string, unknown>;
  if (kind === "human") {
    issuerSigner = signer;
    body = { did, kind, keys: [{ id: kid, type: "Ed25519", public_key: b64urlEncode(signer.publicKey) }] };
  } else {
    const sponsor = need("sponsor");
    const sponsorSigner = keys.forDid(sponsor);
    if (!sponsorSigner) throw new Error(`no key for sponsor ${sponsor} in ${home}; create it with: asp identity new --kind human --did ${sponsor}`);
    issuerSigner = sponsorSigner;
    body = {
      did, kind, keys: [{ id: kid, type: "Ed25519", public_key: b64urlEncode(signer.publicKey) }],
      sponsor, mentor: sponsor, tier: 1,
      shape: { memory: "files + experience index", keeps_learning: true, modalities: ["text", "code"] },
      ...(v.purpose ? { purpose: v.purpose } : {}),
      ...(v.fleet ? { fleet: v.fleet } : {}),
    };
  }
  const issuer = kind === "human" ? did : need("sponsor");
  const record = createRecord({ type: "passport", issuer, subject: did, prev: null, body, issued_at: now() }, issuerSigner);
  const res = await log.append(record);
  io.out(`created ${kind} ${did}`);
  io.out(`  key      ${kid} (stored in ${join(home, "keys")})`);
  io.out(`  passport ${res.id} (log seq ${res.seq})`);
  return 0;
}

async function identityShow(home: string, did: string | undefined, io: Io): Promise<number> {
  if (!did) throw new UsageError("asp identity show <did>");
  const log = (await LocalLog.open(home)).log;
  const p = await log.passport(did);
  if (!p) throw new Error(`no passport for ${did}`);
  const rec = (await log.get(p.head))!.record;
  const reputation = await log.reputationOf(did);
  io.out(JSON.stringify({
    passport: p.head, sponsor: p.sponsor, fleet: p.fleet, body: rec.body, keys: await log.keys(did),
    ...(reputation ? { reputation } : {}),
  }, null, 2));
  return 0;
}

/** Signs a checkpoint of the local log's current head (decision D5) and appends it to checkpoints.ndjson. */
async function logCheckpoint(home: string, v: Values, need: Need, io: Io): Promise<number> {
  const did = need("as");
  const signer = new Keystore(home).forDid(did);
  if (!signer) throw new Error(`no key for ${did} in ${join(home, "keys")}`);
  const local = await LocalLog.open(home);
  const head = await local.log.head();
  const cp = signCheckpoint(head, signer);
  const file = join(home, "checkpoints.ndjson");
  appendCheckpoint(file, cp);
  io.out(`checkpoint seq ${cp.seq} signed by ${cp.signer}`);
  io.out(`  log_hash   ${cp.logHash}`);
  io.out(`  signed_at  ${cp.signedAt}`);
  io.out(`  saved to   ${file}`);
  io.out("  this is not published anywhere yet; copy it out yourself to make it externally checkable.");
  return 0;
}

/** Verifies the log, then re-verifies every stored checkpoint against an independent replay. */
async function logVerify(home: string, io: Io): Promise<number> {
  const local = await LocalLog.open(home);
  const report = await local.log.verify();
  io.out(report.ok ? `log ok: ${report.records} records, head ${report.head.logHash}` : `log FAILED at seq ${report.error!.seq}: ${report.error!.message}`);
  if (!report.ok) return 1;

  const checkpoints = readCheckpoints(join(home, "checkpoints.ndjson"));
  let allOk = true;
  for (const cp of checkpoints) {
    const key = (await local.log.keys(didOf(cp.signer))).find((k) => k.kid === cp.signer);
    const sigOk = !!key && verifyCheckpointSignature(cp, b64urlDecode(key.publicKey));
    const hashOk = await local.log.verifyCheckpoint({ seq: cp.seq, logHash: cp.logHash });
    if (!sigOk || !hashOk) allOk = false;
    const problem = [!sigOk && "bad signature", !hashOk && "hash mismatch"].filter(Boolean).join(", ");
    io.out(`  checkpoint seq ${cp.seq} (${cp.signedAt}, ${cp.signer}): ${sigOk && hashOk ? "ok" : `FAILED (${problem})`}`);
  }
  return allOk ? 0 : 1;
}

/**
 * Bootstraps a DID's credit balance (MOCKS.md #13): local, unsigned, not part of the tamper-evident
 * log — a closed-loop ledger with no cash-out still needs some way to get the first credits in.
 */
async function creditsGrant(home: string, v: Values, need: Need, io: Io): Promise<number> {
  const to = need("to");
  const amount = Math.trunc(Number(need("amount")));
  if (!Number.isFinite(amount) || amount < 0) throw new UsageError("--amount must be a non-negative integer");
  const local = await LocalLog.open(home);
  const balance = await local.mint(to, amount);
  io.out(`granted ${amount} credits to ${to} (not a signed record; local test/bootstrap only, see MOCKS.md #13)`);
  io.out(`  balance ${balance}`);
  return 0;
}

async function creditsBalance(home: string, did: string | undefined, io: Io): Promise<number> {
  if (!did) throw new UsageError("asp credits balance <did>");
  const local = await LocalLog.open(home);
  io.out(`${did}: ${await local.log.balance(did)} credits`);
  return 0;
}

/** The full chain for a contract, in order, with each record's short type for convenience. */
async function marketChain(log: LocalLog["log"], contract: string) {
  const records = await log.chain(contract);
  return records.map((s) => ({ ...s, kind: s.record.type.replace(/^asp\./, "").replace(/\/v0\.2$/, "") }));
}

const artifactRefOf = (text: string) => ({ uri: `asp://local/${Buffer.from(text).toString("hex").slice(0, 16)}`, sha256: sha256Id(new TextEncoder().encode(text)) });

/** asp market intent|offer|contract|bond|mandate|deliver|accept|reject|settle|show */
async function market(home: string, sub: string | undefined, rest: string[], v: Values, need: Need, io: Io): Promise<number> {
  const keys = new Keystore(home);
  const local = await LocalLog.open(home);
  const signerFor = (did: string) => {
    const s = keys.forDid(did);
    if (!s) throw new Error(`no key for ${did} in ${join(home, "keys")}`);
    return s;
  };

  if (sub === "intent") {
    const by = need("by");
    const verification: Record<string, unknown> = { mode: (v.verification ?? "principal") as "deterministic" | "principal" | "arbiter" };
    if (v["review-deadline"]) verification.review_deadline = v["review-deadline"];
    if (v.verifier) verification.verifier = v.verifier;
    const body = {
      purpose: need("purpose"),
      acceptance_criteria: v.criteria?.length ? v.criteria : [need("purpose")],
      budget: { value: Math.trunc(Number(need("budget"))), unit: "credit" as const },
      deadline: need("deadline"),
      verification,
    };
    const record = createRecord({ type: "intent", issuer: by, subject: by, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`intent ${res.id} by ${by} (log seq ${res.seq})`);
    return 0;
  }

  if (sub === "offer") {
    const by = need("by");
    const intent = need("intent");
    const body = {
      intent, price: { value: Math.trunc(Number(need("price"))), unit: "credit" as const },
      plan: need("plan"), eta: need("eta"),
      bond_offered: { value: Math.trunc(Number(v["bond-offered"] ?? "0")), unit: "credit" as const },
    };
    const record = createRecord({ type: "offer", issuer: by, subject: by, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`offer ${res.id} by ${by} on intent ${intent} (log seq ${res.seq})`);
    return 0;
  }

  // Allocation mode (Call -> several Proposals -> a panel picks one): an open problem instead of
  // one performer's direct bid. Call/Proposal are referenced by a Contract's basis, not chained,
  // exactly like Intent/Offer — so this needs no lifecycle change, only these three commands.
  if (sub === "call") {
    const by = need("by");
    if (!v.panel?.length) throw new UsageError("--panel <did> is required, at least once");
    const panel = v.panel;
    const body = {
      purpose: need("purpose"), budget: { value: Math.trunc(Number(need("budget"))), unit: "credit" as const },
      evaluation_criteria: v.criteria?.length ? v.criteria : [need("purpose")],
      panel, deadline: need("deadline"),
    };
    const record = createRecord({ type: "call", issuer: by, subject: by, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`call ${res.id} by ${by}, panel: ${panel.join(", ")} (log seq ${res.seq})`);
    return 0;
  }

  if (sub === "propose") {
    const by = need("by");
    const call = need("call");
    const body = {
      call, plan: need("plan"), team: v.team?.length ? v.team : [by],
      budget_asked: { value: Math.trunc(Number(need("budget-asked"))), unit: "credit" as const },
      milestones: [] as { description: string; due: string }[],
    };
    const record = createRecord({ type: "proposal", issuer: by, subject: by, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`proposal ${res.id} by ${by} on call ${call} (log seq ${res.seq})`);
    return 0;
  }

  if (sub === "allocate") {
    const by = need("by");
    const proposal = need("proposal");
    const body = { kind: "allocation", about: proposal, verdict: v.verdict ?? "selected" };
    const record = createRecord({ type: "attestation", issuer: by, subject: proposal, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`allocation ${res.id}: panel member ${by} selects proposal ${proposal} (log seq ${res.seq})`);
    return 0;
  }

  if (sub === "contract") {
    const principal = need("principal");
    const bank = need("bank");
    const intentId = v.intent;
    const offerId = v.offer;
    const callId = v.call;
    const proposalId = v.proposal;
    let performer = v.performer;
    let body: Record<string, unknown>;
    let priceValue: number;
    if (intentId || offerId) {
      if (!intentId || !offerId) throw new UsageError("assignment mode needs both --intent and --offer");
      const intentRec = await local.log.get(intentId);
      const offerRec = await local.log.get(offerId);
      if (!intentRec) throw new Error(`intent ${intentId} is not in the log`);
      if (!offerRec) throw new Error(`offer ${offerId} is not in the log`);
      const intentBody = intentRec.record.body as any;
      const offerBody = offerRec.record.body as any;
      performer ??= offerRec.record.issuer;
      priceValue = offerBody.price.value;
      body = {
        principal, performer, bank, purpose: intentBody.purpose, acceptance_criteria: intentBody.acceptance_criteria,
        price: offerBody.price, verification: intentBody.verification.mode, deadline: intentBody.deadline,
        basis: { intent: intentId, offer: offerId },
        ...(intentBody.verification.review_deadline ? { review_deadline: intentBody.verification.review_deadline } : {}),
        ...(intentBody.verification.verifier ? { verifier: intentBody.verification.verifier } : {}),
      };
    } else if (callId || proposalId) {
      if (!callId || !proposalId) throw new UsageError("allocation mode needs both --call and --proposal");
      const callRec = await local.log.get(callId);
      const proposalRec = await local.log.get(proposalId);
      if (!callRec) throw new Error(`call ${callId} is not in the log`);
      if (!proposalRec) throw new Error(`proposal ${proposalId} is not in the log`);
      const callBody = callRec.record.body as any;
      const proposalBody = proposalRec.record.body as any;
      performer ??= proposalBody.team[0];
      priceValue = proposalBody.budget_asked.value;
      body = {
        principal, performer, bank, purpose: callBody.purpose, acceptance_criteria: callBody.evaluation_criteria,
        price: proposalBody.budget_asked, verification: v.verification ?? "principal", deadline: callBody.deadline,
        basis: { call: callId, proposal: proposalId },
      };
    } else {
      throw new UsageError("give --intent and --offer (assignment mode), or --call and --proposal (allocation mode)");
    }
    if (!performer) throw new UsageError("--performer is required (or derivable from the Offer's issuer or the Proposal's team)");
    // Subcontract nesting (docs/spec-deltas.md): the log itself checks this is coherent — the
    // parent must exist, not be Settled yet, and its own performer must be this contract's principal.
    if (v["parent-contract"]) body.parent_contract = v["parent-contract"];
    // Outcome verification: an explicit --verifier wins over the Intent's (and is the only way in allocation mode).
    if (v.verifier) body.verifier = v.verifier;
    let record = createRecord({ type: "contract", issuer: principal, subject: performer, prev: null, body, issued_at: now() }, signerFor(principal));
    record = cosign(record, signerFor(performer));
    const res = await local.append(record);
    io.out(`contract ${res.id}: ${principal} -> ${performer}, price ${priceValue} credits (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  if (sub === "bond") {
    const contract = need("contract");
    const backer = need("backer");
    const escrowPayer = need("escrow-payer");
    const body = {
      contract, backer, amount: { value: Math.trunc(Number(need("amount"))), unit: "credit" as const },
      escrow: { payer: escrowPayer, amount: { value: Math.trunc(Number(need("escrow-amount"))), unit: "credit" as const } },
      slashing_conditions: ["lost_dispute", "floor_breach", "forbidden_means"] as const,
    };
    const record = createRecord({ type: "bond", issuer: backer, subject: contract, prev: contract, body, issued_at: now() }, signerFor(backer));
    const res = await local.append(record);
    io.out(`bond ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);
    io.out(`  locked: ${body.escrow.amount.value} escrow from ${escrowPayer}, ${body.amount.value} bond from ${backer}`);
    return 0;
  }

  if (sub === "mandate") {
    const contract = need("contract");
    const principal = need("principal");
    const performer = need("performer");
    const contractRec = await local.log.get(contract);
    if (!contractRec) throw new Error(`contract ${contract} is not in the log`);
    const cbody = contractRec.record.body as any;
    const chain = await local.log.chain(contract);
    const bond = chain.find((s) => s.record.type === "asp.bond/v0.2");
    if (!bond) throw new Error(`contract ${contract} has no Bond yet; run asp market bond first`);
    const body = {
      contract, purpose: cbody.purpose, floor: "asp.floor/v1" as const,
      scopes: v.scopes?.length ? v.scopes : ["repo.read"],
      forbidden_means: [] as string[],
      spend: { cap: Math.trunc(Number(v["spend-cap"] ?? "0")), unit: "credit" as const },
      irreversible: {
        policy: (v.irreversible ?? "checkpoint") as "checkpoint" | "forbid" | "allow",
        ...(v.gate?.length ? { scopes: v.gate } : {}),
      },
      subcontract: { allowed: false },
      nodes: { max_parallel: 1 },
      learning: { scope: "harness" as const, share_to_commons: false },
      self_modification: "principal_approves" as const,
      overlay: null, checkpoints: [] as string[], expires: cbody.deadline, revocable: true as const,
    };
    const record = createRecord({ type: "mandate", issuer: principal, subject: performer, prev: bond.id, body, issued_at: now() }, signerFor(principal));
    const res = await local.append(record);
    io.out(`mandate ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  if (sub === "deliver") {
    const contract = need("contract");
    const by = need("by");
    const chain = await marketChain(local.log, contract);
    const head = chain.at(-1);
    if (!head) throw new Error(`contract ${contract} is not in the log`);
    const summary = need("summary");
    // --claim "<text>::<measured|simulated|predicted>[::<uri>=<sha256>]": what the Delivery asserts and how
    // well established each claim is, for the verifier to confirm or downgrade by index.
    const claims = (v.claim ?? []).map((entry) => {
      const [claim, grade, evidence] = entry.split("::");
      if (!claim || !["measured", "simulated", "predicted"].includes(grade ?? "")) {
        throw new UsageError(`--claim must be "<text>::<measured|simulated|predicted>[::<uri>=<sha256>]", got "${entry}"`);
      }
      const out: Record<string, unknown> = { claim, grade };
      if (evidence) {
        const [uri, sha256] = evidence.split("=");
        if (!uri || !sha256) throw new UsageError(`a claim's evidence must be <uri>=<sha256>, got "${evidence}"`);
        out.evidence = { uri, sha256: sha256.startsWith("sha256:") ? sha256 : `sha256:${sha256}` };
      }
      return out;
    });
    const body = {
      contract, result: { summary, artifacts: [] as { uri: string; sha256: string }[], ...(claims.length ? { claims } : {}) },
      evidence: { trace: artifactRefOf(summary), forecasts: [] as unknown[] },
    };
    const record = createRecord({ type: "delivery", issuer: by, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`delivery ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  // Outcome verification: the contract's named, independent verifier re-checks the latest Delivery and
  // signs a verdict; --grade <claim index>=<measured|simulated|predicted|unverified> grades each claim.
  if (sub === "verify") {
    const contract = need("contract");
    const by = need("by");
    const verdict = need("verdict");
    if (!["confirmed", "partly_confirmed", "not_confirmed"].includes(verdict)) {
      throw new UsageError("--verdict must be confirmed, partly_confirmed or not_confirmed");
    }
    const chain = await marketChain(local.log, contract);
    const delivery = [...chain].reverse().find((s) => s.kind === "delivery");
    if (!delivery) throw new Error(`contract ${contract} has no Delivery yet; run asp market deliver first`);
    const about = v.about ?? delivery.id;
    const claims = (v.grade ?? []).map((entry) => {
      const [index, grade] = entry.split("=");
      if (!/^\d+$/.test(index ?? "") || !["measured", "simulated", "predicted", "unverified"].includes(grade ?? "")) {
        throw new UsageError(`--grade must be <claim index>=<measured|simulated|predicted|unverified>, got "${entry}"`);
      }
      return { index: Number(index), grade };
    });
    const body: Record<string, unknown> = { kind: "verification", about, verdict, ...(claims.length ? { claims } : {}) };
    if (v.reasons?.length) body.reasons = v.reasons;
    const record = createRecord({ type: "attestation", issuer: by, subject: about, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`verification ${res.id} on delivery ${about}: ${verdict} by ${by} (log seq ${res.seq})`);
    return 0;
  }

  // Approval gates: the performer raises a Checkpoint (asp run does this by itself when a gated call is
  // attempted), and the principal answers with a signed checkpoint_resolution that returns the job to Running.
  if (sub === "checkpoint") {
    const contract = need("contract");
    const by = need("by");
    const kind = v.kind ?? "before_irreversible";
    if (!["plan", "before_irreversible", "high_impact", "delivery"].includes(kind)) throw new UsageError("--kind must be plan, before_irreversible, high_impact or delivery");
    const head = (await marketChain(local.log, contract)).at(-1);
    if (!head) throw new Error(`contract ${contract} is not in the log`);
    const body: Record<string, unknown> = { contract, kind, question: need("question") };
    if (v.summary) body.proposed_action = v.summary;
    if (v.expires) body.expires = v.expires;
    const record = createRecord({ type: "checkpoint", issuer: by, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`checkpoint ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  if (sub === "resolve") {
    const contract = need("contract");
    const by = need("by");
    const verdict = need("verdict");
    if (!["approved", "corrected", "picked", "expired"].includes(verdict)) throw new UsageError("--verdict must be approved, corrected, picked or expired (expired: the performer closes a Checkpoint past its --expires)");
    if (verdict === "corrected" && !v.correction) throw new UsageError("--verdict corrected needs --correction <text>");
    const chain = await marketChain(local.log, contract);
    const head = chain.at(-1);
    const open = [...chain].reverse().find((s) => s.kind === "checkpoint");
    if (!head || !open) throw new Error(`contract ${contract} has no Checkpoint to resolve`);
    const body: Record<string, unknown> = { kind: "checkpoint_resolution", about: v.about ?? open.id, verdict };
    if (v.correction) body.correction = v.correction;
    const record = createRecord({ type: "attestation", issuer: by, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`resolution ${res.id} on contract ${contract}: ${verdict} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  if (sub === "accept" || sub === "reject") {
    const contract = need("contract");
    const by = need("by");
    const chain = await marketChain(local.log, contract);
    const head = chain.at(-1);
    const delivery = [...chain].reverse().find((s) => s.kind === "delivery");
    if (!head) throw new Error(`contract ${contract} is not in the log`);
    if (!delivery) throw new Error(`contract ${contract} has no Delivery yet; run asp market deliver first`);
    const about = v.about ?? delivery.id;
    const body: Record<string, unknown> = { kind: "acceptance", about, verdict: sub === "accept" ? "accepted" : "rejected" };
    if (sub === "reject") body.reasons = v.reasons?.length ? v.reasons : ["rejected"];
    const record = createRecord({ type: "attestation", issuer: by, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`${sub === "accept" ? "acceptance" : "rejection"} ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  // Courts: a ruling on a Disputed job, drawn from the real staked juror panel (asp-log's
  // drawPanel/checkRulingPanel) when at least one is registered anywhere; falls back to any
  // neutral DID when none are (MOCKS.md #4's original mocked behavior, unchanged).
  if (sub === "rule") {
    const contract = need("contract");
    const by = need("by");
    const verdict = need("verdict");
    if (!["for_performer", "for_principal", "split"].includes(verdict)) {
      throw new UsageError("--verdict is for_performer, for_principal or split");
    }
    const chain = await marketChain(local.log, contract);
    const head = chain.at(-1);
    if (!head) throw new Error(`contract ${contract} is not in the log`);
    const fault: Record<string, number> = {};
    for (const entry of v.fault ?? []) {
      const [did, permille] = entry.split("=");
      if (!did || !permille) throw new UsageError(`--fault must be <did>=<permille>, got "${entry}"`);
      fault[did] = Math.trunc(Number(permille));
    }
    if (!Object.keys(fault).length) throw new UsageError("--fault <did>=<permille> is required, at least once");
    const body = { kind: "ruling", about: contract, verdict, fault };
    let record = createRecord({ type: "attestation", issuer: by, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(by));
    for (const cosigner of v["cosign-by"] ?? []) record = cosign(record, signerFor(cosigner));
    const res = await local.append(record);
    io.out(`ruling ${res.id} on contract ${contract}: ${verdict} (log seq ${res.seq}, state ${res.state})`);
    return 0;
  }

  // Courts: who is eligible to be drawn (real credits at stake) and who was actually drawn.
  if (sub === "juror" && rest[0] === "register") {
    const by = need("by");
    const stake = Math.trunc(Number(need("stake")));
    const current = await local.log.juror(by);
    const body = { did: by, stake: { value: stake, unit: "credit" as const } };
    const record = createRecord({ type: "juror", issuer: by, subject: by, prev: current?.head ?? null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`juror ${res.id}: ${by} now stakes ${stake} credits (log seq ${res.seq})`);
    return 0;
  }
  if (sub === "juror" && rest[0] === "show") {
    const did = rest[1] ?? v.to;
    if (!did) throw new UsageError("asp market juror show <did>");
    const juror = await local.log.juror(did);
    io.out(juror ? `${did}: staked ${juror.staked} credits` : `${did} is not a registered juror`);
    return 0;
  }
  if (sub === "panel" && rest[0] === "draw") {
    const contract = need("contract");
    const size = v.size ? Math.trunc(Number(v.size)) : undefined;
    const panel = await local.log.drawPanel(contract, size);
    io.out(panel.length ? `drawn panel for ${contract}: ${panel.join(", ")}` : `no staked, conflict-free jurors registered; asp market rule accepts any neutral DID`);
    return 0;
  }

  // The runtime -> protocol compliance bridge (docs/backlog.md): a self-issued, checkable report of
  // scopes actually used, against the contract's live Mandate. `asp run --contract` emits this
  // automatically from real tool calls; this command is for reporting by hand, or from a runtime
  // with no live-emission wiring yet.
  if (sub === "action") {
    const contract = need("contract");
    const by = need("by");
    const scopesUsed = v["scopes-used"] ?? [];
    const body: Record<string, unknown> = { contract, scopes_used: scopesUsed };
    if (v.summary) body.summary = v.summary;
    if (v.artifact?.length) {
      body.artifacts = v.artifact.map((entry) => {
        const [uri, sha256] = entry.split("=");
        if (!uri || !sha256) throw new UsageError(`--artifact must be <uri>=<sha256>, got "${entry}"`);
        return { uri, sha256: sha256.startsWith("sha256:") ? sha256 : `sha256:${sha256}` };
      });
    }
    const record = createRecord({ type: "action", issuer: by, subject: contract, prev: null, body, issued_at: now() }, signerFor(by));
    const res = await local.append(record);
    io.out(`action ${res.id} on contract ${contract}: ${scopesUsed.join(", ") || "no scopes"} (log seq ${res.seq})`);
    return 0;
  }

  if (sub === "settle") {
    const contract = need("contract");
    const bank = need("bank");
    const basis = need("basis") as "accepted" | "ruling" | "revoked" | "silence";
    const chain = await marketChain(local.log, contract);
    const head = chain.at(-1);
    if (!head) throw new Error(`contract ${contract} is not in the log`);

    let escrowReleased = v["escrow-released"] !== undefined ? Math.trunc(Number(v["escrow-released"])) : undefined;
    let bondSlashed = v["bond-slashed"] !== undefined ? Math.trunc(Number(v["bond-slashed"])) : undefined;
    const bondReturned = Math.trunc(Number(v["bond-returned"] ?? "0"));
    let cited: string | undefined = v.cites;

    if (basis === "accepted" || basis === "ruling") {
      cited ??= [...chain].reverse().find((s) => s.kind === "attestation")?.id;
      if (!cited) throw new Error(`no attestation to cite; give --cites <id>, or run asp market accept/reject first`);
    }
    // A ruling's fault on the performer *is* the payout formula (asp-log's checkRulingPanel guard,
    // docs/spec-deltas.md S13) — derive it here rather than making the caller compute it by hand.
    if (basis === "ruling" && (escrowReleased === undefined || bondSlashed === undefined)) {
      const [rulingRec, escrow] = await Promise.all([local.log.get(cited!), local.log.escrow(contract)]);
      const contractRec = await local.log.get(contract);
      const performer = (contractRec!.record.body as any).performer;
      const fault = (rulingRec?.record.body as any)?.fault?.[performer] ?? 0;
      escrowReleased ??= Math.floor((escrow!.escrowLocked * (1000 - fault)) / 1000);
      bondSlashed ??= Math.ceil((escrow!.bondLocked * fault) / 1000);
    }

    const body: Record<string, unknown> = {
      contract, basis,
      escrow_released: { value: escrowReleased ?? 0, unit: "credit" },
      bond_returned: { value: bondReturned, unit: "credit" },
      bond_slashed: { value: bondSlashed ?? 0, unit: "credit" },
    };
    // Comes out of the same escrow, on top of escrow_released; credits to the local mock platform
    // account (EventLog.PLATFORM_DID) standing in for a real platform/Insurer recipient (MOCKS.md).
    if (v.fees) body.fees = { value: Math.trunc(Number(v.fees)), unit: "credit" };
    if (v["agent-permille"] !== undefined) body.earnings_split = { agent_permille: Math.trunc(Number(v["agent-permille"])) };
    if (basis === "revoked") body.pro_rata_permille =Math.trunc(Number(v["pro-rata"] ?? "0"));
    else if (basis === "accepted" || basis === "ruling") body.cites = cited;
    let record = createRecord({ type: "settlement", issuer: bank, subject: contract, prev: head.id, body, issued_at: now() }, signerFor(bank));
    if (basis === "revoked") {
      const contractRec = await local.log.get(contract);
      const principal = (contractRec!.record.body as any).principal;
      record = cosign(record, signerFor(v.principal ?? principal));
    }
    const res = await local.append(record);
    io.out(`settlement ${res.id} on contract ${contract} (log seq ${res.seq}, state ${res.state})`);

    // Lineage as behavior-shaping (docs/backlog.md "Making a slash actually matter", mechanism 3):
    // a slash writes a real, signed lineage edge for the backer, self-issued — the log can't sign
    // on anyone's behalf, so this only happens when that DID's own key is available locally (true
    // for single-player testing; a real network would need the backer's own agent to countersign
    // this itself). asp pack later renders it into memory/PENALTIES.md, so it's what the agent
    // actually reads at the start of its next run, not just an entry in its signed history.
    if ((bondSlashed ?? 0) > 0) {
      const escrow = await local.log.escrow(contract);
      const backerSigner = escrow && keys.forDid(escrow.backer);
      if (escrow && backerSigner) {
        const lineage = createRecord({
          type: "lineage", issuer: escrow.backer, subject: escrow.backer, prev: null,
          body: {
            edge: "update", child: escrow.backer, parents: [escrow.backer],
            change: { layer: "memory", description: `Penalized: bond slashed ${bondSlashed} credits on contract ${contract} (settlement basis: ${basis}).` },
          },
          issued_at: now(),
        }, backerSigner);
        const lineageRes = await local.append(lineage);
        io.out(`  penalty recorded: lineage ${lineageRes.id} for ${escrow.backer}`);
      } else if (escrow) {
        io.out(`  note: ${escrow.backer} was slashed but no local key is available to record it in lineage`);
      }
    }
    return 0;
  }

  if (sub === "show") {
    const contract = rest[0] ?? v.contract;
    if (!contract) throw new UsageError("asp market show <contract>");
    const chain = await marketChain(local.log, contract);
    const info = await local.log.chainInfo(contract);
    io.out(`contract ${contract}: state ${info?.state ?? "unknown"}, ${chain.length} records`);
    for (const s of chain) io.out(`  seq ${s.seq}  ${s.kind.padEnd(11)} ${s.id}`);
    const escrow = await local.log.escrow(contract);
    if (escrow) io.out(`  escrow: ${escrow.escrowLocked} locked from ${escrow.escrowPayer}, ${escrow.bondLocked} bond from ${escrow.backer}, settled: ${escrow.settled}`);
    return 0;
  }

  throw new UsageError("asp market intent|offer|call|propose|allocate|contract|bond|mandate|deliver|verify|checkpoint|resolve|accept|reject|rule|settle|show|action|juror register|juror show|panel draw");
}

/** The signed records a package needs: the agent's passports, its sponsors' passports, its fleet, its lineage. */
/**
 * Renders any of this agent's lineage `update` edges written by a slash (asp market settle's
 * "Penalized: ..." descriptions) into memory/PENALTIES.md, so the runtime materializes it into the
 * agent's own memory alongside everything else in the package — the second half of "lineage as
 * behavior-shaping" (docs/backlog.md): the point isn't that the penalty is *recorded*, it's that
 * the agent actually reads it at the start of its next run. Writes nothing if there are none.
 */
function writePenalties(staging: string, agent: string, history: AspRecord[]): void {
  const penalties = history
    .filter((r) => r.type === "asp.lineage/v0.2" && (r.body as any).child === agent)
    .map((r) => ({ issuedAt: r.issued_at, description: (r.body as any).change?.description as string | undefined }))
    .filter((p): p is { issuedAt: string; description: string } => !!p.description?.startsWith("Penalized:"))
    .sort((a, b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt));
  if (!penalties.length) return;
  const dir = join(staging, "memory");
  mkdirSync(dir, { recursive: true });
  const lines = ["# Penalties", "", "Read this before deciding how to act — these are real, signed consequences from past jobs.", ""];
  for (const p of penalties) lines.push(`- ${p.issuedAt}: ${p.description}`);
  appendFileEnsured(join(dir, "PENALTIES.md"), Buffer.from(lines.join("\n") + "\n"));
}

async function historyFor(log: LocalLog["log"], agent: string): Promise<AspRecord[]> {
  const all: AspRecord[] = [];
  for (let after = 0; ; ) {
    const page = await log.since(after, 500);
    if (!page.length) break;
    all.push(...page.map((s) => s.record));
    after = page.at(-1)!.seq;
  }
  const dids = new Set<string>([agent]);
  const fleets = new Set<string>();
  // Follow sponsors upward, and collect fleets.
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of all) {
      const b = r.body as any;
      if (r.type !== "asp.passport/v0.2" || !dids.has(b.did)) continue;
      for (const d of [b.sponsor, r.issuer]) if (d && !dids.has(d)) { dids.add(d); grew = true; }
      if (b.fleet) fleets.add(b.fleet);
    }
    for (const r of all) {
      const b = r.body as any;
      if (r.type === "asp.fleet/v0.2" && fleets.has(b.did) && !dids.has(b.org)) { dids.add(b.org); grew = true; }
    }
  }
  return all.filter((r) => {
    const b = r.body as any;
    if (r.type === "asp.passport/v0.2") return dids.has(b.did);
    if (r.type === "asp.fleet/v0.2") return fleets.has(b.did);
    if (r.type === "asp.lineage/v0.2") return b.child === agent;
    return false;
  });
}

async function pack(home: string, v: Values, need: Need, io: Io): Promise<number> {
  const runtime = need("runtime");
  const adapter = ADAPTERS[runtime];
  if (!adapter) throw new UsageError(`unknown runtime ${runtime}; available: ${Object.keys(ADAPTERS).join(", ")}`);
  const agent = need("agent");
  const project = resolve(io.cwd, v.project ?? ".");
  const log = await LocalLog.open(home);
  if (!(await log.log.passport(agent))) throw new Error(`${agent} has no passport; create one with: asp identity new --kind agent --did ${agent} --sponsor <your did>`);
  const signer = new Keystore(home).forDid(agent);
  if (!signer) throw new Error(`no key for ${agent} in ${join(home, "keys")}`);

  const staging = mkdtempSync(join(tmpdir(), "asp-pack-"));
  try {
    const capture = await adapter.capture({ project, includeUser: v["include-user"] ?? false, home: v["user-home"] ?? v["claude-home"], staging });
    const history = await historyFor(log.log, agent);
    writePenalties(staging, agent, history);
    const findings = [...scanForSecrets(join(staging, "harness"), "harness/"), ...scanForSecrets(join(staging, "memory"), "memory/")];
    if (findings.length) {
      io.err("refusing to pack: these captured files look like they contain secrets (values not shown):");
      for (const f of findings) io.err(`  ${f.file}:${f.line}  ${f.kind}`);
      io.err("remove them or move them into environment variables, then pack again.");
      return 1;
    }
    const out = resolve(io.cwd, v.out ?? `${slug(agent)}-${now().slice(0, 10)}.aspkg`);
    const asArchive = /\.(tgz|tar\.gz)$/i.test(out);
    const writeDir = asArchive ? mkdtempSync(join(tmpdir(), "asp-pack-out-")) : out;
    const manifest = writePackage({ out: writeDir, capture, agent, signer, history });
    if (asArchive) {
      await packDirectory(writeDir, out);
      rmSync(writeDir, { recursive: true, force: true });
    }
    const h: Harness = capture.harness;
    io.out(`packed ${agent} from ${runtime} (${project})`);
    io.out(`  package      ${out}${asArchive ? " (single file)" : ""}`);
    io.out(`  manifest     ${manifest.id}`);
    io.out(`  instructions ${h.instructions.map((i) => i.name).join(", ") || "none"}`);
    io.out(`  skills       ${h.skills.length}   subagents ${h.subagents.length}   commands ${h.commands.length}   MCP servers ${Object.keys(h.mcp_servers).length}`);
    io.out(`  hooks        ${Object.keys(h.hooks).join(", ") || "none"}`);
    io.out(`  sessions     ${capture.sessions} indexed (metadata only)`);
    if (h.secrets?.length) io.out(`  secrets      ${h.secrets.join(", ")} (placeholders; set them in the environment at run time)`);
    for (const w of capture.warnings) io.out(`  warning      ${w}`);
    return 0;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function verify(pkg: string | undefined, json: boolean, io: Io): Promise<number> {
  if (!pkg) throw new UsageError("asp verify <package>");
  const resolved = await resolvePackage(resolve(io.cwd, pkg));
  const report = await verifyPackage(resolved.dir);
  await finishPackage(resolved, false);
  if (json) io.out(JSON.stringify(report, null, 2));
  else {
    io.out(`${report.ok ? "VERIFIED" : "FAILED"}  ${report.agent ?? pkg}`);
    for (const c of report.checks) io.out(`  ${c.status.padEnd(4)}  ${c.name.padEnd(10)} ${c.detail ?? ""}`);
  }
  return report.ok ? 0 : 1;
}

async function run(home: string, pkg: string | undefined, v: Values, need: Need, io: Io): Promise<number> {
  if (!pkg) throw new UsageError("asp run <package> --backend <runtime>");
  const backend = need("backend");
  const adapter = ADAPTERS[backend];
  if (!adapter) throw new UsageError(`unknown backend ${backend}; available: ${Object.keys(ADAPTERS).join(", ")}`);
  const resolved = await resolvePackage(resolve(io.cwd, pkg));
  let mutated = false;
  try {
    return await runIn(resolved.dir, home, backend, adapter, v, io, () => { mutated = true; });
  } finally {
    await finishPackage(resolved, mutated);
  }
}

/**
 * The kill switch's economic consequence (docs/backlog.md): the same `basis: "revoked"` Settlement
 * `asp market settle` already exposes for manual mid-job cancellation, just with the numbers set to
 * full fault instead of a benign pro-rata split — zero escrow released, the whole bond slashed, the
 * escrow (plus the slash, as compensation) returned to the principal. No new settlement basis and no
 * lifecycle change: `checkSettlement`'s `revoked` guard already allows any split within what's locked,
 * it's the CLI choosing full fault here. Requires the bank's and the principal's keys to be available
 * locally to sign/cosign — true in this single-player build, an honest limit in a real deployment
 * (same as the existing slash-lineage write, which also only fires when a key happens to be local).
 */
async function autoSettleOnKill(local: LocalLog, home: string, contract: string, io: Io): Promise<void> {
  const [contractRec, escrow] = await Promise.all([local.log.get(contract), local.log.escrow(contract)]);
  if (!contractRec || !escrow) { io.err(`  settle   kill-switch fired but contract ${contract} has no Bond to slash`); return; }
  if (escrow.settled) { io.err(`  settle   kill-switch fired but contract ${contract} was already settled`); return; }
  const cbody = contractRec.record.body as { principal: string; bank: string };
  const bankSigner = new Keystore(home).forDid(cbody.bank);
  const principalSigner = new Keystore(home).forDid(cbody.principal);
  if (!bankSigner || !principalSigner) {
    io.err(`  settle   kill-switch fired but could not auto-settle: no local key for ${!bankSigner ? cbody.bank : cbody.principal}`);
    return;
  }
  const chain = await marketChain(local.log, contract);
  const body = {
    contract, basis: "revoked" as const,
    escrow_released: { value: 0, unit: "credit" }, bond_returned: { value: 0, unit: "credit" },
    bond_slashed: { value: escrow.bondLocked, unit: "credit" }, pro_rata_permille: 0,
  };
  let record = createRecord({ type: "settlement", issuer: cbody.bank, subject: contract, prev: chain.at(-1)!.id, body, issued_at: now() }, bankSigner);
  record = cosign(record, principalSigner);
  try {
    const res = await local.append(record);
    io.err(`  settle   ${res.id} kill-switch settlement: bond fully slashed, escrow returned to the principal`);
  } catch (e) {
    io.err(`  settle   kill-switch fired but auto-settlement was refused: ${(e as Error).message}`);
  }
}

/**
 * Approval gates, the run side. The pre-call hook holds a gated call and drops a request file; this
 * raises it as a Checkpoint (signed by the performer, which moves the job to Checkpoint), waits for the
 * principal's signed checkpoint_resolution to appear in the log, and writes the hook's decision file:
 * approved only for an `approved` resolution. Each request reopens the log fresh, because the principal
 * answers from another process, and requests are served one at a time (a job has one open Checkpoint).
 */
function serveApprovals(o: { dir: string; home: string; contract: string; agent: string; pollMs: number; waitSeconds: number; io: Io }) {
  let stopped = false;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const decide = (id: string, d: { approved: boolean; reason?: string }) => writeFileSync(join(o.dir, `${id}.decision.json`), JSON.stringify(d));

  async function handle(req: { id: string; tool: string; scope: string; summary: string }) {
    const signer = new Keystore(o.home).forDid(o.agent);
    if (!signer) return decide(req.id, { approved: false, reason: `no key for ${o.agent} to raise the Checkpoint` });
    // A job has one open Checkpoint at a time: wait for any earlier one to be resolved first.
    let local = await LocalLog.open(o.home);
    while ((await local.log.chainInfo(o.contract))?.state !== "Running") {
      if (stopped) return;
      await sleep(o.pollMs);
      local = await LocalLog.open(o.home);
    }
    // What the principal sees, and what goes in the log, is the command with anything secret-looking masked.
    const masked = redactSecrets(req.summary);
    const shown = masked.text.length > 300 ? masked.text.slice(0, 300) + "..." : masked.text;
    const head = (await marketChain(local.log, o.contract)).at(-1)!;
    const principal = ((await local.log.get(o.contract))!.record.body as { principal: string }).principal;
    // The request expires when the hook gives up waiting; then the performer closes the Checkpoint itself, so the job is not stuck.
    const expiresMs = Math.ceil((Date.now() + o.waitSeconds * 1000) / 1000) * 1000;
    const checkpoint = createRecord({
      type: "checkpoint", issuer: o.agent, subject: o.contract, prev: head.id, issued_at: now(),
      body: { contract: o.contract, kind: "before_irreversible", question: `May ${o.agent} run ${req.tool} (${req.scope})?`, proposed_action: shown,
        expires: new Date(expiresMs).toISOString().replace(/\.\d{3}Z$/, "Z") },
    }, signer);
    await local.append(checkpoint);
    o.io.err(`  APPROVAL NEEDED  ${req.scope}: ${shown}${masked.redacted ? "  (secret-looking text was masked)" : ""}`);
    o.io.err(`    answer with: asp market resolve --contract ${o.contract} --by ${principal} --verdict approved`);
    for (;;) {
      // The run is over: wait out a nearly-expired request, but leave a far-off one open (it can be answered, or expired later).
      if (stopped && expiresMs + 1000 - Date.now() > 10_000) {
        o.io.err(`  note     the Checkpoint for ${req.scope} is still open; the principal can answer it, or ${o.agent} can close it after ${new Date(expiresMs).toISOString()} with asp market resolve --verdict expired`);
        return;
      }
      await sleep(o.pollMs);
      const fresh = await LocalLog.open(o.home);
      const chain = await marketChain(fresh.log, o.contract);
      const at = chain.findIndex((x) => x.id === checkpoint.id);
      const resolution = chain.slice(at + 1).find((x) => {
        const b = x.record.body as { kind?: string; about?: string };
        return x.record.type === "asp.attestation/v0.2" && b.kind === "checkpoint_resolution" && b.about === checkpoint.id;
      });
      if (!resolution) {
        if (Date.now() < expiresMs + 1000) continue;
        const expired = createRecord({
          type: "attestation", issuer: o.agent, subject: o.contract, prev: chain.at(-1)!.id, issued_at: now(),
          body: { kind: "checkpoint_resolution", about: checkpoint.id, verdict: "expired" },
        }, signer);
        await fresh.append(expired);
        o.io.err(`  approval expired for ${req.scope}: no answer in ${o.waitSeconds} s, so the call was refused and the job runs again`);
        return decide(req.id, { approved: false, reason: `the principal did not answer within ${o.waitSeconds} seconds` });
      }
      const b = resolution.record.body as { verdict: string; correction?: string };
      const approved = b.verdict === "approved";
      o.io.err(`  approval ${approved ? "granted" : "refused"} for ${req.scope}${b.correction ? `: ${b.correction}` : ""}`);
      return decide(req.id, approved ? { approved: true } : { approved: false, reason: b.correction ?? `the principal answered ${b.verdict}` });
    }
  }

  const loop = (async () => {
    mkdirSync(o.dir, { recursive: true });
    while (!stopped) {
      const files = readdirSync(o.dir).filter((f) => f.endsWith(".request.json")).sort();
      for (const f of files) {
        if (stopped) break;
        const path = join(o.dir, f);
        const req = JSON.parse(readFileSync(path, "utf8"));
        renameSync(path, join(o.dir, f.replace(".request.json", ".request.seen.json")));
        try { await handle(req); } catch (e) { try { decide(req.id, { approved: false, reason: `asp run could not raise the Checkpoint: ${(e as Error).message}` }); } catch { /* the run is ending */ } }
      }
      await sleep(o.pollMs);
    }
  })();
  return { stop: async () => { stopped = true; await loop; } };
}

async function runIn(pkgDir: string, home: string, backend: string, adapter: RuntimeAdapter, v: Values, io: Io, onMutate: () => void): Promise<number> {
  const report = await verifyPackage(pkgDir);
  if (!report.ok) {
    io.err(`refusing to run: the package does not verify (${report.checks.filter((c) => c.status === "fail").map((c) => c.name).join(", ")}). Run asp verify for details.`);
    return 1;
  }
  const manifest = JSON.parse(readFileSync(join(pkgDir, "manifest.json"), "utf8")) as AspRecord;
  const harness = JSON.parse(readFileSync(join(pkgDir, "harness", "harness.json"), "utf8")) as Harness;
  const agent = report.agent!;
  const runDir = join(home, "runs", `${slug(agent)}-${now().replace(/[:]/g, "")}`);
  const maxStrikes = v["max-strikes"] === undefined ? 3 : Number(v["max-strikes"]);
  if (!Number.isInteger(maxStrikes) || maxStrikes < 1) throw new UsageError("--max-strikes must be a whole number, at least 1");
  const approvalWait = v["approval-wait"] === undefined ? 600 : Number(v["approval-wait"]);
  if (!Number.isInteger(approvalWait) || approvalWait < 1) throw new UsageError("--approval-wait must be a whole number of seconds, at least 1");
  mkdirSync(runDir, { recursive: true });
  // Under a contract, the live Mandate is read once up front: it drives the pre-call hook (an
  // out-of-scope call is blocked before it runs, where the adapter supports it) and the live check below.
  let local = v.contract ? await LocalLog.open(home) : undefined;
  const mandate = v.contract ? await local!.log.mandateOf(v.contract) : undefined;
  // The Mandate's irreversible policy: scopes that need the principal's approval first, or are forbidden.
  let gate: { scopes: string[]; mode: "ask" | "deny"; waitSeconds: number } | undefined;
  if (v.contract && mandate) {
    const mandateRecord = (await local!.log.chain(v.contract)).filter((x) => x.record.type === "asp.mandate/v0.2").at(-1);
    const irreversible = (mandateRecord?.record.body as { irreversible?: { policy?: string; scopes?: string[] } } | undefined)?.irreversible;
    if (irreversible?.scopes?.length && irreversible.policy !== "allow") {
      gate = { scopes: irreversible.scopes, mode: irreversible.policy === "forbid" ? "deny" : "ask", waitSeconds: approvalWait };
    }
  }
  const plan = await adapter.materialize({
    pkgDir, harness, project: resolve(io.cwd, v.project ?? "."), runDir, agentName: basename(agent.replace(/:/g, "/")), prompt: v.prompt, env: io.env,
    mandateScopes: mandate?.scopes, mandateGate: gate, model: v.model, endpoint: v.endpoint, apiKeyEnv: v["api-key-env"], sourceRuntime: (manifest.body as any).source_runtime?.name,
  });

  // The run's own report goes to stderr, so a -p run's stdout stays the runtime's stream alone.
  const current = currentRuntime(pkgDir, manifest);
  const swap = current !== backend;
  io.err(`run ${agent} on ${backend}${swap ? ` (last ran on ${current})` : ""}`);
  io.err(`  run dir  ${runDir}`);
  io.err(`  cwd      ${plan.cwd}`);
  io.err(`  command  ${[plan.command, ...plan.args].map(quote).join(" ")}`);
  for (const n of plan.notes) io.err(`  note     ${n}`);
  if (swap) io.err(`  note     ${v["dry-run"] ? "a real run would record" : "after a successful run, records"} the backend swap ${current} -> ${backend} as a lineage update (7-day probation)`);
  if (plan.missingSecrets.length) {
    io.err(`missing secrets: ${plan.missingSecrets.join(", ")}; set them as environment variables.`);
    if (!v["dry-run"]) return 1;
  }
  if (v["dry-run"]) return 0;

  // Some runtimes report a fatal error only inside their output stream and still exit 0
  // (see checkOutputForFailure); when the adapter asks for it, stdout is piped and scanned
  // line by line while still being forwarded, instead of simply inherited. The compliance bridge
  // (checkOutputForAction, docs/backlog.md) piggybacks on the same piping: real tool-call scopes,
  // not self-declared ones, collected as they happen.
  //
  // Kill switch (docs/backlog.md, raised 2026-09-28): with a live Mandate to check against, the
  // very first out-of-scope call stops the child process instead of only being flagged once the
  // run has already finished. It can't undo the call that already happened, but it stops the next
  // one. SIGTERM first, SIGKILL after a grace period if the runtime doesn't exit on its own.
  //
  // Strikes (docs/backlog.md): where the adapter blocks out-of-scope calls before they run (a
  // pre-call hook), a blocked attempt did no harm, so it is a signed strike, not grounds for the full
  // settlement: the run is stopped only when --max-strikes blocked attempts pile up (probing), or
  // when an out-of-scope call actually executed (the hook missing, failing open, or timing out).
  // Each out-of-scope call waits for its outcome (checkOutputForResult) before it is judged.
  const KILL_GRACE_MS = 3000;
  let hiddenFailure: string | undefined;
  const scopesSeen = new Set<string>();
  const artifactsSeen: { uri: string; sha256: string }[] = [];
  const prevents = !!(plan.preventsCalls && plan.checkOutputForResult && mandate);
  const pending = new Map<string, { scope: string; artifact?: { uri: string; sha256: string }; gated: boolean }>();
  const gatedScopes = new Set(gate?.mode === "ask" ? gate.scopes : []);
  const forbiddenScopes = new Set(gate?.mode === "deny" ? gate.scopes : []);
  if (gate?.mode === "ask" && !plan.approvalsDir) {
    io.err(`  note     ${backend} cannot hold a call for approval, so ${gate.scopes.join(", ")} are NOT gated on this run`);
  }
  const blockedByScope = new Map<string, number>();
  let strikes = 0;
  let killed: { scope: string; reason: "violation" | "probing" } | undefined;
  const code = await new Promise<number>((done) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd, env: { ...io.env, ...plan.env },
      stdio: (plan.checkOutputForFailure || plan.checkOutputForAction) ? ["inherit", "pipe", "inherit"] : "inherit",
    });
    let killTimer: NodeJS.Timeout | undefined;
    const approvals = plan.approvalsDir && v.contract
      ? serveApprovals({ dir: plan.approvalsDir, home, contract: v.contract, agent, pollMs: Number(io.env.ASP_APPROVAL_POLL_MS) > 0 ? Number(io.env.ASP_APPROVAL_POLL_MS) : 1000, waitSeconds: approvalWait, io })
      : undefined;
    const strike = (scope: string, how: string) => {
      strikes++;
      blockedByScope.set(scope, (blockedByScope.get(scope) ?? 0) + 1);
      io.err(`  strike   ${scope} was ${how} (${strikes} of ${maxStrikes})`);
      if (strikes >= maxStrikes) halt({ scope, reason: "probing" }, `${strikes} blocked attempts reached the limit of ${maxStrikes}; stopping ${backend} now.`);
    };
    // Did the runtime actually run this call? Where the adapter records that (its post-call events), the
    // record decides; the result's text never does. The record may land a moment after the result, so a call
    // with no record yet is rechecked for a short grace period before it is judged not run.
    const ranFile = plan.executedCallsFile;
    const didRun = (id: string): boolean => {
      if (!ranFile || !existsSync(ranFile)) return false;
      return readFileSync(ranFile, "utf8").split(/\r?\n/).some((l) => { try { return JSON.parse(l).id === id; } catch { return false; } });
    };
    const confirmations: Promise<void>[] = [];
    const settle = (id: string, onRan: () => void, onNotRun: () => void) => {
      if (!ranFile || didRun(id)) { onRan(); return; } // no record kept for this runtime: assume it ran
      confirmations.push((async () => {
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 100));
          if (didRun(id)) { onRan(); return; }
        }
        onNotRun();
      })());
    };
    const halt = (k: { scope: string; reason: "violation" | "probing" }, message: string) => {
      if (killed) return;
      killed = k;
      io.err(`  KILL SWITCH  ${message}`);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, KILL_GRACE_MS);
    };
    if (plan.checkOutputForFailure || plan.checkOutputForAction) {
      let carry = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
        carry += chunk.toString("utf8");
        const lines = carry.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) {
          hiddenFailure ??= plan.checkOutputForFailure?.(line);
          for (const call of plan.checkOutputForAction?.(line) ?? []) {
            const outside = !!mandate && (!mandate.scopes.includes(call.scope) || forbiddenScopes.has(call.scope));
            const held = !outside && !!plan.approvalsDir && gatedScopes.has(call.scope);
            if (prevents && (outside || held) && call.id) {
              pending.set(call.id, { scope: call.scope, artifact: call.artifact, gated: held });
              continue;
            }
            scopesSeen.add(call.scope);
            if (call.artifact) artifactsSeen.push(call.artifact);
            if (outside) halt({ scope: call.scope, reason: "violation" }, `${call.scope} is outside the Mandate; stopping ${backend} now.`);
          }
          if (prevents) for (const res of plan.checkOutputForResult!(line) ?? []) {
            const call = pending.get(res.id);
            if (!call) continue;
            pending.delete(res.id);
            const ran = () => { scopesSeen.add(call.scope); if (call.artifact) artifactsSeen.push(call.artifact); };
            if (call.gated) {
              // An approval gate, not a violation: refused means the call never ran and nothing is counted.
              if (res.blocked) io.err(`  gate     ${call.scope} was not approved, so the call did not run`);
              else settle(res.id, ran, () => io.err(`  gate     ${call.scope} was approved, but the runtime did not run the call`));
              continue;
            }
            if (res.blocked) strike(call.scope, "blocked before it ran");
            else {
              // No hook blocked it. It is only a violation if the runtime says it ran: its own permissions may
              // have refused the call, which did no harm and is a strike, never a slash.
              settle(res.id,
                () => { ran(); halt({ scope: call.scope, reason: "violation" }, `${call.scope} is outside the Mandate and the call ran; stopping ${backend} now.`); },
                () => strike(call.scope, "refused by the runtime before it ran"));
            }
          }
        }
      });
    }
    child.on("error", (e: NodeJS.ErrnoException) => {
      io.err(e.code === "ENOENT"
        ? `${plan.command} is not installed or not on PATH. Install it, or rerun with --dry-run.`
        : `could not start ${plan.command}: ${e.message}`);
      void (approvals ? approvals.stop() : Promise.resolve()).then(() => done(-1));
    });
    // "close", not "exit": every line of output is read (and every outcome judged) before the run is wrapped up.
    child.on("close", (c) => {
      if (killTimer) clearTimeout(killTimer);
      void (approvals ? approvals.stop() : Promise.resolve())
        .then(() => Promise.all(confirmations))
        .then(() => done(c ?? 1));
    });
  });
  if (code === -1) return 1;
  // The principal may have answered Checkpoints from another process while the run was going.
  if (v.contract) local = await LocalLog.open(home);

  if (pending.size) io.err(`  note     ${pending.size} out-of-scope call(s) ended with no result, so they were not counted either way`);
  const blockedAttempts = [...blockedByScope].sort(([a], [b]) => a.localeCompare(b)).map(([scope, count]) => ({ scope, count }));

  if (killed) {
    // A refused Action record for the offending scope, purely for the paper trail (it will be
    // refused the same way checkAction refuses any out-of-scope call — this never gets laundered
    // into a clean-looking log). Then the same economic consequence a Courts ruling of full fault
    // would produce: escrow back to the principal, the performer's whole bond slashed — without
    // waiting for a human to notice the job stalled Running and open a dispute themselves.
    const actionSigner = new Keystore(home).forDid(agent);
    if (actionSigner) {
      const action = createRecord({
        type: "action", issuer: agent, subject: v.contract!, prev: null, issued_at: now(),
        body: {
          contract: v.contract!, scopes_used: [...scopesSeen].sort(), summary: `${backend} run, ${runDir}, killed mid-run`,
          ...(blockedAttempts.length ? { blocked_attempts: blockedAttempts } : {}),
          ...(artifactsSeen.length ? { artifacts: artifactsSeen } : {}),
        },
      }, actionSigner);
      try { await local!.append(action); } catch (e) { io.err(`  action   COMPLIANCE VIOLATION: ${(e as Error).message}`); }
    }
    await autoSettleOnKill(local!, home, v.contract!, io);
    const why = killed.reason === "probing" ? `repeated blocked attempts (${strikes}, limit ${maxStrikes})` : `a Mandate violation (${killed.scope})`;
    io.err(`${backend} killed mid-run for ${why}; nothing written back. The run's memory is in ${plan.memoryDir ?? runDir}.`);
    return 1;
  }

  if (code !== 0 || hiddenFailure) {
    if (hiddenFailure) io.err(`${backend} reported a failure it did not exit with: ${hiddenFailure}`);
    io.err(`${backend} ${hiddenFailure ? "failed" : `exited with code ${code}`}; nothing written back. The run's memory is in ${plan.memoryDir ?? runDir}.`);
    return hiddenFailure ? 1 : code;
  }

  // The runtime -> protocol compliance bridge: report what was actually used against the
  // contract's live Mandate, before the agent gets to write up a clean Delivery. Self-reported by
  // this same CLI process (not the runtime), so it can't be skipped by a runtime that doesn't know
  // about it, but it's still only as honest as the tool-call parsing that produced scopesSeen.
  if (v.contract && (scopesSeen.size || blockedAttempts.length)) {
    const actionSigner = new Keystore(home).forDid(agent);
    if (actionSigner) {
      const action = createRecord({
        type: "action", issuer: agent, subject: v.contract, prev: null, issued_at: now(),
        body: {
          contract: v.contract, scopes_used: [...scopesSeen].sort(), summary: `${backend} run, ${runDir}`,
          ...(blockedAttempts.length ? { blocked_attempts: blockedAttempts } : {}),
          ...(artifactsSeen.length ? { artifacts: artifactsSeen } : {}),
        },
      }, actionSigner);
      try {
        const res = await local!.append(action);
        io.err(`  action   ${res.id} reported scopes: ${[...scopesSeen].sort().join(", ") || "none"}${strikes ? `; ${strikes} blocked attempt(s) recorded as a strike` : ""}`);
      } catch (e) {
        io.err(`  action   COMPLIANCE VIOLATION: ${(e as Error).message}`);
      }
    }
  }

  // Write back: a backend swap and any memory the agent changed become signed lineage updates.
  const changes: LineageChange[] = [];
  if (swap) changes.push({ layer: "backend", description: `runtime ${current} -> ${backend}`, probationDays: 7 });
  const diff = plan.memoryDir ? diffTrees(join(pkgDir, "memory"), plan.memoryDir) : undefined;
  const memoryChanged = !!diff && !isEmptyDiff(diff) && !v["no-write-back"];
  if (memoryChanged) {
    changes.push({ layer: "memory", description: `memory updated during a ${backend} run: +${diff!.added.length} ~${diff!.changed.length} -${diff!.removed.length} files` });
  }
  if (!changes.length) return 0;

  const signer = new Keystore(home).forDid(agent);
  if (!signer) {
    io.err(`no key for ${agent} in ${join(home, "keys")}: cannot sign the lineage update. The run's memory is in ${plan.memoryDir}.`);
    return 0;
  }
  const { edges } = updatePackage(pkgDir, { signer, changes, memoryFrom: memoryChanged ? plan.memoryDir : undefined });
  onMutate();
  for (const e of edges) io.err(`  recorded ${(e.body as any).change.description} (${e.id})`);
  io.err(`  package  ${pkgDir} re-signed`);
  await syncLocalLog(home, pkgDir, agent, io);
  return 0;
}

interface NodeResult {
  index: number;
  task: string;
  ok: boolean;
  runDir: string;
  memoryDir?: string;
  error?: string;
}

/**
 * Runs one task per node in parallel, each under its own signed, short-lived delegated key
 * (asp.node/v0.2; nodes only write memory, per the spec's Learning section), then consolidates
 * every node's memory changes into a single signed lineage update for the agent.
 */
async function orchestrate(home: string, pkg: string | undefined, v: Values, need: Need, io: Io): Promise<number> {
  if (!pkg) throw new UsageError("asp orchestrate <package> --backend <runtime> --task <text> [--task <text> ...]");
  const backend = need("backend");
  const adapter = ADAPTERS[backend];
  if (!adapter) throw new UsageError(`unknown backend ${backend}; available: ${Object.keys(ADAPTERS).join(", ")}`);
  const tasks = v.task ?? [];
  if (!tasks.length) throw new UsageError("--task is required at least once");
  const maxParallel = Math.max(1, Math.trunc(Number(v["max-parallel"] ?? 4)) || 1);

  const resolved = await resolvePackage(resolve(io.cwd, pkg));
  let mutated = false;
  try {
    return await orchestrateIn(resolved.dir);
  } finally {
    await finishPackage(resolved, mutated);
  }

  async function orchestrateIn(pkgDir: string): Promise<number> {
  const report = await verifyPackage(pkgDir);
  if (!report.ok) {
    io.err(`refusing to orchestrate: the package does not verify (${report.checks.filter((c) => c.status === "fail").map((c) => c.name).join(", ")}). Run asp verify for details.`);
    return 1;
  }
  const manifest = JSON.parse(readFileSync(join(pkgDir, "manifest.json"), "utf8")) as AspRecord;
  const harness = JSON.parse(readFileSync(join(pkgDir, "harness", "harness.json"), "utf8")) as Harness;
  const agent = report.agent!;
  const foundSigner = new Keystore(home).forDid(agent);
  if (!foundSigner) throw new Error(`no key for ${agent} in ${join(home, "keys")}`);
  const signer = foundSigner;
  const project = resolve(io.cwd, v.project ?? ".");
  const local = await LocalLog.open(home);
  const inLocalLog = !!(await local.log.passport(agent));
  const dryRun = v["dry-run"] ?? false;

  const batchTag = Date.now().toString(36);
  const batchDir = join(home, "runs", `${slug(agent)}-fleet-${batchTag}`);
  mkdirSync(batchDir, { recursive: true });
  io.err(`orchestrating ${tasks.length} task(s) for ${agent} on ${backend} (up to ${maxParallel} in parallel)`);
  io.err(`  batch    ${batchDir}`);

  const results: NodeResult[] = new Array(tasks.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= tasks.length) return;
      results[i] = await runNode(i);
    }
  }

  async function runNode(i: number): Promise<NodeResult> {
    const index = i + 1;
    const task = tasks[i];
    const runDir = join(batchDir, `node-${index}`);
    mkdirSync(runDir, { recursive: true });
    const plan = await adapter.materialize({
      pkgDir, harness, project, runDir, agentName: `${basename(agent.replace(/:/g, "/"))}-node${index}`,
      prompt: task, env: io.env, model: v.model, endpoint: v.endpoint, apiKeyEnv: v["api-key-env"], sourceRuntime: (manifest.body as any).source_runtime?.name,
    });
    io.err(`  node ${index}  ${task.length > 60 ? task.slice(0, 57) + "..." : task}`);
    io.err(`         command  ${[plan.command, ...plan.args].map(quote).join(" ")}`);
    if (dryRun) return { index, task, ok: true, runDir, memoryDir: plan.memoryDir };
    if (plan.missingSecrets.length) {
      const error = `missing secrets: ${plan.missingSecrets.join(", ")}`;
      io.err(`  node ${index}  FAILED  ${error}`);
      return { index, task, ok: false, runDir, error };
    }

    // A delegated, short-lived key for this node (spec/schemas/node.schema.json); no Mandate yet in
    // single-player mode, so it is bookkeeping and audit trail only (see MOCKS.md).
    const nodeSeed = randomSeed();
    const nodeKid = `${agent}#node-${batchTag}-${index}`;
    const nodeRecord = createRecord({
      type: "node", issuer: agent, subject: agent, prev: null, issued_at: now(),
      body: {
        node: nodeKid, public_key: b64urlEncode(publicKeyFromSeed(nodeSeed)),
        expires: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        purpose: task.slice(0, 200),
      },
    }, signer);
    if (inLocalLog) {
      try { await local.append(nodeRecord); } catch { /* best-effort: node bookkeeping only */ }
    }
    // A node whose task is abandoned shouldn't just sit there until its hour is up: chain an
    // immediate revocation onto its own grant the moment failure is known (the existing
    // revoke-by-chaining pattern: a second Node record with expires <= issued_at).
    async function revokeAbandonedNode(): Promise<void> {
      if (!inLocalLog) return;
      try {
        const revokedAt = now();
        const revoke = createRecord({
          type: "node", issuer: agent, subject: agent, prev: nodeRecord.id, issued_at: revokedAt,
          body: { node: nodeKid, public_key: b64urlEncode(publicKeyFromSeed(nodeSeed)), expires: revokedAt, purpose: task.slice(0, 200) },
        }, signer);
        await local.append(revoke);
      } catch { /* best-effort: node bookkeeping only */ }
    }

    const stdoutLog = join(runDir, "stdout.log");
    const stderrLog = join(runDir, "stderr.log");
    let hiddenFailure: string | undefined;
    const code = await new Promise<number>((done) => {
      const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: { ...io.env, ...plan.env }, stdio: ["ignore", "pipe", "pipe"] });
      let outCarry = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        appendFileEnsured(stdoutLog, chunk);
        if (!plan.checkOutputForFailure) return;
        outCarry += chunk.toString("utf8");
        const lines = outCarry.split("\n");
        outCarry = lines.pop() ?? "";
        for (const line of lines) hiddenFailure ??= plan.checkOutputForFailure!(line);
      });
      child.stderr!.on("data", (chunk: Buffer) => appendFileEnsured(stderrLog, chunk));
      child.on("error", (e: NodeJS.ErrnoException) => {
        io.err(`  node ${index}  FAILED  ${e.code === "ENOENT" ? `${plan.command} is not installed or not on PATH` : e.message}`);
        done(-1);
      });
      child.on("exit", (c) => done(c ?? 1));
    });
    if (code === -1) {
      await revokeAbandonedNode();
      return { index, task, ok: false, runDir, error: "could not start the runtime" };
    }
    if (code !== 0 || hiddenFailure) {
      const error = hiddenFailure ?? `exited with code ${code}`;
      io.err(`  node ${index}  FAILED  ${error} (log: ${stderrLog})`);
      await revokeAbandonedNode();
      return { index, task, ok: false, runDir, error };
    }
    io.err(`  node ${index}  ok`);
    return { index, task, ok: true, runDir, memoryDir: plan.memoryDir };
  }

  await Promise.all(Array.from({ length: Math.min(maxParallel, tasks.length) }, worker));
  const succeeded = results.filter((r) => r.ok && r.memoryDir);
  const failed = results.filter((r) => !r.ok);
  io.err(`  ${succeeded.length}/${tasks.length} node(s) succeeded${failed.length ? `; failed: ${failed.map((r) => r.index).join(", ")}` : ""}`);
  if (dryRun) return 0;
  if (!succeeded.length) {
    io.err("  no node completed successfully; nothing consolidated");
    return 1;
  }

  // Consolidation: every node's memory diff is merged into one tree. MEMORY.md entries are unioned
  // (deduplicated line by line); other files that differ between nodes are kept side by side rather
  // than one silently overwriting another's lesson (spec: "deduplicates lessons, resolves
  // contradictions... produces one update to the person").
  const baseMemDir = join(pkgDir, "memory");
  const mergedDir = join(batchDir, "memory");
  if (existsSync(baseMemDir)) cpFolder(baseMemDir, mergedDir);
  mkdirSync(join(mergedDir, "auto"), { recursive: true });
  const written = new Set<string>();
  const removalCandidates = new Set<string>();
  const conflictNotes: string[] = [];
  for (const r of succeeded) {
    const diff = diffTrees(baseMemDir, r.memoryDir!);
    for (const rel of diff.removed) removalCandidates.add(rel);
    for (const rel of [...diff.added, ...diff.changed]) {
      const src = join(r.memoryDir!, rel);
      const dest = join(mergedDir, rel);
      if (basename(rel) === "MEMORY.md") {
        mergeLineUnion(existsSync(dest) ? dest : join(baseMemDir, rel), src, dest);
      } else if (!existsSync(dest)) {
        copyFileEnsured(src, dest);
      } else if (readFileSync(dest, "utf8") !== readFileSync(src, "utf8")) {
        const alt = withNodeSuffix(dest, r.index);
        copyFileEnsured(src, alt);
        conflictNotes.push(`node ${r.index}'s ${rel} differs from an earlier node's; kept separately as ${relative(mergedDir, alt)}`);
      } // else identical: already merged, nothing to do
      written.add(rel);
    }
  }
  for (const rel of removalCandidates) if (!written.has(rel)) { const p = join(mergedDir, rel); if (existsSync(p)) rmSync(p); }
  for (const n of conflictNotes) io.err(`  note     ${n}`);

  const overall = diffTrees(baseMemDir, mergedDir);
  if (isEmptyDiff(overall)) {
    io.err("  no memory changes across nodes; nothing consolidated");
    return 0;
  }
  const changes: LineageChange[] = [{
    layer: "memory",
    description: `consolidated fleet memory from ${succeeded.length}/${tasks.length} node(s): +${overall.added.length} ~${overall.changed.length} -${overall.removed.length} files`,
  }];
  const { edges } = updatePackage(pkgDir, { signer, changes, memoryFrom: mergedDir });
  mutated = true;
  for (const e of edges) io.err(`  recorded ${(e.body as any).change.description} (${e.id})`);
  io.err(`  package  ${pkgDir} re-signed`);
  await syncLocalLog(home, pkgDir, agent, io);
  return 0;
  }
}

function appendFileEnsured(path: string, chunk: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, chunk, { flag: "a" });
}

function copyFileEnsured(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

function cpFolder(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

/** Inserts .node<N> before the last extension: foo/bar.md, 2 -> foo/bar.node2.md. */
function withNodeSuffix(path: string, index: number): string {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return dot > slash ? `${path.slice(0, dot)}.node${index}${path.slice(dot)}` : `${path}.node${index}`;
}

/**
 * Merges a memory index file by the union of its lines: every line already at `dest` (or, failing
 * that, the original `base`) is kept, and every non-blank line from `incoming` not already present
 * (by exact trimmed match) is appended. Never drops an existing entry.
 */
function mergeLineUnion(base: string, incoming: string, dest: string): void {
  const startFrom = existsSync(dest) ? dest : base;
  const destLines = existsSync(startFrom) ? readFileSync(startFrom, "utf8").split("\n") : [];
  const seen = new Set(destLines.map((l) => l.trim()).filter(Boolean));
  for (const line of readFileSync(incoming, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || seen.has(t)) continue;
    destLines.push(line);
    seen.add(t);
  }
  while (destLines.length && destLines.at(-1) === "") destLines.pop();
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, destLines.join("\n") + "\n");
}

/**
 * Brings the local log up to date with the package's history (it may have gained records elsewhere),
 * when the local log knows this agent. Every record is verified on append; a conflict is reported, not fatal.
 */
async function syncLocalLog(home: string, pkgDir: string, agent: string, io: Io): Promise<void> {
  const local = await LocalLog.open(home);
  if (!(await local.log.passport(agent))) return;
  const history = readFileSync(join(pkgDir, "records", "history.ndjson"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AspRecord);
  let added = 0;
  for (const r of history) {
    if (await local.log.get(r.id)) continue;
    try {
      await local.append(r);
      added++;
    } catch (e) {
      io.err(`  warning  the local log's history for ${agent} diverges from the package's: ${(e as Error).message}`);
      return;
    }
  }
  if (added) io.err(`  log      ${added} record(s) added to the local log`);
}

/** The runtime the agent last moved to (the latest backend lineage edge), or the one it was packed from. */
function currentRuntime(pkgDir: string, manifest: AspRecord): string {
  const history = readFileSync(join(pkgDir, "records", "history.ndjson"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AspRecord);
  const agent = (manifest.body as any).agent;
  const moves = history.filter((r) => r.type === "asp.lineage/v0.2" && (r.body as any).child === agent && (r.body as any).change?.layer === "backend");
  const last = moves.at(-1);
  const to = last && /-> (\S+)$/.exec((last.body as any).change.description)?.[1];
  return to ?? (manifest.body as any).source_runtime?.name;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (isMain) {
  const code = await main(process.argv.slice(2), {
    out: (l) => process.stdout.write(l + "\n"),
    err: (l) => process.stderr.write(l + "\n"),
    env: process.env,
    cwd: process.cwd(),
  });
  process.exitCode = code;
}
