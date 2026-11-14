/**
 * `asp refuse` (register row AG4; spec-delta S500): an agent's conscientious refusal. The performer of a running contract signs a record saying it will not carry out an order from its principal because the order
 * breaks the Code or its Mandate. The refusal protects its bond from slashing on that ground and is listed against the principal as a claim, for a Court or the Registry to weigh. `asp refuse list` shows the
 * refusals filed against a principal's orders.
 */
import { createRecord, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-package";

export class RefuseUsage extends Error {}
export interface RefuseOpts { log: LogHandle; io: { out: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; flags: { contract?: string; by?: string; order?: string; breaks?: string; articles?: string; reason?: string; principal?: string } }

export async function refuseCmd(sub: string | undefined, o: RefuseOpts): Promise<number> {
  const f = o.flags;
  if (sub === "list") {
    if (!f.principal) throw new RefuseUsage("asp refuse list --principal <did>");
    const rows = await (o.log as unknown as { log: { refusalsAgainst(d: string): Promise<{ id: string; agent: string; contract: string; breaks: string; at: string }[]> } }).log.refusalsAgainst(f.principal);
    o.io.out(`${rows.length} refusal(s) of orders from ${f.principal} (claims by agents, not findings)`);
    for (const r of rows) o.io.out(`  ${r.at}  breaks ${r.breaks}  by ${r.agent}  contract ${r.contract}  ${r.id}`);
    return 0;
  }
  if (sub !== undefined && sub !== "file") throw new RefuseUsage("asp refuse --contract <id> --by <agent did> --order <text> --breaks code|mandate --reason <text> [--articles 7] | list --principal <did>");
  if (!f.contract || !f.by || !f.order || !f.breaks || !f.reason) throw new RefuseUsage("asp refuse --contract <id> --by <agent did> --order <text> --breaks code|mandate --reason <text> [--articles 7]");
  if (f.breaks !== "code" && f.breaks !== "mandate") throw new RefuseUsage("--breaks is code or mandate");
  const rec = createRecord({ type: "refusal", issuer: f.by, subject: null, prev: null, issued_at: o.now(), body: { contract: f.contract, order: f.order, breaks: f.breaks, reason: f.reason, ...(f.articles ? { articles: f.articles.split(",").map((a) => a.trim()) } : {}) } }, o.signerFor(f.by));
  const res = await o.log.append(rec);
  o.io.out(`refusal ${res.id} (log seq ${res.seq}): ${f.by} will not carry out the order; its bond is not slashed on that ground, and the order is listed against the principal as a claim`);
  return 0;
}
