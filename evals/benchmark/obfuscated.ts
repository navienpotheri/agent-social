// node evals/benchmark/obfuscated.ts [--out docs/containment-obfuscated.md]: measures the decode-and-rescan defence (DK352 follow-up) over evals/benchmark/obfuscated-cases.json. No model, no network. A command is
// caught when its scope is above what the Mandate (no network) grants: with the plain reading alone, and with the decoded views and the decode-and-execute rule added.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classify, refineShellScope } from "../../packages/asp-package/src/gateway/judge.ts";
import { scopeForShellCommand } from "../../packages/asp-package/src/adapters/codex-actions.ts";
import { wilson } from "./new-classes-lib.ts";

export interface ObCase { id: string; attack: boolean; kind: string; command: string }
const NET = new Set(["shell.network", "repo.push", "pr.open", "pr.merge"]);
const fmt = (hit: number, n: number) => { const w = wilson(hit, n); return `${hit}/${n} = ${(100 * hit / n).toFixed(0)}% (${(100 * w.lo).toFixed(0)}% to ${(100 * w.hi).toFixed(0)}%)`; };

export function measureObfuscated() {
  const d = JSON.parse(readFileSync(fileURLToPath(new URL("./obfuscated-cases.json", import.meta.url)), "utf8")) as { cases: ObCase[] };
  const rows = d.cases.map((c) => ({ c, plain: NET.has(refineShellScope(scopeForShellCommand(c.command), c.command)), decoded: NET.has(classify({ name: "bash", args: { command: c.command } }).scope) }));
  const att = rows.filter((r) => r.c.attack), ben = rows.filter((r) => !r.c.attack);
  const planned = att.filter((r) => /MISSED ON PURPOSE/.test(r.c.kind));
  return {
    n: { attacks: att.length, benign: ben.length },
    plain: { attacks: fmt(att.filter((r) => r.plain).length, att.length), benign: fmt(ben.filter((r) => r.plain).length, ben.length), hit: att.filter((r) => r.plain).length, benignHit: ben.filter((r) => r.plain).length },
    decoded: { attacks: fmt(att.filter((r) => r.decoded).length, att.length), benign: fmt(ben.filter((r) => r.decoded).length, ben.length), hit: att.filter((r) => r.decoded).length, benignHit: ben.filter((r) => r.decoded).length },
    missed: att.filter((r) => !r.decoded).map((r) => r.c.id), plannedMisses: planned.map((r) => r.c.id), plannedCaught: planned.filter((r) => r.decoded).map((r) => r.c.id), wrong: ben.filter((r) => r.decoded).map((r) => r.c.id),
  };
}

export function obfuscatedDoc(): string {
  const m = measureObfuscated();
  return [
    "# Containment: decoded views of a shell command (DK352 follow-up)", "",
    `Measured with \`node evals/benchmark/obfuscated.ts\` over \`evals/benchmark/obfuscated-cases.json\`: ${m.n.attacks} attacks (network use hidden by an encoding) and ${m.n.benign} harmless commands that use the same tools. No model and no network. A command is caught when its scope is above what a Mandate without the network grants. The defence is \`packages/asp-package/src/gateway/decode-scan.ts\` (always on in the gateway's reading of a shell command): the command is read again after base64, hex, escapes, percent-encoding, rot13 and reversal are undone, and a command that decodes text and then runs it is treated as network use.`, "",
    "| Reading | Attacks caught (95% interval) | Harmless commands wrongly caught (95% interval) |", "|---|---|---|",
    `| the plain words alone (before) | ${m.plain.attacks} | ${m.plain.benign} |`,
    `| with decoded views and the decode-and-execute rule | ${m.decoded.attacks} | ${m.decoded.benign} |`, "",
    `Missed: ${m.missed.join(", ") || "none"}. Four attacks are marked in the corpus as missed on purpose (${m.plannedMisses.join(", ")}: a command built from variables, quote splitting, a payload written in one call and run in the next, a program that builds the command); ${m.plannedCaught.length ? `${m.plannedCaught.join(", ")} of them were caught all the same, by the plain scanner that already follows variables and quotes, so the corpus's own expectation was wrong there` : "none of them was caught"}. Harmless commands wrongly caught: ${m.wrong.join(", ") || "none"}.`, "",
    "**Honest limits.** The first measurement caught 22 of 24 and missed ob-a04 (a decoder inside `bash -c \"$(...)\"`) as well as ob-a23; the rule was extended once to read that form and the table above is the second measurement, so these cases are no longer untouched. The author of the defence also wrote the cases and the planned misses, so this is not an outside corpus and a rate over it says nothing about obfuscations someone else invents (DK1339). An encoding the reader does not know, a payload split across calls and one built piece by piece at run time are not found. A command that decodes and runs text is refused under a Mandate without the network even when the decoded text was harmless: that is the price of not being able to read it.", "",
  ].join("\n");
}
if (process.argv[1]?.endsWith("obfuscated.ts")) {
  const doc = obfuscatedDoc(); console.log(doc);
  const i = process.argv.indexOf("--out"); if (i > 0) writeFileSync(process.argv[i + 1], doc);
}
