#!/usr/bin/env node
/**
 * asp: the Agent Social portability tool.
 *
 *   asp identity new --kind human --did <did>
 *   asp identity new --kind agent --did <did> --sponsor <did> [--fleet <did>] [--purpose <text>]
 *   asp identity show <did>
 *   asp pack --runtime claude-code|codex|openhands --agent <did> [--project <dir>] [--include-user] [--out <dir>]
 *   asp verify <package> [--json]
 *   asp run <package> --backend claude-code|codex|openhands [--project <dir>] [--prompt <text>] [--model <m>] [--dry-run] [--no-write-back]
 *     After a successful run, a backend swap and any memory the agent changed are recorded in the
 *     package as signed lineage updates, and the manifest is re-signed.
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
 * Global: --home <dir> (default $ASP_HOME or ~/.asp), --user-home <dir> (the home dir holding .claude/.codex; default ~).
 */
import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { b64urlDecode, b64urlEncode, createRecord, didOf, publicKeyFromSeed, randomSeed, type AspRecord } from "@agent-social/asp-core";
import {
  ADAPTERS, Keystore, LocalLog, appendCheckpoint, aspHome, diffTrees, finishPackage, isEmptyDiff, packDirectory,
  readCheckpoints, resolvePackage, scanForSecrets, signCheckpoint, updatePackage, verifyCheckpointSignature,
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
  kind: { type: "string" },
  did: { type: "string" },
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
    throw new UsageError(`unknown command: ${[cmd, sub].filter(Boolean).join(" ")}`);
  } catch (e) {
    io.err(e instanceof UsageError ? `usage: ${e.message}` : `error: ${(e as Error).message}`);
    return e instanceof UsageError ? 2 : 1;
  }
}

type Values = {
  [K in keyof typeof OPTIONS]?: K extends "task" ? string[] : (typeof OPTIONS)[K]["type"] extends "boolean" ? boolean : string;
};
type Need = (name: keyof typeof OPTIONS) => string;

async function identityNew(home: string, v: Values, need: Need, io: Io): Promise<number> {
  const kind = need("kind");
  const did = need("did");
  const keys = new Keystore(home);
  const log = await LocalLog.open(home);
  if (await log.log.passport(did)) throw new Error(`${did} already has a passport`);
  if (kind !== "human" && kind !== "agent") throw new UsageError("--kind is human or agent");

  let issuerSigner;
  let body: Record<string, unknown>;
  const kid = `${did}#key-1`;
  if (kind === "human") {
    const signer = keys.find(kid) ?? keys.create(kid);
    issuerSigner = signer;
    body = { did, kind, keys: [{ id: kid, type: "Ed25519", public_key: b64urlEncode(signer.publicKey) }] };
  } else {
    const sponsor = need("sponsor");
    issuerSigner = keys.forDid(sponsor);
    if (!issuerSigner) throw new Error(`no key for sponsor ${sponsor} in ${home}; create it with: asp identity new --kind human --did ${sponsor}`);
    const signer = keys.find(kid) ?? keys.create(kid);
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
  io.out(JSON.stringify({ passport: p.head, sponsor: p.sponsor, fleet: p.fleet, body: rec.body, keys: await log.keys(did) }, null, 2));
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

/** The signed records a package needs: the agent's passports, its sponsors' passports, its fleet, its lineage. */
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
    const manifest = writePackage({ out: writeDir, capture, agent, signer, history: await historyFor(log.log, agent) });
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
  mkdirSync(runDir, { recursive: true });
  const plan = await adapter.materialize({
    pkgDir, harness, project: resolve(io.cwd, v.project ?? "."), runDir, agentName: basename(agent.replace(/:/g, "/")), prompt: v.prompt, env: io.env,
    model: v.model, sourceRuntime: (manifest.body as any).source_runtime?.name,
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
  // line by line while still being forwarded, instead of simply inherited.
  let hiddenFailure: string | undefined;
  const code = await new Promise<number>((done) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd, env: { ...io.env, ...plan.env },
      stdio: plan.checkOutputForFailure ? ["inherit", "pipe", "inherit"] : "inherit",
    });
    if (plan.checkOutputForFailure) {
      let carry = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
        carry += chunk.toString("utf8");
        const lines = carry.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) hiddenFailure ??= plan.checkOutputForFailure!(line);
      });
    }
    child.on("error", (e: NodeJS.ErrnoException) => {
      io.err(e.code === "ENOENT"
        ? `${plan.command} is not installed or not on PATH. Install it, or rerun with --dry-run.`
        : `could not start ${plan.command}: ${e.message}`);
      done(-1);
    });
    child.on("exit", (c) => done(c ?? 1));
  });
  if (code === -1) return 1;
  if (code !== 0 || hiddenFailure) {
    if (hiddenFailure) io.err(`${backend} reported a failure it did not exit with: ${hiddenFailure}`);
    io.err(`${backend} ${hiddenFailure ? "failed" : `exited with code ${code}`}; nothing written back. The run's memory is in ${plan.memoryDir ?? runDir}.`);
    return hiddenFailure ? 1 : code;
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
      prompt: task, env: io.env, model: v.model, sourceRuntime: (manifest.body as any).source_runtime?.name,
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
    if (code === -1) return { index, task, ok: false, runDir, error: "could not start the runtime" };
    if (code !== 0 || hiddenFailure) {
      const error = hiddenFailure ?? `exited with code ${code}`;
      io.err(`  node ${index}  FAILED  ${error} (log: ${stderrLog})`);
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
