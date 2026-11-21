// Writes docs/launch-bar.json and the tables of docs/launch-bar.md (between the BEGIN/END markers) from the register and conformance/launch-bar-data.ts. Row DK1312.
import { readFileSync, writeFileSync } from "node:fs";
import { nonClosedRows, readRegister } from "./launch-bar-rows.ts";
import { AFTER_A, DEFAULT_WITHDRAW, MUST, WITHDRAW } from "./launch-bar-data.ts";

const root = new URL("../", import.meta.url);
const size = (h: number) => (h <= 2 ? "S" : h <= 6 ? "M" : "L");
const short = (s: string, n = 150) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s).replace(/\|/g, "/");

export interface Entry { id: string; pri: string; status: string; bucket: "must" | "withdraw" | "after"; gap: string; hours: number; size: string; flags: string; why: string; claim?: string; where?: string; says?: string }

export function classify(): Entry[] {
  return nonClosedRows(readRegister(root)).map((r) => {
    const base = { id: r.id, pri: r.pri, status: r.status, gap: short(r.gap, 200) };
    const m = MUST[r.id];
    if (m) return { ...base, bucket: "must" as const, hours: m[0], size: size(m[0]), flags: m[1], why: m[2] };
    const w = WITHDRAW[r.id];
    if (w) return { ...base, bucket: "withdraw" as const, hours: 0, size: "", flags: "", why: "", claim: w[0], where: w[1] };
    const a = AFTER_A[r.id];
    if (a) return { ...base, bucket: "after" as const, hours: 0, size: "", flags: "", why: a[0], says: a[1] };
    if (r.pri === "A") return { ...base, bucket: "withdraw" as const, hours: 0, size: "", flags: "", why: "", claim: DEFAULT_WITHDRAW[0], where: DEFAULT_WITHDRAW[1] };
    return { ...base, bucket: "after" as const, hours: 0, size: "", flags: "", why: `Priority ${r.pri}: not needed for an outsider to join the beta`, says: "not claimed; the register row is the plan" };
  });
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file://").href || process.argv[1]?.endsWith("generate-launch-bar.ts")) {
  const entries = classify();
  const count = (b: string) => entries.filter((e) => e.bucket === b).length;
  const hours = entries.reduce((s, e) => s + e.hours, 0);
  const flagN = (f: string) => entries.filter((e) => e.bucket === "must" && e.flags.includes(f)).length;
  writeFileSync(new URL("docs/launch-bar.json", root), JSON.stringify({ row: "DK1312", counts: { must: count("must"), withdraw: count("withdraw"), after: count("after"), total: entries.length }, mustWorkerHours: hours, entries }, null, 1) + "\n");

  const lines: string[] = [];
  const must = entries.filter((e) => e.bucket === "must").sort((a, b) => a.hours - b.hours || a.id.localeCompare(b.id));
  lines.push(`### Counts`, "", `| Bucket | Rows |`, `|---|---|`, `| Must close before launch | ${count("must")} (${hours.toFixed(1)} worker-hours; ${flagN("D")} need an owner decision, ${flagN("L")} a live run, ${flagN("X")} an outside party, ${flagN("O")} an owner action) |`, `| Withdraw the claim until done | ${count("withdraw")} |`, `| After launch | ${count("after")} |`, `| Total not closed | ${entries.length} |`, "");
  lines.push(`### Bucket 1: must close before launch (smallest first)`, "", `Flags: D owner decision, L live run, X outside party, O owner action.`, "", `| ID | Pri | Status | Hours | Size | Flags | Why |`, `|---|---|---|---|---|---|---|`);
  for (const e of must) lines.push(`| ${e.id} | ${e.pri} | ${e.status} | ${e.hours} | ${e.size} | ${e.flags || "-"} | ${short(e.why, 170)} |`);
  lines.push("", `### Bucket 2: withdraw the claim until done`, "", `| ID | Pri | Status | Claim | Where it is made |`, `|---|---|---|---|---|`);
  for (const e of entries.filter((x) => x.bucket === "withdraw")) lines.push(`| ${e.id} | ${e.pri} | ${e.status} | ${short(e.claim!, 130)} | ${short(e.where!, 110)} |`);
  lines.push("", `### Bucket 3: after launch`, "", `| ID | Pri | Status | Why it can wait | What the beta says meanwhile |`, `|---|---|---|---|---|`);
  for (const e of entries.filter((x) => x.bucket === "after")) lines.push(`| ${e.id} | ${e.pri} | ${e.status} | ${short(e.why, 120)} | ${short(e.says!, 100)} |`);

  const path = new URL("docs/launch-bar.md", root);
  const md = readFileSync(path, "utf8");
  const out = md.replace(/<!-- BEGIN TABLES -->[\s\S]*<!-- END TABLES -->/, `<!-- BEGIN TABLES -->\n${lines.join("\n")}\n<!-- END TABLES -->`);
  writeFileSync(path, out);
  console.log(JSON.stringify({ must: count("must"), withdraw: count("withdraw"), after: count("after"), hours, D: flagN("D"), L: flagN("L"), X: flagN("X"), O: flagN("O") }));
}
