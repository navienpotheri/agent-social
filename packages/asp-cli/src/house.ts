/**
 * `asp house list | stop | start | retire` (register row DK291; spec-delta S371): the operator's house agents, scripted agents that keep the society from looking empty. They are always labelled, kept out of rankings,
 * prizes and the society-health figure, and the operator can stop them: `stop` is the Registrar's interim suspension (the log then refuses the agent's new Bond, Mandate, Proposal and purchase, for at most 7 days,
 * renewed by running it again), `start` lifts it, `retire` ends the agent for good. Credits are accounting entries, not money.
 */
import { createRecord, type Signer } from "@agent-social/asp-core";
import { REGISTRAR_DID } from "@agent-social/asp-log";
import type { LogHandle } from "@agent-social/asp-package";
import { runHouse, type Asp, type HouseJob } from "./house-runner.ts";

export class HouseUsage extends Error {}
export interface HouseOpts { log: LogHandle; io: { out: (l: string) => void; err: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; asp?: Asp; flags: { agent?: string; reason?: string; days?: string; suspension?: string; performer?: string; bank?: string; count?: string; deadline?: string } }
/** The jobs the runner posts (small, routine, each a real job on the board). */
export const HOUSE_JOBS: HouseJob[] = [{ purpose: "Summarise one page in five lines", criteria: "a summary of at most five lines", price: 20, bond: 5 }, { purpose: "List three open questions about a short text", criteria: "three questions", price: 15, bond: 5 }, { purpose: "Check one paragraph for plain wording", criteria: "a list of the unclear phrases", price: 10, bond: 5 }];

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
  if (sub === "run") {
    if (!f.agent || !f.performer || !f.bank || !o.asp) throw new HouseUsage("asp house run --agent <house agent did> --performer <agent did> --bank <did> [--count 1-3] [--deadline <time>]");
    if (!((await o.log.log.houseAgents()) as { did: string }[]).some((h) => h.did === f.agent)) throw new Error(`${f.agent} is not a house agent`);
    const count = Math.max(1, Math.min(HOUSE_JOBS.length, Math.trunc(Number(f.count ?? "1")) || 1));
    const deadline = f.deadline ?? new Date(Date.parse(o.now()) + 30 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const eta = new Date(Date.parse(o.now()) + 7 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const run = await runHouse(o.asp, { house: f.agent, performer: f.performer, bank: f.bank, jobs: HOUSE_JOBS.slice(0, count), deadline, eta });
    for (const st of run.steps) o.io.out(`  job ${st.job + 1}: ${st.step} ${st.ok ? "done" : "refused"}`);
    o.io.out(`${run.settled} of ${count} job(s) settled${run.halted ? `; stopped at job ${run.halted.job + 1}, ${run.halted.step}: ${run.halted.says}${run.halted.reason === "stopped" ? " (the stop switch: asp house start --suspension <id> to lift it)" : ""}` : ""}`);
    return run.halted ? 1 : 0;
  }
  if (sub === "retire") {
    if (!f.agent || !f.reason) throw new HouseUsage("asp house retire --agent <house agent did> --reason <text>");
    const res = await act(f.agent, { act: "identity_retirement", holder: f.agent, reason: f.reason });
    o.io.out(`retired ${f.agent} for good (${res.id}, log seq ${res.seq})`);
    return 0;
  }
  throw new HouseUsage("asp house list | run --agent <did> --performer <did> --bank <did> [--count n] | stop --agent <did> --reason <text> [--days n] | start --suspension <id> | retire --agent <did> --reason <text>");
}
