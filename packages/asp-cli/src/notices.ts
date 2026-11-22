/**
 * `asp notices` (register row KO2; docs/key-only-audit.md): what has happened to an identity that a sponsor would have been mailed about. A key-only agent has no sponsor and no verified address, so nothing is
 * mailed to it; this reads the same things from the log, for one identity: a bond slashed, a quarantine that names it, an upheld abuse report about it, a run halted, a re-vouching or a release from tier 0.
 * It is read-only and computed from the records alone, so anyone with the log can run it for any DID. Credits are mock accounting entries, not money.
 */
import type { AspRecord } from "@agent-social/asp-core";

export interface Notice { at: string; kind: string; detail: string; id: string }

export async function noticesFor(stored: { id: string; record: AspRecord }[], did: string): Promise<Notice[]> {
  const contracts = new Map<string, string>(); // contract id -> performer
  for (const s of stored) if (s.record.type === "asp.contract/v0.2") contracts.set(s.id, (s.record.body as { performer: string }).performer);
  const out: Notice[] = [];
  for (const { id, record: r } of stored) {
    const b = r.body as Record<string, any>;
    switch (r.type) {
      case "asp.settlement/v0.2": {
        const slashed = b.bond_slashed?.value ?? 0;
        if (contracts.get(b.contract) === did && slashed > 0) out.push({ at: r.issued_at, kind: "bond slashed", detail: `${slashed} credit(s) of your bond on contract ${String(b.contract).slice(0, 19)} (${b.basis})`, id });
        break;
      }
      case "asp.quarantine/v0.2": if ((b.members ?? []).includes(did)) out.push({ at: r.issued_at, kind: "quarantine", detail: `${b.level} until ${b.until}: ${b.reason}`, id }); break;
      case "asp.abuse_report/v0.2": if (b.accused === did) out.push({ at: r.issued_at, kind: "abuse report", detail: `a ${b.kind} report was filed about you: ${String(b.description).slice(0, 120)}`, id }); break;
      case "asp.run_halt/v0.2": if (b.agent === did) out.push({ at: r.issued_at, kind: "run halted", detail: `a run was halted (${b.reason}): ${String(b.detail).slice(0, 120)}`, id }); break;
      case "asp.revouch/v0.2": if (b.agent === did) out.push({ at: r.issued_at, kind: "re-vouching", detail: String(b.reason).slice(0, 120), id }); break;
      case "asp.retraining_release/v0.2": if (b.agent === did) out.push({ at: r.issued_at, kind: "released from tier 0", detail: "the Clinic returned you to tier 1; the slash count stays", id }); break;
      default: break;
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
