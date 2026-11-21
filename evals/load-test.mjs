// A local load test of the log service (register row DK65): starts `asp serve` on this machine with the file log, drives synthetic tenants (record writes, reads) and checks the per-tenant limits, against a STATED
// latency target, and records the result in docs/load-test-results-<date>.md (and .json). It does NOT show that the hosted service meets the beta target: that needs a hosted run (docs/owner-checklist.md).
//   node evals/load-test.mjs [--tenants 50] [--runs 20] [--records-per-run 4] [--reads-per-run 3] [--concurrency 32] [--target-write-p95 300] [--target-read-p95 150] [--out <file>] [--no-record]
// The numbers describe THIS machine (cores and memory are printed): a laptop is not the server. Every credential here is a throwaway one made for the run; nothing real is touched.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { cpus, platform, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "..");
const { createRecord, signerFromSeed, b64urlEncode } = await import(new URL("../packages/asp-core/src/index.ts", import.meta.url).href);
const { plan, limitProblems } = await import(new URL("../packages/asp-log/src/capacity.ts", import.meta.url).href);
const { DEFAULT_STARTING } = await import(new URL("../packages/asp-log/src/signup.ts", import.meta.url).href);

const args = process.argv.slice(2);
const num = (name, d) => { const i = args.indexOf(`--${name}`); return i < 0 ? d : Number(args[i + 1]); };
const str = (name, d) => { const i = args.indexOf(`--${name}`); return i < 0 ? d : args[i + 1]; };
const TENANTS = num("tenants", 50), RUNS = num("runs", 20), RPR = num("records-per-run", 4), READS = num("reads-per-run", 3), CONC = num("concurrency", 32);
const TARGET_W = num("target-write-p95", 300), TARGET_R = num("target-read-p95", 150);
const sha = (t) => createHash("sha256").update(t).digest("hex");
const free = () => new Promise((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startService(tag, tokens, extra) {
  const dir = mkdtempSync(join(tmpdir(), `asp-load-${tag}-`));
  const tokensFile = join(dir, "tokens.json");
  writeFileSync(tokensFile, JSON.stringify(tokens.map((t) => ({ name: t.name, role: "tenant", tokenSha256: sha(t.token) }))));
  const port = await free();
  const db = `local:${join(dir, "log")}`;
  const child = spawn(process.execPath, [join(root, "packages/asp-cli/bin/asp.mjs"), "serve", "--db", db, "--tokens", tokensFile, "--port", String(port), ...extra], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`${url}/health`); if (r.ok) return { child, url, db, dir }; } catch { /* not yet */ } if (child.exitCode !== null) break; await sleep(100); }
  child.kill();
  throw new Error(`the service did not start: ${log.slice(-400)}`);
}
const dirBytes = (p) => { let n = 0; try { const st = statSync(p); if (st.isFile()) return st.size; for (const f of readdirSync(p)) n += dirBytes(join(p, f)); } catch { /* gone */ } return n; };

/** One synthetic tenant: a person with a passport, writing intents and reading the log back. */
function tenant(i) {
  const did = `did:web:load.example:users:t${i}`;
  const signer = signerFromSeed(`${did}#key-1`, new Uint8Array(createHash("sha256").update(did).digest()));
  return { name: `load-${i}`, token: `tok-${i}-${sha(String(i)).slice(0, 12)}`, did, signer, n: 0 };
}
const clock = (() => { let t = Date.parse("2026-11-12T00:00:00Z"); return () => new Date((t += 1000)).toISOString().replace(".000Z", "Z"); })();
const passport = (t) => createRecord({ type: "passport", issuer: t.did, subject: t.did, prev: null, body: { did: t.did, kind: "human", keys: [{ id: t.signer.kid, type: "Ed25519", public_key: b64urlEncode(t.signer.publicKey) }] }, issued_at: clock() }, t.signer);
const intent = (t) => createRecord({ type: "intent", issuer: t.did, subject: t.did, prev: null, body: { purpose: `Load test job ${++t.n}`, acceptance_criteria: ["done"], budget: { value: 60, unit: "credit" }, deadline: "2027-06-01T00:00:00Z", verification: { mode: "principal" } }, issued_at: clock() }, t.signer);

async function rpc(url, token, target, method, callArgs) {
  const t0 = performance.now();
  let status = 0, body;
  try { const r = await fetch(`${url}/rpc`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ target, method, args: callArgs }) }); status = r.status; body = await r.json().catch(() => ({})); } catch (e) { status = -1; body = { error: { message: String(e) } }; }
  return { ms: performance.now() - t0, status, ok: status === 200 && body.ok !== false, body };
}
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 10) / 10; };
const stats = (xs) => ({ n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: pct(xs, 100) });
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

