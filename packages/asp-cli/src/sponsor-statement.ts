/**
 * A sponsor's monthly statement for one agent, read from the real log (register row DK1225; DK837 built the statement over a scripted ledger). The ledger is the agent's own balance as the log's rules moved it: every
 * record that changed the balance is an entry (a replay of the log, so no credit rule is copied here), chained so that altering an entry fails verification; a refund is earned back, a purchase is spent. The services
 * hired and the disputes are counted from the agent's own purchases and from the rulings on its contracts. Held-out gains per course and the bond floor's history are not in the log as figures a statement can read,
 * so they are empty and null and the statement says so. Credits are accounting entries, not money.
 */
import { ledgerChain as chain, statementFor, verifyStatement, type LedgerEntry, type StatementRecords as Records, type SponsorStatement as Statement } from "@agent-social/asp-package";

export interface StatementSource {
  accountLedger(did: string): Promise<{ at: string; delta: number; record: string; type: string }[]>;
  recordsOfTypes(types: string[]): Promise<{ id: string; type: string; issuer: string; issued_at: string; subject?: string | null; body: unknown }[]>;
  passport(did: string): Promise<{ head: string } | undefined | null>;
}

export interface BuiltStatement { statement: Statement; ledger: LedgerEntry[]; records: Records; verification: ReturnType<typeof verifyStatement> }

export async function buildStatement(log: StatementSource, agent: string, month: string): Promise<BuiltStatement> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("a month is YYYY-MM, like 2026-11");
  const entries = (await log.accountLedger(agent)).map((e) => ({ at: e.at, kind: (e.delta > 0 ? (e.type === "receipt" ? "refund" : "earn") : "spend") as LedgerEntry["kind"], amount: Math.abs(e.delta), ref: e.record }));
  const ledger = chain(entries);
  const recs = await log.recordsOfTypes(["purchase", "attestation", "contract"]);
  const services = recs.filter((r) => r.type === "asp.purchase/v0.2" && r.issuer === agent).map((r) => { const b = r.body as { service: string; amount: { value: number } }; return { at: r.issued_at, service: b.service, price: b.amount.value }; });
  const parties = new Map(recs.filter((r) => r.type === "asp.contract/v0.2").map((r) => [r.id, r.body as { principal: string; performer: string }]));
  const disputes = recs.filter((r) => r.type === "asp.attestation/v0.2" && (r.body as { kind?: string }).kind === "ruling" && r.subject && parties.has(r.subject)).flatMap((r) => {
    const c = parties.get(r.subject!)!;
    if (c.performer !== agent && c.principal !== agent) return [];
    const fault = (r.body as { fault?: Record<string, number> }).fault ?? {};
    const mine = fault[agent] ?? 0, others = Object.entries(fault).filter(([k]) => k !== agent).reduce((n, [, v]) => n + v, 0);
    return [{ id: r.id, at: r.issued_at, outcome: (mine > others ? "lost" : mine < others ? "won" : "split") as "won" | "lost" | "split" }];
  });
  const records: Records = { courses: [], floors: [], disputes, services, portableRecord: (await log.passport(agent))?.head ?? "" };
  const statement = statementFor(month, ledger, records);
  return { statement, ledger, records, verification: verifyStatement(statement, ledger, records) };
}
