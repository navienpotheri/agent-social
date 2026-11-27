// Writes docs/launch-bar.json and the tables of docs/launch-bar.md (between the BEGIN/END markers) from the register and conformance/launch-bar-data.ts. Row DK1312.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  const must = entries.filter((e) => e.bucket === "must").sort((a, b) => Number(a.flags !== "") - Number(b.flags !== "") || a.hours - b.hours || a.id.localeCompare(b.id));
  lines.push(`### Counts`, "", `| Bucket | Rows |`, `|---|---|`, `| Must close before launch | ${count("must")} (${hours.toFixed(1)} worker-hours; ${flagN("D")} need an owner decision, ${flagN("L")} a live run, ${flagN("X")} an outside party, ${flagN("O")} an owner action) |`, `| Withdraw the claim until done | ${count("withdraw")} |`, `| After launch | ${count("after")} |`, `| Total not closed | ${entries.length} |`, "");
  lines.push(`### Bucket 1: must close before launch (closable by one worker in one session first: no flag; then rows that need a decision, a live run, an outside party or an owner action; smallest first within each)`, "", `Flags: D owner decision, L live run, X outside party, O owner action.`, "", `| ID | Pri | Status | Hours | Size | Flags | Why |`, `|---|---|---|---|---|---|---|`);
  for (const e of must) lines.push(`| ${e.id} | ${e.pri} | ${e.status} | ${e.hours} | ${e.size} | ${e.flags || "-"} | ${short(e.why, 170)} |`);
  lines.push("", `### Bucket 2: withdraw the claim until done`, "", `| ID | Pri | Status | Claim | Where it is made |`, `|---|---|---|---|---|`);
  for (const e of entries.filter((x) => x.bucket === "withdraw")) lines.push(`| ${e.id} | ${e.pri} | ${e.status} | ${short(e.claim!, 130)} | ${short(e.where!, 110)} |`);
  lines.push("", `### Bucket 3: after launch`, "", `| ID | Pri | Status | Why it can wait | What the beta says meanwhile |`, `|---|---|---|---|---|`);
  for (const e of entries.filter((x) => x.bucket === "after")) lines.push(`| ${e.id} | ${e.pri} | ${e.status} | ${short(e.why, 120)} | ${short(e.says!, 100)} |`);

  // The page header for the owner: every number here is computed, so it cannot go stale.
  const pri = (x: string) => entries.filter((e) => e.pri === x).length;
  const CORE = ["DK1312", "DK1340", "DK1341", "O12", "O13", "O11", "O2", "T12", "T3", "T4", "U16", "DK64", "E10", "E11", "E8", "DK530", "H4", "M2", "US4", "CY12"];
  const REDUCED = [...CORE, "DK733", "DK854", "DK546", "DK740", "LW1", "DK1344", "DK1342", "P29", "T26", "T21", "O18", "E2", "E5", "U9", "U1", "T1", "T2", "GV6", "E9", "O19", "U8", "DK1348", "DK1204"];
  const hoursOf = (ids: string[]) => entries.filter((e) => e.bucket === "must" && ids.includes(e.id)).reduce((a, e) => a + e.hours, 0);
  const dateAfter = (h: number) => { const d = new Date(Date.UTC(2026, 10, 21)); d.setUTCDate(d.getUTCDate() + Math.ceil(h / 10)); return d.toISOString().slice(0, 10); };
  const coreH = hoursOf(CORE), redH = hoursOf(REDUCED);
  const summaryText = [
    `**The date 25 to 26 November cannot hold.** ${entries.length} register rows are not closed (${pri("A")} at priority A, ${pri("B")} at B, ${pri("C")} at C). Sorted:`, "",
    `- **Must close before launch: ${count("must")} rows, ${hours.toFixed(0)} worker-hours.** ${flagN("D")} need your decision, ${flagN("L")} a live run, ${flagN("X")} an outside party and ${flagN("O")} an action only you can take (GitHub settings, the deployed start line, a Mac).`,
    `- **Withdraw the claim until done: ${count("withdraw")} rows.** The site, README, llms.txt, deck and ads must not say what the row says is not true yet. Most are the society's institutions and the deck's roadmap, which exist as built and tested with scripted agents, not run live with real agents.`,
    `- **After launch: ${count("after")} rows.** Priority B and C work, and a few priority A rows that are polish, research programmes or your own decisions. The right-hand column of bucket 3 says what the beta says meanwhile.`, "",
    "Three honest dates, at about 10 productive build-hours a day for one worker (an assumption; more workers shorten it, and none of this counts a decision or a live run arriving late):", "",
    "| Bar | Worker-hours | Earliest date |", "|---|---|---|",
    `| **Core**: the legal minimum, operations, telemetry with its disclosure, the stranger's first 15 minutes, mail, the money remedy and the court disclosure (${CORE.length} rows, section 4) | ${coreH.toFixed(0)} | **${dateAfter(coreH)}** |`,
    `| **Reduced**: Core plus enrolment, the run log, token recovery, export and close, and housekeeping (${REDUCED.length} rows) | ${redH.toFixed(0)} | ${dateAfter(redH)} |`,
    `| **Full**: all ${count("must")} must-close rows, including the open forum's live launch, the society map and house agents, the enterprise release and the engine of change | ${hours.toFixed(0)} | ${dateAfter(hours)} |`, "",
    "The live run with a real model agent is postponed by the owner, so T15, T22, DK650 and P21 cannot be proved; their claims move to \"withdraw\". **Recommendation:** the Core bar can hold its date only if your decisions and actions arrive (the legal acceptance, the status page, the GitHub settings, the deployed start line, the live-check day); ads on the Core date, with the forum, society map and house agents described as \"not open yet\" if they are not ready, are possible; the Full bar is later. A decision only you can make: the forum is live at the beta launch (FD2), which is part of Full.", "",
    "**What you decide first** (section 3, one question per row): the legal acceptance in docs/legal-review.md, the plan prices, the status page, the GitHub settings (O11 to O13) and the live-check day. Each row's exact question is in section 3 and in docs/owner-questions-site.md.",
  ].join("\n");
  // Rows closed on the latest closing date in the register (deterministic: no clock), listed by id so the owner can see what moved.
  const regText = readRegister(root);
  const closedOn = [...regText.matchAll(/Closed (2026-\d\d-\d\d)/g)].map((m) => m[1]!).sort();
  const today = closedOn[closedOn.length - 1] ?? "";
  const closedIds = new Set<string>();
  for (const ln of regText.split("\n")) {
    const m = /^\| ([A-Z]{1,3}\d+[a-z]?) \|/.exec(ln);
    if (m && ln.includes(`Closed ${today}`) && /\| closed \|\s*$/.test(ln.trimEnd())) closedIds.add(m[1]!);
  }
  const closedLine = today ? `\n\n**Closed on ${today}: ${closedIds.size} rows** (the register rows whose status is closed and whose text says closed on that date): ${[...closedIds].sort((a, b) => a.localeCompare(b, "en", { numeric: true })).join(", ")}.\n\n*This section is written by conformance/generate-launch-bar.ts from the register and docs/launch-bar.json: every number in it is computed, and packages/asp-cli/test/launch-bar-summary.test.ts fails when the prose and the JSON differ.*` : "";
  const path = new URL("docs/launch-bar.md", root);
  let md = readFileSync(path, "utf8");
  if (!md.includes("<!-- BEGIN SUMMARY -->")) md = md.replace(/(## 1\. One page for the owner\n)[\s\S]*?(\n## 2\.)/, "$1\n<!-- BEGIN SUMMARY -->\n<!-- END SUMMARY -->\n$2");
  const out = md.replace(/<!-- BEGIN TABLES -->[\s\S]*<!-- END TABLES -->/, `<!-- BEGIN TABLES -->\n${lines.join("\n")}\n<!-- END TABLES -->`).replace(/<!-- BEGIN SUMMARY -->[\s\S]*<!-- END SUMMARY -->/, `<!-- BEGIN SUMMARY -->\n${summaryText}${closedLine}\n<!-- END SUMMARY -->`);
  writeFileSync(path, out);
  // The owner's morning guide states these numbers between markers, written here from the same data, so that they cannot be stale (owner-morning-guide.test.ts keeps them honest).
  const guidePath = new URL("docs/owner-morning-guide.md", root);
  if (existsSync(guidePath)) {
    const guide = readFileSync(guidePath, "utf8");
    const sentence = `The launch bar lists ${entries.length} register rows that are not closed.${today ? ` ${closedIds.size} rows were closed on ${today}.` : ""} Of the open rows, ${count("must")} must close before launch (${Math.round(hours * 10) / 10} worker-hours): ${flagN("D")} need your decision, ${flagN("L")} a live run, ${flagN("X")} an outside party and ${flagN("O")} an action only you can take. ${count("withdraw")} rows are claims that the public pages withdraw until the row closes, and ${count("after")} are after launch.`;
    const next = guide.replace(/<!-- BEGIN NUMBERS -->[\s\S]*?<!-- END NUMBERS -->/, `<!-- BEGIN NUMBERS -->\n${sentence}\n<!-- END NUMBERS -->`);
    if (next !== guide) writeFileSync(guidePath, next);
  }
  console.log(JSON.stringify({ must: count("must"), withdraw: count("withdraw"), after: count("after"), hours, D: flagN("D"), L: flagN("L"), X: flagN("X"), O: flagN("O") }));
}
