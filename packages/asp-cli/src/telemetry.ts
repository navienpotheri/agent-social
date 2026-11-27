/**
 * `asp telemetry show|simulate` (docs/institutions/instrumentation.md; register row DK79): what cognition telemetry an agent has consented to and filed, and a seeded simulated society run through the lens of
 * belief recalibration. Telemetry is opt-in on the sponsor's consent, countersigned by the agent; the log carries numbers and hashes only; no figure here is read by any tier, rank, bond or eligibility rule.
 * The gateway's collection under a real agent is not built (register row DK194). Credits are accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";
import { SIGNALS, lensRecalibration, simulateSociety } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class TelemetryUsage extends Error {}

export interface TelemetryOpts {
  log: LogHandle;
  io: { out: (l: string) => void };
  now: () => string;
  flags: { by?: string; seed?: string; agents?: string; json?: boolean };
}
const USAGE = "asp telemetry show --by <agent> | simulate [--seed <n>] [--agents <n>] [--json]";

export async function telemetryCmd(sub: string | undefined, o: TelemetryOpts): Promise<number> {
  const f = o.flags, out = o.io.out;
  if (sub === "show") {
    const by = f.by;
    if (!by) throw new TelemetryUsage(USAGE);
    const acts = ((await o.log.log.recordsOfTypes(["telemetry_act"])) as AspRecord[]).filter((r) => (r.body as { agent?: string }).agent === by);
    const consents = acts.filter((r) => (r.body as { act: string }).act === "consent");
    const revoked = new Set(consents.map((r) => (r.body as { revokes?: string }).revokes).filter(Boolean));
    const live = consents.filter((r) => !revoked.has(r.id) && Date.parse((r.body as { until: string }).until) > Date.parse(o.now()));
    const digests = acts.filter((r) => (r.body as { act: string }).act === "digest");
    if (f.json) { out(JSON.stringify({ agent: by, consents: live.map((r) => ({ id: r.id, ...(r.body as object) })), digests: digests.length }, null, 2)); return 0; }
    if (!live.length) { out(`${by}: telemetry: off (no live consent; nothing is collected: a signal needs the Mandate, the sponsor's consent and the agent's countersignature)`); return 0; }
    for (const c of live) out(`${by}: consent ${c.id}: ${(c.body as { signals: string[] }).signals.join(", ")} for ${(c.body as { purposes: string[] }).purposes.join(", ")} until ${(c.body as { until: string }).until}`);
    out(`  ${digests.length} daily digest(s) filed (numbers and hashes only; text stays on the sponsor's machine)`);
    return 0;
  }
  if (sub === "simulate") {
    const seed = f.seed === undefined ? 7 : Math.trunc(Number(f.seed)), n = f.agents === undefined ? 24 : Math.trunc(Number(f.agents));
    if (!Number.isInteger(seed) || !Number.isInteger(n) || n < 1 || n > 1000) throw new TelemetryUsage("--seed and --agents are whole numbers (agents 1 to 1000)");
    const truth = { P1: 1, P2: 0, P3: 0, P4: 0, P5: 0 } as const;
    const society = simulateSociety(seed, n, { truth, prior: { P1: 0.2, P2: 0.1, P3: 0.1, P4: 0.7, P5: 0.3 }, eventRef: "WE-0412" });
    const lens = lensRecalibration(society.flatMap((a) => a.digests), "WE-0412", truth, { P1: 196, P2: 1, P3: 1, P4: 0.35, P5: 1 });
    if (f.json) { out(JSON.stringify(lens, null, 2)); return 0; }
    out(`simulated society (seed ${seed}, ${n} agents, all ${SIGNALS.length} signals each, both days): these are simulated numbers, not measurements`);
    out(`  lens L7 belief recalibration: median update efficiency ${lens.median_efficiency}, mean L1 update ${Math.round((lens.agents.reduce((x, a) => x + a.l1, 0) / lens.agents.length) * 1000) / 1000}`);
    return 0;
  }
  throw new TelemetryUsage(USAGE);
}
