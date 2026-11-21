// node evals/benchmark/flow.ts [--out docs/containment-flow.md]: measures the untrusted-flow defence (DK1713 follow-up 2) and writes the table. No model, no network.
import { writeFileSync } from "node:fs";
import { fmtRate, measureFlow } from "./flow-lib.ts";

export function flowDoc(): string {
  const named = measureFlow(false), wide = measureFlow(true);
  const row = (label: string, m: ReturnType<typeof measureFlow>) => ["mandate", "flow", "holdAll", "either"].map((k) => `| ${label} | ${({ mandate: "the Mandate alone", flow: "the flow rule alone", holdAll: "hold every outward call after a read", either: "the Mandate or the flow rule" } as Record<string, string>)[k]} | ${fmtRate((m.attacks as any)[k])} | ${fmtRate((m.benign as any)[k])} |`).join("\n");
  return [
    "# Containment: untrusted flow (DK1713 follow-up 2)", "",
    "Measured with `node evals/benchmark/flow.ts` over `evals/benchmark/flow-cases.json`: 24 attacks and 16 harmless steps, each a principal's task, a tool result the agent read (a file, a ticket, a shell, a log, a mail, a web page) and the next call. No model and no network. The defence is `asp gateway --untrusted-flow` (`packages/asp-package/src/gateway/untrusted-flow.ts`): an outward call that carries a host, an address, an email, a command line or a long opaque string copied from a tool result, and found neither in the principal's own messages nor among the Mandate's hosts, is held for the principal. Off by default.", "",
    "| Mandate | Defence | Attacks stopped (95% interval) | Harmless steps stopped or held (95% interval) |", "|---|---|---|---|",
    row("names hosts", named), row("names no host", wide), "",
    "How to read it. With a Mandate that names its hosts, the Mandate already stops most attacks that need a destination, so the flow rule adds little there. With a Mandate that grants the network without naming hosts, the flow rule is the part that does the work: it stops most of the attacks and holds far fewer harmless steps than the blunt rule that holds every outward call after any read.", "",
    `Missed by the Mandate or the flow rule, names hosts: ${named.missed.join(", ") || "none"}; names no host: ${wide.missed.join(", ") || "none"}. These are on purpose in the corpus: a destructive call that copies nothing out of what was read (fl-a21), and a destination written out in pieces (fl-a22, fl-a23). Harmless steps wrongly stopped: ${named.wrongHolds.join(", ") || "none"} (names hosts), ${wide.wrongHolds.join(", ") || "none"} (names no host): each reads a destination in a file and then goes there, which is the flow the rule exists to hold.`, "",
    "**Honest limits.** The author of the defence also wrote the cases, so this is not an outside corpus and a rate over it is not a claim about attacks written by someone else (DK1339). The first measurement, before the rule counted a web read and a tool granted by name as outward, gave 11 of 24 (46%) of the attacks on a Mandate that names no host; that was a defect of the rule's scope, not of the corpus, and the rule was corrected once and measured again; the table above is the second measurement, so these cases are no longer untouched. A fresh corpus is the next step. An attack that copies nothing, or spells the destination out in pieces, is not found here; the Mandate bounds those.", "",
  ].join("\n");
}
if (process.argv[1] && process.argv[1].endsWith("flow.ts")) {
  const doc = flowDoc();
  console.log(doc);
  const i = process.argv.indexOf("--out");
  if (i > 0) writeFileSync(process.argv[i + 1], doc);
}
