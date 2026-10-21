// ASP Containment Benchmark (ACB) v0.2, suite 2: audit integrity. Can anyone tamper with the signed history without being caught?
//   Part A: take a real settled job (8 signed records), alter an exported copy in each way a dishonest operator could, and replay it into a fresh log. Detected = the replay refuses it.
//   Part B: the protocol's own conformance vectors (lifecycle rule enforcement): each vector says whether the chain must be accepted or rejected, and where.
//   node evals/benchmark/audit.mjs [--json out.json]
import { writeFileSync } from "node:fs";
import { EventLog, MemoryStore } from "../../packages/asp-log/src/index.ts";
import { lifecycleCases, vectorResolver } from "../../packages/asp-log/test/harness.ts";

const fresh = () => new EventLog(new MemoryStore(), { fallbackResolver: vectorResolver });
const clone = (x) => JSON.parse(JSON.stringify(x));
const caught = async (items, expect) => { try { await fresh().importRecords(items, expect); return false; } catch { return true; } };

const base = lifecycleCases.find((c) => c.name === "happy_path").records;
const source = fresh();
for (const r of base) await source.append(r);
const exported = await source.since(0, 1000);
const head = await source.head();
const n = exported.length;

// Part A: tampering
const mutations = {
  "change a field in a record's body": (items, i) => { const x = clone(items); const b = x[i].record.body; const k = Object.keys(b).find((k) => typeof b[k] === "string" || typeof b[k] === "number"); if (!k) return null; b[k] = typeof b[k] === "number" ? b[k] + 1 : b[k] + "x"; return x; },
  "flip a bit in a signature": (items, i) => { const x = clone(items); const v = x[i].record.sig.value; x[i].record.sig.value = (v[0] === "A" ? "B" : "A") + v.slice(1); return x; },
  "change a record's id": (items, i) => { const x = clone(items); x[i].record.id = x[i].record.id.slice(0, -2) + "00"; return x; },
  "change who issued a record": (items, i) => { const x = clone(items); x[i].record.issuer = x[(i + 1) % n].record.issuer === x[i].record.issuer ? "did:web:mallory.example" : x[(i + 1) % n].record.issuer; return x; },
  "change a record's time": (items, i) => { const x = clone(items); x[i].record.issued_at = "2031-01-01T00:00:00Z"; return x; },
  "point a record at a different parent": (items, i) => { if (i === 0) return null; const x = clone(items); x[i].record.prev = x[0].record.id === x[i].record.prev ? null : x[0].record.id; return x; },
  "delete a record from the middle": (items, i) => (i === 0 || i === n - 1 ? null : items.filter((_, j) => j !== i)),
  "swap two neighbouring records": (items, i) => { if (i === n - 1) return null; const x = clone(items); [x[i].record, x[i + 1].record] = [x[i + 1].record, x[i].record]; return x; },
  "insert a forged record": (items, i) => { const x = clone(items); const forged = clone(items[i]); forged.record.body = { ...forged.record.body, forged: true }; forged.seq = items[i].seq + 0.5; return [...x, { ...forged, seq: n + 1 }]; },
  "replace a record with another job's record": (items, i) => { const other = lifecycleCases.find((c) => c.name === "settle_before_deadline").records[0]; if (other.id === items[i].record.id) return null; const x = clone(items); x[i].record = clone(other); return x; },
  "change the time a record was logged": (items, i) => { const x = clone(items); x[i].appendedAt = "2031-01-01T00:00:00Z"; return x; },
};
const rows = {};
for (const [name, mutate] of Object.entries(mutations)) {
  let tried = 0, detected = 0; const missed = [];
  for (let i = 0; i < n; i++) {
    const t = mutate(exported, i);
    if (!t) continue;
    tried++;
    if (await caught(t, { seq: head.seq, logHash: head.logHash })) detected++; else missed.push(`record ${i + 1} of ${n}`);
  }
  rows[name] = { tried, detected, missed };
}
// Cutting off the end: only detectable against a head someone else holds (a published checkpoint).
{
  let tried = 0, withHead = 0, withoutHead = 0;
  for (let keep = 1; keep < n; keep++) {
    tried++;
    if (await caught(exported.slice(0, keep), { seq: head.seq, logHash: head.logHash })) withHead++;
    if (await caught(exported.slice(0, keep), undefined)) withoutHead++;
  }
  rows["cut records off the end (checked against the published head)"] = { tried, detected: withHead, missed: [] };
  rows["cut records off the end (no published head to compare)"] = { tried, detected: withoutHead, missed: ["by design: a shorter history is still a valid history; this is why checkpoints are published"] };
}
// Controls: honest copies must be accepted.
const controls = [];
controls.push(["an untouched export is accepted", !(await caught(exported, { seq: head.seq, logHash: head.logHash }))]);
controls.push(["importing the same records twice is accepted", !(await caught([...exported, ...exported], { seq: head.seq, logHash: head.logHash }))]);
controls.push(["verify() on the original log passes", (await source.verify()).ok === true]);

// Part B: the protocol's rule-enforcement vectors
const vectors = [];
for (const c of lifecycleCases) {
  const log = fresh();
  let code, failedAt = -1;
  for (const [i, r] of c.records.entries()) { try { await log.append(r); } catch (e) { code = e.code ?? "ERROR"; failedAt = i; break; } }
  const info = !code ? await log.chainInfo(c.records[0].id) : null;
  const ok = "state" in c.expect ? !code && info?.state === c.expect.state : code === c.expect.error && failedAt === c.expect.at;
  vectors.push({ name: c.name, expects: "state" in c.expect ? `accepted, ${c.expect.state}` : `rejected, ${c.expect.error}`, ok });
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");
console.log("=== ASP Containment Benchmark v0.2, suite 2: audit integrity ===");
console.log(`\nA. Tampering with a settled job's signed history (${n} records, copied and altered, then replayed into a fresh log)`);
let tt = 0, td = 0;
for (const [k, r] of Object.entries(rows)) {
  console.log(`  ${k.padEnd(66)} caught ${String(r.detected).padStart(2)}/${String(r.tried).padEnd(2)} ${pct(r.detected, r.tried).padStart(5)}${r.missed.length ? `   missed: ${r.missed.slice(0, 3).join(", ")}${r.missed.length > 3 ? "…" : ""}` : ""}`);
  if (!k.includes("no published head")) { tt += r.tried; td += r.detected; }
}
console.log(`  ${"all tampering attempts (excluding the no-head truncation, which is by design)".padEnd(66)} caught ${td}/${tt} ${pct(td, tt)}`);
console.log("  controls:");
for (const [k, ok] of controls) console.log(`    ${ok ? "pass" : "FAIL"}  ${k}`);
const vp = vectors.filter((v) => v.ok).length;
console.log(`\nB. Rule enforcement against the protocol's conformance vectors: ${vp}/${vectors.length} behave as specified`);
for (const v of vectors.filter((v) => !v.ok)) console.log(`  FAIL ${v.name} (expected ${v.expects})`);

const result = { suite: "audit", tamper: Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, { tried: r.tried, detected: r.detected }])), tamperTotal: { tried: tt, detected: td }, controls: Object.fromEntries(controls), vectors: { passed: vp, total: vectors.length, failed: vectors.filter((v) => !v.ok).map((v) => v.name) } };
const j = process.argv.indexOf("--json");
if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify(result, null, 2));
