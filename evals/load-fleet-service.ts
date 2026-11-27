/**
 * The fleet load test THROUGH THE SERVICE (register rows DK1362 and O6): the same fleet as evals/load-fleet.ts (N agents under one verified organisation, a passport each, then signed acts), but driven over HTTP
 * against a real `asp serve` process on this machine with the file log, through the batch route (500 records a request) and the per-record read routes. It measures what the service does, not only the log:
 * the time to bring N agents in, N acts, a member's read, the fleet read of all N members and the tree, and the size on disk. It does NOT measure the Postgres backend (no database is attached to this machine)
 * and the figures are for the machine that runs it. Fake keys only; every credential is a throwaway.
 *
 *   node evals/load-fleet-service.ts [--agents 10000] [--acts 1] [--out docs/load-test-results-fleet-service.json]
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cosign, createRecord, b64urlEncode, signerFromSeed } from "../packages/asp-core/src/index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "..");
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg("agents", "10000")), K = Number(arg("acts", "1"));
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const party = (did: string) => ({ did, ...signerFromSeed(`${did}#key-1`, new Uint8Array(createHash("sha256").update(did).digest())) });
const keysOf = (p: ReturnType<typeof party>) => [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }];
const operator = party("did:web:asp.local:operator");
const org = party("did:web:example.com:orgs:load-co");
const FLEET = `${org.did}:fleets:all`;
let tick = Date.parse("2026-11-01T00:00:00Z");
const at = () => new Date((tick += 1000)).toISOString().replace(".000Z", "Z");
const free = () => new Promise<number>((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dirBytes = (p: string): number => { let n = 0; try { const st = statSync(p); if (st.isFile()) return st.size; for (const f of readdirSync(p)) n += dirBytes(join(p, f)); } catch { /* gone */ } return n; };

const dir = mkdtempSync(join(os.tmpdir(), "asp-fleet-svc-"));
const TOKEN = "load-fleet-token";
const tokensFile = join(dir, "tokens.json");
writeFileSync(tokensFile, JSON.stringify([{ name: "load-co", role: "tenant", tokenSha256: sha(TOKEN) }]));
const port = await free();
const db = `local:${join(dir, "log")}`;
const child = spawn(process.execPath, [join(root, "packages/asp-cli/bin/asp.mjs"), "serve", "--db", db, "--tokens", tokensFile, "--port", String(port), "--address-limit", "0", "--rate-limit", "0", "--write-limit", "0", "--record-quota", "0", "--byte-quota-mb", "0"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ASP_OPERATOR_DID: operator.did } });
let out = "";
child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
const url = `http://127.0.0.1:${port}`;
let up = false;
for (let i = 0; i < 150 && !up; i++) { try { up = (await fetch(`${url}/health`)).ok; } catch { /* not yet */ } if (!up) await sleep(100); }
if (!up) { child.kill(); throw new Error(`the service did not start: ${out.slice(-400)}`); }

const headers = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
async function batch(records: unknown[]): Promise<{ ms: number; accepted: number; refused: number; first?: string }> {
  const t = performance.now();
  const r = await fetch(`${url}/append-batch`, { method: "POST", headers, body: JSON.stringify({ records }) });
  const body = (await r.json()) as { ok?: boolean; result?: { accepted: number; refused: number; results: { ok: boolean; error?: { code: string; message?: string } }[] }; error?: { code: string; message?: string } };
  const res = body.result;
  const firstBad = res?.results.find((x) => !x.ok)?.error;
  return { ms: performance.now() - t, accepted: res?.accepted ?? 0, refused: res?.refused ?? records.length, ...(firstBad || body.error ? { first: JSON.stringify(firstBad ?? body.error).slice(0, 200) } : {}) };
}
async function rpc(target: string, method: string, args: unknown[]) {
  const t = performance.now();
  const r = await fetch(`${url}/rpc`, { method: "POST", headers, body: JSON.stringify({ target, method, args }) });
  const body = (await r.json()) as { ok?: boolean; result?: unknown };
  return { ms: performance.now() - t, status: r.status, ok: r.status === 200 && body.ok !== false, result: body.result };
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 10) / 10 : null; };

