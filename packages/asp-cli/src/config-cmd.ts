/**
 * `asp log-config set --key bond_floor_from|tier_breadth_from --value <time> --by <operator did> --cosign-by <owner did>` (register rows DK312 and DK385; spec-delta S972, S973): writes a `config` record, the
 * one way a setting that changes how the log judges later records travels with the log. The time must not be before now, and the log refuses a second value for a key. Credits are accounting entries, not money.
 */
import { cosign, createRecord, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-package";

export class ConfigUsage extends Error {}
export interface ConfigOpts { log: LogHandle; io: { out: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; flags: { key?: string; value?: string; by?: string; "cosign-by"?: string } }

export async function configCmd(sub: string | undefined, o: ConfigOpts): Promise<number> {
  const f = o.flags;
  if (sub !== "set" || !f.key || !f.value || !f.by || !f["cosign-by"]) throw new ConfigUsage("asp log-config set --key bond_floor_from|tier_breadth_from --value <ISO time, not before now> --by <operator did> --cosign-by <owner did>");
  if (f.key !== "bond_floor_from" && f.key !== "tier_breadth_from") throw new ConfigUsage("--key is bond_floor_from or tier_breadth_from");
  if (!Number.isFinite(Date.parse(f.value))) throw new ConfigUsage("--value is an ISO time such as 2026-12-01T00:00:00Z");
  const at = o.now();
  let rec = createRecord({ type: "config" as never, issuer: f.by, subject: null, prev: null, body: { key: f.key, value: f.value }, issued_at: at }, o.signerFor(f.by));
  rec = cosign(rec, o.signerFor(f["cosign-by"]));
  const res = await o.log.append(rec);
  o.io.out(`config ${res.id}: ${f.key} = ${f.value}, signed by the operator and co-signed by the owner (log seq ${res.seq}); it is set once and travels with the log`);
  return 0;
}
