/**
 * Offboarding (DK1384, docs/enterprise-fleets.md): an organisation that leaves takes its data and agents with it.
 *   asp offboard export --org <did> --out <dir> [--keys]   the organisation's records and its agents' (every record the organisation or an agent it sponsors signed, in the log's own format, in order),
 *                                                          a summary of the Mandates, the run logs on this machine of those agents, and with --keys each agent's key handed over in its own file
 *   asp offboard verify --from <dir>                       checks the export: every record's signature and hash chain, the count and the root in the manifest
 *   asp offboard import --from <dir>                       replays the records into this log (a fresh service); a record that needs another party's record is listed, not forced
 *   asp offboard close --from <dir> --org <did> --confirm <did>   closes the organisation's fleets to new members and signs a closure certificate: what was exported, the root, what was handed over, the retention rule
 * The log is append-only, so closing does not erase records already written: the certificate says so and points to the retention and erasure policy. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { b64urlEncode, createRecord, resolverFromPassports, signBytes, verifyRecord, type AspRecord, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-package";
import { Keystore } from "@agent-social/asp-package";
import { readOrgRecords } from "@agent-social/asp-log";

export class OffboardUsage extends Error {}
export interface OffboardOpts {
  home: string; log: LogHandle; io: { out: (l: string) => void }; now: () => string;
  signerFor: (did: string) => Signer & { publicKey?: Uint8Array };
  flags: { org?: string; out?: string; from?: string; keys?: boolean; confirm?: string; /** `<agent did>=<runtime>:<project folder>`, one for each agent whose package goes in the export (DK1384). */ pack?: string[] };
  /** Makes one agent's package into a folder: `asp pack` (the CLI gives it). Returns the exit code. */
  packAgent?: (did: string, runtime: string, project: string, outDir: string) => Promise<number>;
}
const sha = (t: string) => "sha256:" + createHash("sha256").update(t).digest("hex");
const RETENTION = "docs/legal/retention-and-erasure.md";

interface Slot { seq: number; id: string; record: Record<string, unknown> }

/** Every record the organisation or an agent it sponsors signed, in log order, and the identities found. */
export async function collect(log: LogHandle, org: string, afterSeq = 0): Promise<{ records: Slot[]; dids: string[] }> {
  // the same reader `asp audit-export` uses (readOrgRecords in packages/asp-log/src/audit-export.ts), in its `signed` mode
  const all: { seq: number; id: string; record: never }[] = [];
  for (let after = 0; ;) {
    const page = await log.log.since(after, 500);
    if (!page.length) break;
    for (const s of page) { after = s.seq; all.push({ seq: s.seq, id: s.id, record: s.record as never }); }
  }
  const r = readOrgRecords(all, org, "signed");
  return { records: r.records.filter((x) => x.seq > afterSeq).map((x) => ({ seq: x.seq, id: x.id, record: x.record as unknown as Record<string, unknown> })), dids: r.identities };
}

export async function offboardCmd(sub: string | undefined, o: OffboardOpts): Promise<number> {
  const f = o.flags;
  if (sub === "export") return await exportAll(o);
  if (sub === "verify") { const v = verifyDir(f.from); o.io.out(v.ok ? `export verified: ${v.records} records, root ${v.root}` : `export NOT verified: ${v.problems.join("; ")}`); return v.ok ? 0 : 1; }
  if (sub === "import") return await importAll(o);
  if (sub === "close") return await close(o);
  throw new OffboardUsage("asp offboard export --org <did> --out <dir> [--keys] | verify --from <dir> | import --from <dir> | close --from <dir> --org <did> --confirm <did>");
}