// ---- phase A and B: writes and reads, no throttling (the limits are the next phase) ----
const tenants = Array.from({ length: TENANTS }, (_, i) => tenant(i + 1));
const main = await startService("main", tenants, ["--address-limit", "0", "--rate-limit", "0", "--write-limit", "0", "--record-quota", "0", "--byte-quota-mb", "0"]);
const writes = [], reads = [], errors = [];
const started = performance.now();
let written = 0;
try {
  await pool(tenants, CONC, async (t) => {
    const first = await rpc(main.url, t.token, "handle", "append", [passport(t)]);
    if (!first.ok) { errors.push(`passport ${t.name}: ${first.status} ${JSON.stringify(first.body).slice(0, 120)}`); return; }
    written++;
    const ids = [];
    for (let run = 0; run < RUNS; run++) {
      for (let k = 0; k < RPR; k++) {
        const r = await rpc(main.url, t.token, "handle", "append", [intent(t)]);
        writes.push(r.ms);
        if (r.ok) { written++; ids.push(r.body.result?.id ?? r.body.id); } else errors.push(`write ${t.name}: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      }
      for (let k = 0; k < READS; k++) {
        const which = k % 3;
        const r = which === 0 ? await rpc(main.url, t.token, "log", "head", []) : which === 1 && ids.length ? await rpc(main.url, t.token, "log", "get", [ids[ids.length - 1]]) : await rpc(main.url, t.token, "log", "since", [Math.max(0, written - 10), 10]);
        reads.push(r.ms);
        if (!r.ok) errors.push(`read ${t.name}: ${r.status}`);
      }
    }
  });
} finally { /* measured below */ }
const elapsed = (performance.now() - started) / 1000;
await sleep(600);
const bytes = dirBytes(main.db.replace(/^local:/, ""));
const head = await rpc(main.url, tenants[0].token, "log", "head", []);
main.child.kill();

// ---- phase C: the per-tenant limits, each on its own service (every client here is one address, so the address limit is off) ----
const probe = [tenant(9001), tenant(9002)];
const limits = { quota: null, rate: null };
const quotaSvc = await startService("quota", [probe[0]], ["--address-limit", "0", "--write-limit", "0", "--record-quota", "50"]);
try {
  const q = probe[0];
  let accepted = 0, refused = null;
  await rpc(quotaSvc.url, q.token, "handle", "append", [passport(q)]); accepted++;
  for (let i = 0; i < 80 && !refused; i++) { const x = await rpc(quotaSvc.url, q.token, "handle", "append", [intent(q)]); if (x.ok) accepted++; else refused = { status: x.status, code: x.body?.error?.code }; }
  limits.quota = { quota: 50, accepted, refused };
} finally { quotaSvc.child.kill(); }
const rateSvc = await startService("rate", [probe[1]], ["--address-limit", "0", "--record-quota", "0", "--byte-quota-mb", "0"]);
try {
  const r = probe[1];
  await rpc(rateSvc.url, r.token, "handle", "append", [passport(r)]);
  let ok = 0, limited = 0, firstLimited = null, retryAfter = null;
  for (let i = 0; i < 200; i++) { const x = await rpc(rateSvc.url, r.token, "handle", "append", [intent(r)]); if (x.ok) ok++; else if (x.status === 429 || x.body?.error?.code === "RATE_LIMITED") { limited++; firstLimited ??= ok; retryAfter ??= x.body?.error?.retryAfterSec ?? null; } }
  limits.rate = { writeLimitPerMinute: 120, ok, limited, firstLimitedAfter: firstLimited, retryAfterSec: retryAfter };
} finally { rateSvc.child.kill(); }

// ---- the report ----
const w = stats(writes), r = stats(reads);
const bytesPerRecord = written ? Math.round(bytes / written) : 0;
const input = { tenants: 1000, runs: 1_000_000, days: 92, recordsPerRun: 2, bytesPerRecord, peakFactor: 20, requestsPerWrite: 3 };
const marketed = { ...input, recordsPerRun: 10 };
const result = {
  date: new Date().toISOString().slice(0, 10), machine: { platform: platform(), cpus: cpus().length, cpu: cpus()[0]?.model, memGB: Math.round(totalmem() / 2 ** 30), node: process.versions.node },
  params: { tenants: TENANTS, runsPerTenant: RUNS, recordsPerRun: RPR, readsPerRun: READS, concurrency: CONC },
  target: { writeP95Ms: TARGET_W, readP95Ms: TARGET_R, errors: 0 },
  writes: w, reads: r, errors: errors.length, errorSamples: errors.slice(0, 5), recordsWritten: written, seconds: Math.round(elapsed * 10) / 10,
  writesPerSecond: Math.round((writes.length / elapsed) * 10) / 10, requestsPerSecond: Math.round(((writes.length + reads.length) / elapsed) * 10) / 10,
  bytesOnDisk: bytes, bytesPerRecord, logHead: head.body?.result?.seq ?? null, limits,
  localTargetMet: w.p95 !== null && w.p95 <= TARGET_W && r.p95 !== null && r.p95 <= TARGET_R && errors.length === 0,
  plan: { governedRuns: plan(input), marketedJobs: plan(marketed) },
  limitProblems: { governedRuns: limitProblems(input), marketedJobs: limitProblems(marketed) },
  defaults: DEFAULT_STARTING,
};
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const lines = [
  `# Load test results, ${result.date}`, "",
  "**A local run, not the hosted target.** The service ran on this machine (`asp serve`, the file log) with synthetic tenants; the numbers describe this machine, and the hosted service has not been tested (docs/owner-checklist.md, register row DK65 stays partial). Credits are accounting entries, not money.", "",
  `Machine: ${result.machine.platform}, ${result.machine.cpus} cores (${result.machine.cpu}), ${result.machine.memGB} GB, node ${result.machine.node}.`,
  `Load: ${TENANTS} tenants x ${RUNS} runs x ${RPR} records a run (${written} records written), ${READS} reads a run, ${CONC} tenants at once, no throttling.`, "",
  `| Measure | Target | Result |`, `|---|---|---|`,
  `| write latency p95 | at most ${TARGET_W} ms | ${w.p95} ms (p50 ${w.p50}, p99 ${w.p99}, max ${w.max}) |`,
  `| read latency p95 | at most ${TARGET_R} ms | ${r.p95} ms (p50 ${r.p50}, p99 ${r.p99}, max ${r.max}) |`,
  `| errors | 0 | ${errors.length} |`,
  `| throughput | n/a | ${result.writesPerSecond} writes a second, ${result.requestsPerSecond} requests a second |`,
  `| bytes a record on disk | n/a | ${bytesPerRecord} (${mb(bytes)} for ${written} records) |`,
  `| **local target met** | | **${result.localTargetMet ? "yes" : "no"}** |`, "",
  "## The per-tenant limits (the shipped defaults)", "",
  `- Record quota: a tenant with a quota of ${limits.quota.quota} was accepted ${limits.quota.accepted} records and then refused with ${limits.quota.refused ? `HTTP ${limits.quota.refused.status} ${limits.quota.refused.code}` : "no refusal (the quota did not stop it)"}.`,
  `- Write limit (120 a minute a tenant): of 200 fast writes ${limits.rate.ok} were accepted and ${limits.rate.limited} were refused (429), the first refusal after ${limits.rate.firstLimitedAfter ?? "none"} accepted: the bucket holds a burst well under the 120 a minute, so a client that writes faster than about 2 a second is told to wait.`, "",
  "## What 1,000 tenants and 1,000,000 runs over a 92-day beta ask (docs/capacity-plan.md has the method)", "",
  "| | governed runs (about 2 records a run) | marketed jobs (about 10 records a job) |", "|---|---|---|",
  `| records | ${plan(input).records.toLocaleString()} | ${plan(marketed).records.toLocaleString()} |`,
  `| storage at ${bytesPerRecord} bytes a record | ${mb(plan(input).storageBytes)} | ${mb(plan(marketed).storageBytes)} |`,
  `| average writes a second | ${plan(input).avgWritesPerSecond.toFixed(2)} | ${plan(marketed).avgWritesPerSecond.toFixed(2)} |`,
  `| peak writes a second (x20) | ${plan(input).peakWritesPerSecond.toFixed(1)} | ${plan(marketed).peakWritesPerSecond.toFixed(1)} |`,
  `| records a tenant | ${Math.round(plan(input).recordsPerTenant)} | ${Math.round(plan(marketed).recordsPerTenant)} |`, "",
  `Limits that do not cover the plan (shipped defaults: ${DEFAULT_STARTING.recordQuota} records, ${DEFAULT_STARTING.byteQuota / 2 ** 20} MB, ${DEFAULT_STARTING.rateLimitPerMinute} requests a minute):`,
  ...result.limitProblems.governedRuns.map((p) => `- governed runs: ${p}`), ...result.limitProblems.marketedJobs.map((p) => `- marketed jobs: ${p}`),
  ...(!result.limitProblems.governedRuns.length && !result.limitProblems.marketedJobs.length ? ["- none"] : []), "",
];
const out = str("out", join(root, "docs", `load-test-results-${result.date}.md`));
console.log(lines.join("\n"));
if (!args.includes("--no-record")) { mkdirSync(resolve(out, ".."), { recursive: true }); writeFileSync(out, lines.join("\n")); writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify(result, null, 2) + "\n"); console.log(`recorded in ${out}`); }
process.exit(result.localTargetMet && limits.quota.refused && limits.rate.limited > 0 ? 0 : 1);
