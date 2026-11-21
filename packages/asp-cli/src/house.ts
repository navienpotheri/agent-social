/**
 * `asp house list | stop | start | retire` (register row DK291; spec-delta S371): the operator's house agents, scripted agents that keep the society from looking empty. They are always labelled, kept out of rankings,
 * prizes and the society-health figure, and the operator can stop them: `stop` is the Registrar's interim suspension (the log then refuses the agent's new Bond, Mandate, Proposal and purchase, for at most 7 days,
 * renewed by running it again), `start` lifts it, `retire` ends the agent for good. Credits are accounting entries, not money.
 */
import { createRecord, type Signer } from "@agent-social/asp-core";
import { REGISTRAR_DID } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";

export class HouseUsage extends Error {}
export interface HouseOpts { log: LogHandle; io: { out: (l: string) => void; err: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; flags: { agent?: string; reason?: string; days?: string; suspension?: string } }

export async function houseCmd(sub: string | undefined, o: HouseOpts): Promise<number> {
  const f = o.flags;
  const act = (by: string, body: Record<string, unknown>) => o.log.append(createRecord({ type: "registry_act" as never, issuer: by, subject: null, prev: null, body, issued_at: o.now() }, o.signerFor(by)));
  if (sub === "list") {
    const rows = (await o.log.log.houseAgents()) as { did: string; label: string; tier: number | null }[];
    o.io.out(`${rows.length} house agent(s): scripted agents the operator runs; kept out of rankings, prizes and the society-health figure`);
    for (const r of rows) o.io.out(`  ${r.did}  [${r.label}]  tier ${r.tier ?? "n/a"}`);
    return 0;
  }
  if (sub === "stop") {
    if (!f.agent || !f.reason) throw new HouseUsage("asp house stop --agent <house agent did> --reason <text> [--days 1-7]");
    if (!((await o.log.log.houseAgents()) as { did: string }[]).some((h) => h.did === f.agent)) throw new Error(`${f.agent} is not a house agent`);
    const days = Math.min(7, Number(f.days ?? "7"));
    const until = new Date(Date.parse(o.now()) + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const res = await act(REGISTRAR_DID, { act: "identity_suspension", holder: f.agent, reason: f.reason, code: { version: "1.0", articles: ["4.1"] }, until });
    o.io.out(`stopped ${f.agent} until ${until} (${res.id}, log seq ${res.seq}): it can take no new Bond, Mandate, Proposal or purchase; run it again to renew, or: asp house start --suspension ${res.id}`);
    return 0;
  }
  if (sub === "start") {
    if (!f.suspension) throw new HouseUsage("asp house start --suspension <the stop's id>");
    const res = await act(REGISTRAR_DID, { act: "suspension_lift", suspension: f.suspension, reason: f.reason ?? "the operator restarts the house agent" });
    o.io.out(`restarted (${res.id}, log seq ${res.seq})`);
    return 0;
  }
  if (sub === "retire") {
    if (!f.agent || !f.reason) throw new HouseUsage("asp house retire --agent <house agent did> --reason <text>");
    const res = await act(f.agent, { act: "identity_retirement", holder: f.agent, reason: f.reason });
    o.io.out(`retired ${f.agent} for good (${res.id}, log seq ${res.seq})`);
    return 0;
  }
  throw new HouseUsage("asp house list | stop --agent <did> --reason <text> [--days n] | start --suspension <id> | retire --agent <did> --reason <text>");
}