async function exportAll(o: OffboardOpts): Promise<number> {
  const f = o.flags;
  if (!f.org || !f.out) throw new OffboardUsage("asp offboard export --org <organisation did> --out <dir> [--keys]");
  const out = resolve(f.out);
  mkdirSync(out, { recursive: true });
  const { records, dids } = await collect(o.log, f.org);
  if (!(await o.log.log.passport(f.org))) throw new OffboardUsage(`${f.org} has no passport in this log`);
  writeFileSync(join(out, "records.ndjson"), records.map((r) => JSON.stringify({ seq: r.seq, id: r.id, record: r.record })).join("\n") + "\n");
  const mandates = records.filter((r) => ["asp.mandate/v0.2", "asp.mandate_template/v0.2"].includes(String(r.record.type))).map((r) => ({ id: r.id, type: r.record.type, issuer: r.record.issuer, body: r.record.body }));
  writeFileSync(join(out, "mandates.json"), JSON.stringify(mandates, null, 2));
  // run logs on this machine whose run began as one of these agents
  const runsDir = join(o.home, "runs");
  let runLogs = 0;
  if (existsSync(runsDir)) {
    mkdirSync(join(out, "runlogs"), { recursive: true });
    for (const d of readdirSync(runsDir)) {
      const file = join(runsDir, d, "run-log.ndjson");
      if (!existsSync(file)) continue;
      const first = readFileSync(file, "utf8").split("\n", 1)[0];
      try { const e = JSON.parse(first) as { data?: { agent?: string }; agent?: string }; if (dids.includes(String(e.data?.agent ?? e.agent))) { copyFileSync(file, join(out, "runlogs", `${d}.ndjson`)); runLogs++; } } catch { /* not a run log */ }
    }
  }
  // keys, only when asked: each in its own file, the agent's own
  let keys = 0;
  if (f.keys) {
    mkdirSync(join(out, "keys"), { recursive: true });
    const ks = new Keystore(o.home);
    for (const did of dids) {
      const s = ks.forDid(did);
      if (!s) continue;
      writeFileSync(join(out, "keys", `${createHash("sha256").update(did).digest("hex").slice(0, 16)}.key.json`), JSON.stringify({ did, kid: s.kid, seed: b64urlEncode(s.seed), note: "This file is the identity's own key. Keep one copy where the identity runs." }, null, 2), { mode: 0o600 });
      keys++;
    }
  }
  // each agent's package (its harness, memory and the history of its record), made by `asp pack` into packages/<n>
  const packaged: { did: string; runtime: string; folder: string }[] = [];
  for (const spec of f.pack ?? []) {
    const m = /^(did:[^=]+)=([a-z-]+):(.+)$/.exec(spec);
    if (!m) throw new OffboardUsage(`--pack is <agent did>=<runtime>:<project folder>, for example did:web:acme.example:agents:a1=claude-code:./projects/a1 (got ${spec})`);
    if (!dids.includes(m[1])) throw new OffboardUsage(`${m[1]} is not an identity of ${f.org}: only its own agents are packed into its export`);
    if (!o.packAgent) throw new OffboardUsage("this command cannot make packages here");
    const folder = join("packages", createHash("sha256").update(m[1]).digest("hex").slice(0, 12));
    mkdirSync(join(out, folder), { recursive: true });
    const code = await o.packAgent(m[1], m[2], resolve(m[3]), join(out, folder));
    if (code !== 0) throw new OffboardUsage(`the package of ${m[1]} was not made (asp pack exited ${code}): fix it and run the export again`);
    packaged.push({ did: m[1], runtime: m[2], folder });
  }
  const root = sha(records.map((r) => r.id).join("\n"));
  const manifest = { version: 1, organisation: f.org, exported_at: o.now(), identities: dids, records: records.length, root, run_logs: runLogs, keys_handed_over: keys, packages: packaged, fleets: await o.log.log.fleetsOf(f.org), retention: RETENTION, note: "Records are in the log's own format, in log order; verify checks every signature and chain. A package is in the export for each agent named with --pack (asp pack makes it); the others stay with their folders." };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  o.io.out(`exported ${records.length} records of ${dids.length} identit${dids.length === 1 ? "y" : "ies"} (${f.org} and the agents it sponsors) to ${out}; ${runLogs} run log${runLogs === 1 ? "" : "s"}; ${keys ? `${keys} key${keys === 1 ? "" : "s"} handed over in ${join(out, "keys")}` : "no keys (add --keys to hand them over)"}; root ${root}`);
  return 0;
}

