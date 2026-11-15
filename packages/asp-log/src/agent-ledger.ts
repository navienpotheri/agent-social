/**
 * What the log holds about an agent's earnings and certificates, kept as small markers written where they happen (register row DK203): the credits a settlement paid the agent, the certificates issued to it
 * and the ones revoked. A dispatch snapshots them (`dispatch_base:<id>`); the handback that closes it is checked against the difference, so the record a host hands back cannot say more or less than the ledger.
 * Credits are accounting entries, not money.
 */
import type { LogTx } from "./store.ts";

export const earnedKey = (agent: string) => `earned:${agent}`;
export async function noteEarned(tx: LogTx, agent: string, amount: number): Promise<void> {
  if (!(amount > 0)) return;
  await tx.putMarker(earnedKey(agent), String(Number((await tx.getMarker(earnedKey(agent))) ?? 0) + amount));
}
export async function noteRevoked(tx: LogTx, holder: string, certificate: string): Promise<void> {
  const key = `certs_revoked_of:${holder}`;
  await tx.putMarker(key, [...((await tx.getMarker(key)) ?? "").split(",").filter(Boolean), certificate].join(","));
}

const list = async (tx: LogTx, key: string): Promise<string[]> => ((await tx.getMarker(key)) ?? "").split(",").filter(Boolean);

/** The agent's running totals now: credits earned, the certificates issued to it and the ones revoked, each in the order they happened. */
export async function ledgerNow(tx: LogTx, agent: string): Promise<{ earned: number; issued: string[]; revoked: string[] }> {
  return { earned: Number((await tx.getMarker(earnedKey(agent))) ?? 0), issued: await list(tx, `certs_of:${agent}`), revoked: await list(tx, `certs_revoked_of:${agent}`) };
}

/** What a dispatch started from, written when it is recorded. */
export async function snapshotDispatch(tx: LogTx, dispatch: string, agent: string): Promise<void> {
  const now = await ledgerNow(tx, agent);
  await tx.putMarker(`dispatch_base:${dispatch}`, JSON.stringify({ earned: now.earned, issued: now.issued.length, revoked: now.revoked.length }));
}

/** What the ledger says happened to the agent since the dispatch: the credits earned and the certificates gained and lost. A dispatch recorded before snapshots existed has none and is not checked. */
export async function ledgerSince(tx: LogTx, dispatch: string, agent: string): Promise<{ earned: number; gained: string[]; lost: string[] } | undefined> {
  const raw = await tx.getMarker(`dispatch_base:${dispatch}`);
  if (raw === undefined) return undefined;
  const base = JSON.parse(raw) as { earned: number; issued: number; revoked: number };
  const now = await ledgerNow(tx, agent);
  return { earned: now.earned - base.earned, gained: now.issued.slice(base.issued), lost: now.revoked.slice(base.revoked) };
}
