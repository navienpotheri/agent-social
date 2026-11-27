/**
 * The fleet load test (register row DK1362; spec-delta S1418): what it costs the log to carry a fleet of N agents (default 10,000) under one verified organisation. It measures, on this machine and through the real
 * EventLog with the in-memory store: the time to bring N agents in, the time for N x K signed acts, writes a second, bytes a record, process memory, and from those the cost per million writes and per gigabyte stored.
 * It does NOT measure the Postgres backend (no database is attached here) and it runs on whatever machine runs it, so the figures are for that machine: the log file says which. Fake keys only.
 *
 *   node evals/load-fleet.ts [--agents 10000] [--acts 2] [--out docs/load-test-results-fleet.json]
 */
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import { createRecord, b64urlEncode, signerFromSeed } from "../packages/asp-core/src/index.ts";
import { EventLog, MemoryStore } from "../packages/asp-log/src/index.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg("agents", "10000")), K = Number(arg("acts", "2"));
const party = (did: string) => ({ did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(createHash("sha256").update(did).digest())) });
const keysOf = (p: ReturnType<typeof party>) => [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }];
const operator = party("did:web:asp.local:operator"), owner = party("did:web:asp.local:owner");
let tick = Date.parse("2026-11-01T00:00:00Z");
const at = () => new Date((tick += 1000)).toISOString().replace(".000Z", "Z");

const keys: Record<string, Uint8Array> = { [operator.kid]: operator.publicKey, [owner.kid]: owner.publicKey };
const log = new EventLog(new MemoryStore(), { operator: operator.did, owner: owner.did, fallbackResolver: (kid: string) => keys[kid], now: () => new Date(tick) });
const org = party("did:web:example.com:orgs:load-co");
keys[org.kid] = org.publicKey;
const FLEET = `${org.did}:fleets:all`;
const t0 = Date.now();
const mark = (label: string, since: number, n: number, bytes: number) => ({ label, ms: Date.now() - since, writes: n, perSecond: Math.round((n * 1000) / Math.max(1, Date.now() - since)), msPerWrite: +((Date.now() - since) / Math.max(1, n)).toFixed(2), bytesPerRecord: Math.round(bytes / Math.max(1, n)) });
const size = (r: unknown) => JSON.stringify(r).length;

const phases = [];
let bytes = 0, n = 0;
let s = Date.now();
// the operator countersigns the organisation's passport, so it is verified and not slowed by the daily limit
await log.append((await import("../packages/asp-core/src/index.ts")).cosign(createRecord({ type: "passport", issuer: org.did, subject: org.did, prev: null, issued_at: at(), body: { did: org.did, kind: "org", keys: keysOf(org), purpose: "load test" } }, org), operator));
await log.append(createRecord({ type: "fleet", issuer: org.did, subject: FLEET, prev: null, issued_at: at(), body: { did: FLEET, org: org.did, name: "Load", purpose: "load test" } }, org));

const agents = [] as ReturnType<typeof party>[];
s = Date.now(); bytes = 0; n = 0;
for (let i = 0; i < N; i++) {
  const a = party(`did:web:example.com:agents:load-${i}`);
  agents.push(a); keys[a.kid] = a.publicKey;
  const r = createRecord({ type: "passport", issuer: org.did, subject: a.did, prev: null, issued_at: at(), body: { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet: FLEET } }, org);
  await log.append(r); bytes += size(r); n++;
}
phases.push(mark(`bring in ${N} agents (a passport each)`, s, n, bytes));
const actCost: Record<string, number> = {};
for (let k = 1; k <= K; k++) {
  s = Date.now(); bytes = 0; n = 0;
  for (const a of agents) {
    const r = createRecord({ type: "intent", issuer: a.did, subject: a.did, prev: null, issued_at: at(), body: { purpose: `act ${k}`, acceptance_criteria: ["done"], budget: { value: 20, unit: "credit" }, deadline: "2027-06-01T00:00:00Z", verification: { mode: "principal" } } }, a);
    await log.append(r); bytes += size(r); n++;
  }
  const m = mark(`act round ${k}: one signed write by each of ${N} agents`, s, n, bytes);
  phases.push(m); actCost[`round${k}`] = m.msPerWrite;
}
const writes = phases.reduce((x, p) => x + p.writes, 0), ms = phases.reduce((x, p) => x + p.ms, 0);
const msPerWrite = ms / writes;
const bytesPerRecord = phases.reduce((x, p) => x + p.bytesPerRecord * p.writes, 0) / writes;
const cap = Math.round(1000 / msPerWrite);
const rate = (perAgentMin: number) => { const need = (N * perAgentMin) / 60; return { actsPerAgentPerMinute: perAgentMin, writesPerSecondNeeded: +need.toFixed(1), shareOfOneProcess: +(need / cap).toFixed(3) }; };
const out = {
  when: new Date().toISOString(), machine: { cpus: os.cpus().length, model: os.cpus()[0]?.model, node: process.version, platform: process.platform, loadavg: os.loadavg(), note: "measured on a shared, loaded development machine; the in-memory store, a single process; not the Postgres backend" },
  agents: N, actsPerAgent: K, phases, totals: { writes, seconds: +(ms / 1000).toFixed(1), msPerWrite: +msPerWrite.toFixed(2), writesPerSecondOneProcess: cap, bytesPerRecord: Math.round(bytesPerRecord) },
  rates: { oneActAMinute: rate(1), oneActEveryTenMinutes: rate(0.1) },
  cost: { cpuSecondsPerMillionWrites: Math.round(msPerWrite * 1000), gigabytesPerMillionRecords: +((bytesPerRecord * 1_000_000) / 1e9).toFixed(2), note: "log record bytes only (JSON length); the database adds its own indexes and overhead, not measured here" },
  rssMB: Math.round(process.memoryUsage().rss / 1e6), totalSeconds: +((Date.now() - t0) / 1000).toFixed(1),
};
const file = arg("out", "");
if (file) writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