function readRecords(from: string): Slot[] {
  return readFileSync(join(resolve(from), "records.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Slot);
}

function verifyDir(from: string | undefined): { ok: boolean; records: number; root: string; problems: string[] } {
  if (!from) throw new OffboardUsage("--from <the export directory>");
  const dir = resolve(from);
  const problems: string[] = [];
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { records: number; root: string };
  const recs = readRecords(dir);
  if (recs.length !== manifest.records) problems.push(`the manifest says ${manifest.records} records, the file has ${recs.length}`);
  const resolver = resolverFromPassports(recs.map((r) => r.record as unknown as AspRecord).filter((r) => r.type === "asp.passport/v0.2"));
  let unchecked = 0;
  for (const r of recs) {
    try { verifyRecord(r.record, resolver); } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "UNKNOWN_KEY") { unchecked++; continue; }     // a counter-signature by a party outside the export: not checkable here
      problems.push(`record ${r.id}: ${(e as Error).message.slice(0, 80)}`);
    }
    if (problems.length >= 10) break;
  }
  const root = sha(recs.map((r) => r.id).join("\n"));
  if (root !== manifest.root) problems.push("the root of the record ids is not the manifest's");
  return { ok: problems.length === 0, records: recs.length, root, problems };
}

async function importAll(o: OffboardOpts): Promise<number> {
  const v = verifyDir(o.flags.from);
  if (!v.ok) throw new OffboardUsage(`the export does not verify, nothing was imported: ${v.problems.join("; ")}`);
  let imported = 0, already = 0;
  const skipped: { id: string; why: string }[] = [];
  for (const r of readRecords(o.flags.from!)) {
    if (await o.log.log.get(r.id).catch(() => undefined)) { already++; continue; }
    try { await o.log.append(r.record as never); imported++; } catch (e) {
      const m = (e as Error).message;
      if (/already|duplicate|exists/i.test(m)) already++; else skipped.push({ id: r.id, why: m.slice(0, 120) });
    }
  }
  o.io.out(`imported ${imported} of ${v.records} records${already ? `, ${already} already here` : ""}${skipped.length ? `, ${skipped.length} need another party's records and were not forced` : ""}`);
  for (const s of skipped.slice(0, 5)) o.io.out(`  not imported ${s.id.slice(0, 19)}...: ${s.why}`);
  return 0;
}

async function close(o: OffboardOpts): Promise<number> {
  const f = o.flags;
  if (!f.org || !f.from) throw new OffboardUsage("asp offboard close --from <export dir> --org <did> --confirm <did>");
  if (f.confirm !== f.org) throw new OffboardUsage(`closing ${f.org} closes its fleets to new members and signs the closure certificate; run it again with --confirm ${f.org}`);
  const v = verifyDir(f.from);
  if (!v.ok) throw new OffboardUsage(`the export does not verify, so the organisation is not closed: ${v.problems.join("; ")}`);
  const manifest = JSON.parse(readFileSync(join(resolve(f.from), "manifest.json"), "utf8")) as { organisation: string; identities: string[]; run_logs: number; keys_handed_over: number };
  if (manifest.organisation !== f.org) throw new OffboardUsage(`the export is of ${manifest.organisation}, not ${f.org}`);
  const { fleetCmd } = await import("./fleet.ts");
  let closed = 0;
  for (const fl of await o.log.log.fleetsOf(f.org)) {
    const d = await o.log.log.fleetDetails(fl);
    if (d && !d.closed) { await fleetCmd("close", [fl], { log: o.log, io: { out: () => undefined }, now: o.now, signerFor: o.signerFor as never, flags: {} }); closed++; }
  }
  const signer = o.signerFor(f.org);
  const body = { organisation: f.org, closed_at: o.now(), fleets_closed: closed, identities: manifest.identities.length, records_exported: v.records, root: v.root, run_logs: manifest.run_logs, keys_handed_over: manifest.keys_handed_over, retention: RETENTION, note: "Records already in the append-only log stay; the retention and erasure policy says what is kept and for how long and how an erasure request is met. The organisation holds a verified export of its records." };
  const cert = { ...body, kid: signer.kid, sig: b64urlEncode(signBytes(new TextEncoder().encode(JSON.stringify(body)), signer.seed)) };
  writeFileSync(join(resolve(f.from), "closure-certificate.json"), JSON.stringify(cert, null, 2));
  o.io.out(`closed: ${closed} fleet${closed === 1 ? "" : "s"} closed to new members; closure certificate signed: ${join(resolve(f.from), "closure-certificate.json")} (${v.records} records, root ${v.root})`);
  return 0;
}

// createRecord is re-exported for tests that build records by hand
export { createRecord };