const t0 = Date.now();
const phases: { label: string; seconds: number; writes: number; perSecond: number; batchMsP50: number | null; batchMsP95: number | null; refused: number; firstRefusal?: string }[] = [];
async function writePhase(label: string, records: unknown[]) {
  const s = Date.now(), ms: number[] = [];
  let refused = 0, firstRefusal: string | undefined;
  for (let i = 0; i < records.length; i += 500) {
    const r = await batch(records.slice(i, i + 500));
    ms.push(r.ms); refused += r.refused; if (r.first && !firstRefusal) firstRefusal = r.first;
  }
  const seconds = (Date.now() - s) / 1000;
  phases.push({ label, seconds: +seconds.toFixed(1), writes: records.length - refused, perSecond: Math.round((records.length - refused) / Math.max(0.001, seconds)), batchMsP50: pct(ms, 50), batchMsP95: pct(ms, 95), refused, ...(firstRefusal ? { firstRefusal } : {}) });
}

const orgPassport = cosign(createRecord({ type: "passport", issuer: org.did, subject: org.did, prev: null, issued_at: at(), body: { did: org.did, kind: "org", keys: keysOf(org), purpose: "load test" } }, org), operator);
const fleetRec = createRecord({ type: "fleet", issuer: org.did, subject: FLEET, prev: null, issued_at: at(), body: { did: FLEET, org: org.did, name: "Load", purpose: "load test" } }, org);
const operatorPassport = createRecord({ type: "passport", issuer: operator.did, subject: operator.did, prev: null, issued_at: at(), body: { did: operator.did, kind: "human", keys: keysOf(operator) } }, operator);
await writePhase("the operator, the organisation and its fleet", [operatorPassport, orgPassport, fleetRec]);
const agents = Array.from({ length: N }, (_, i) => party(`did:web:example.com:agents:load-${i}`));
await writePhase(`bring in ${N} agents (a passport each)`, agents.map((a) => createRecord({ type: "passport", issuer: org.did, subject: a.did, prev: null, issued_at: at(), body: { did: a.did, kind: "agent", sponsor: org.did, tier: 1, shape: {}, keys: keysOf(a), fleet: FLEET } }, org)));
for (let k = 1; k <= K; k++) {
  await writePhase(`act round ${k}: one signed write by each of ${N} agents`, agents.map((a) => createRecord({ type: "intent", issuer: a.did, subject: a.did, prev: null, issued_at: at(), body: { purpose: `act ${k}`, acceptance_criteria: ["done"], budget: { value: 20, unit: "credit" }, deadline: "2027-06-01T00:00:00Z", verification: { mode: "principal" } } }, a)));
}

// Reads through the service, with the log at its full size.
const reads: Record<string, { ms: number; ok: boolean; status: number }> = {};
reads.head = await rpc("log", "head", []);
reads.fleet = await rpc("log", "fleet", [FLEET]);
reads.registryPage = await rpc("log", "registryPage", [agents[N - 1].did]);
const many: number[] = [];
for (let i = 0; i < 100; i++) { const r = await rpc("log", "registryPage", [agents[Math.floor((i * 97) % N)].did]); many.push(r.ms); }
await sleep(500);
const bytes = dirBytes(db.replace(/^local:/, ""));
child.kill();

const writes = phases.reduce((x, p) => x + p.writes, 0), seconds = phases.reduce((x, p) => x + p.seconds, 0);
const result = {
  when: new Date().toISOString(),
  machine: { cpus: os.cpus().length, model: os.cpus()[0]?.model, node: process.version, platform: process.platform, loadavg: os.loadavg(), note: "measured on a shared, loaded development machine; a real `asp serve` process, the file log, over HTTP through /append-batch; not the Postgres backend" },
  agents: N, actsPerAgent: K, phases,
  totals: { writes, seconds: +seconds.toFixed(1), writesPerSecond: Math.round(writes / Math.max(0.001, seconds)), bytesOnDisk: bytes, bytesPerRecord: writes ? Math.round(bytes / writes) : 0 },
  reads: { ...Object.fromEntries(Object.entries(reads).map(([k, v]) => [k, { ms: Math.round(v.ms), ok: v.ok, status: v.status }])), registryPageOf100: { p50: pct(many, 50), p95: pct(many, 95), max: pct(many, 100) } },
  totalSeconds: +((Date.now() - t0) / 1000).toFixed(1),
};
const file = arg("out", "");
if (file) writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
