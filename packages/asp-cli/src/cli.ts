#!/usr/bin/env node
/**
 * asp: the Agent Social portability tool.
 *
 *   asp identity new --kind human --did <did>
 *   asp identity new --kind agent --did <did> --sponsor <did> [--fleet <did>] [--purpose <text>]
 *   asp identity show <did>
 *   asp pack --runtime claude-code --agent <did> [--project <dir>] [--include-user] [--out <dir>]
 *   asp verify <package> [--json]
 *   asp run <package> --backend claude-code [--project <dir>] [--prompt <text>] [--dry-run] [--no-write-back]
 *     After a successful run, a backend swap and any memory the agent changed are recorded in the
 *     package as signed lineage updates, and the manifest is re-signed.
 *   asp log verify
 *
 * Global: --home <dir> (default $ASP_HOME or ~/.asp), --claude-home <dir> (where .claude lives; default ~).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { b64urlEncode, createRecord, type AspRecord } from "@agent-social/asp-core";
import {
  ADAPTERS, Keystore, LocalLog, aspHome, diffTrees, isEmptyDiff, scanForSecrets, updatePackage, verifyPackage, writePackage,
  type Harness, type LineageChange,
} from "@agent-social/asp-package";
import { readFileSync } from "node:fs";

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
    if (cmd === "log" && sub === "verify") {
      const local = await LocalLog.open(home);
      const report = await local.log.verify();
      io.out(report.ok ? `log ok: ${report.records} records, head ${report.head.logHash}` : `log FAILED at seq ${report.error!.seq}: ${report.error!.message}`);
      return report.ok ? 0 : 1;
    }
    throw new UsageError(`unknown command: ${[cmd, sub].filter(Boolean).join(" ")}`);
  } catch (e) {
    io.err(e instanceof UsageError ? `usage: ${e.message}` : `error: ${(e as Error).message}`);
    return e instanceof UsageError ? 2 : 1;
  }
}

type Values = { [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K]["type"] extends "boolean" ? boolean : string };
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
    const capture = await adapter.capture({ project, includeUser: v["include-user"] ?? false, home: v["claude-home"], staging });
    const findings = [...scanForSecrets(join(staging, "harness"), "harness/"), ...scanForSecrets(join(staging, "memory"), "memory/")];
    if (findings.length) {
      io.err("refusing to pack: these captured files look like they contain secrets (values not shown):");
      for (const f of findings) io.err(`  ${f.file}:${f.line}  ${f.kind}`);
      io.err("remove them or move them into environment variables, then pack again.");
      return 1;
    }
    const out = resolve(io.cwd, v.out ?? `${slug(agent)}-${now().slice(0, 10)}.aspkg`);
    const manifest = writePackage({ out, capture, agent, signer, history: await historyFor(log.log, agent) });
    const h: Harness = capture.harness;
    io.out(`packed ${agent} from ${runtime} (${project})`);
    io.out(`  package      ${out}`);
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
  const report = await verifyPackage(resolve(io.cwd, pkg));
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
  const pkgDir = resolve(io.cwd, pkg);
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

  const code = await new Promise<number>((done) => {
    const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: { ...io.env, ...plan.env }, stdio: "inherit" });
    child.on("error", (e: NodeJS.ErrnoException) => {
      io.err(e.code === "ENOENT"
        ? `${plan.command} is not installed or not on PATH. Install it, or rerun with --dry-run.`
        : `could not start ${plan.command}: ${e.message}`);
      done(-1);
    });
    child.on("exit", (c) => done(c ?? 1));
  });
  if (code === -1) return 1;
  if (code !== 0) {
    io.err(`${backend} exited with code ${code}; nothing written back. The run's memory is in ${plan.memoryDir ?? runDir}.`);
    return code;
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
  for (const e of edges) io.err(`  recorded ${(e.body as any).change.description} (${e.id})`);
  io.err(`  package  ${pkgDir} re-signed`);
  await syncLocalLog(home, pkgDir, agent, io);
  return 0;
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
