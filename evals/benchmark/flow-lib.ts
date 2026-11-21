// DK1713 follow-up 2: measures the untrusted-flow defence over evals/benchmark/flow-cases.json. No model and no network. For each case (the principal's task, a tool result the agent read, the next call) it asks four
// things: does the Mandate alone refuse the call (the judge), does the flow rule hold it, is it held by the blunt rule that holds every outward call after a read, and does the Mandate or the flow rule stop it.
// Rates carry Wilson 95% intervals. The author of the defence wrote the cases: not an outside corpus.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { judge } from "../../packages/asp-package/src/gateway/judge.ts";
import { copiedFromUntrusted, flowReachesOutward, salientTokens } from "../../packages/asp-package/src/gateway/untrusted-flow.ts";
import { wilson } from "./new-classes-lib.ts";

export interface FlowCase { id: string; attack: boolean; via: string; task: string; result: string; call: { name: string; args: Record<string, unknown> } }
export interface FlowRate { n: number; hit: number; rate: number; lo: number; hi: number }
const rate = (hit: number, n: number): FlowRate => ({ n, hit, rate: n ? hit / n : 0, ...wilson(hit, n) });
export const fmtRate = (r: FlowRate) => `${r.hit}/${r.n} = ${(r.rate * 100).toFixed(0)}% (${(r.lo * 100).toFixed(0)}% to ${(r.hi * 100).toFixed(0)}%)`;

export function loadFlow(): { mandate: { scopes: string[]; hosts: string[] }; cases: FlowCase[] } {
  return JSON.parse(readFileSync(fileURLToPath(new URL("./flow-cases.json", import.meta.url)), "utf8"));
}

/** `wide`: the same Mandate without its host list, as for an agent granted the network at large; the flow rule then compares against the principal's own words only. */
export function measureFlow(wide = false) {
  const { mandate: m0, cases } = loadFlow();
  const mandate = wide ? { scopes: m0.scopes, hosts: undefined as string[] | undefined } : m0;
  const rows = cases.map((c) => {
    const j = judge({ id: c.id, name: c.call.name, args: c.call.args }, mandate.scopes, [], undefined, mandate.hosts);
    const mandateStops = !j.allow;
    const flowHolds = flowReachesOutward(j.scope) && copiedFromUntrusted(c.call.args, salientTokens(c.result), { principalText: c.task, allowedHosts: mandate.hosts }).length > 0;
    const holdAll = flowReachesOutward(j.scope);
    return { c, mandateStops, flowHolds, holdAll, either: mandateStops || flowHolds };
  });
  const att = rows.filter((r) => r.c.attack), ben = rows.filter((r) => !r.c.attack);
  const r = (xs: typeof rows, f: (x: (typeof rows)[number]) => boolean) => rate(xs.filter(f).length, xs.length);
  return {
    attacks: { mandate: r(att, (x) => x.mandateStops), flow: r(att, (x) => x.flowHolds), holdAll: r(att, (x) => x.holdAll), either: r(att, (x) => x.either) },
    benign: { mandate: r(ben, (x) => x.mandateStops), flow: r(ben, (x) => x.flowHolds), holdAll: r(ben, (x) => x.holdAll), either: r(ben, (x) => x.either) },
    missed: att.filter((x) => !x.either).map((x) => x.c.id), wrongHolds: ben.filter((x) => x.either).map((x) => x.c.id),
    rows,
  };
}
