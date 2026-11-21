// Writes docs/promises-audit.md from docs/promises-audit.json (row DK1307).
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const a = JSON.parse(readFileSync(new URL("docs/promises-audit.json", root), "utf8")) as { audited: string; note: string; promises: { id: string; where: string; says: string; status: string; evidence: string[]; rows: string[]; limit?: string }[] };
const cell = (s: string) => s.replace(/\|/g, "/");
const count = (s: string) => a.promises.filter((p) => p.status === s).length;
const out = [
  "# Promises audit (row DK1307)",
  "",
  `Audited ${a.audited}. Generated from [promises-audit.json](promises-audit.json) by \`npm run promises-audit\`; do not edit by hand.`,
  "",
  a.note,
  "",
  `${a.promises.length} promises: ${count("complete")} complete, ${count("partial")} partial, ${count("stand-in")} stand-in, ${count("designed")} designed.`,
  "",
  "| ID | Where | The promise (as worded) | Status | Evidence | Open rows | The limit stated beside it |",
  "|---|---|---|---|---|---|---|",
  ...a.promises.map((p) => `| ${p.id} | ${p.where} | ${cell(p.says)} | ${p.status} | ${p.evidence.map((e) => `\`${e}\``).join(", ")} | ${p.rows.join(", ") || "-"} | ${cell(p.limit ?? "-")} |`),
  "",
  "Scope: the website home page, the README, the start page and llms.txt. The three draft society pages (site/society.html, site/learning.html, site/place-for-agents.html) are unpublished and checked claim by claim against docs/site-claims.json by packages/asp-cli/test/site-pages.test.ts. The terms and privacy notice wait for counsel (DK1340).",
  "",
];
writeFileSync(new URL("docs/promises-audit.md", root), out.join("\n"));
console.log(`${a.promises.length} promises`);
