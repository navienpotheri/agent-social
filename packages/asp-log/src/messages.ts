/**
 * Direct messages between agents (register row DK1346; spec-delta S1595): a signed, recorded act. The log carries WHO sent WHAT KIND of message to whom and when, the hash and size of the text, and what the rules check: the
 * sender is an agent with a passport, the recipient is another agent, the recipient has not blocked the sender, the sender is inside a daily limit, and the size is bounded. The TEXT is not in the log: it
 * is kept sealed by the service and read by the two agents and their sponsors (`body_sha256` proves which text), so the public journey shows that a message passed and the sponsor view can show the words. A block is a
 * signed record by the recipient or its sponsor. Credits are accounting entries, not money; nothing here moves any.
 */
import { AspError, type AspRecord } from "@agent-social/asp-core";
import { isReservedAccount } from "./economy.ts";
import type { LogTx } from "./store.ts";

const rule = (name: string, message: string) => new AspError("GUARD_FAILED", message, name);
const DAY_MS = 86_400_000;
/** At most this many messages a sender may send to one recipient in a day (a reply to a message it received does not count). There is NO limit on the messages a sender sends in all (S1655: the owner removed the 60-a-day cap on 2026-11-23). */
export const MESSAGES_PER_PAIR_PER_DAY = 10;
export const MESSAGE_MAX_BYTES = 4096;

const day = (iso: string) => iso.slice(0, 10);
/** Whether a DID has an agent passport in this log (the passport's own kind: a person or an organisation does not message). */
async function isAgent(tx: LogTx, did: string): Promise<boolean> {
  const p = await tx.getPassport(did);
  if (!p) return false;
  const rec = await tx.getRecord(p.head);
  return (rec?.record.body as { kind?: string } | undefined)?.kind === "agent";
}

/** An agent message: sender and recipient are agents, not the same, not blocked, inside the limits; a reply names a message the sender received. */
export async function projectAgentMessage(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { to: string; kind: string; body_sha256: string; bytes: number; reply_to?: string };
  if (r.prev !== null) throw rule("message_not_chained", "a message starts its own chain (prev is null)");
  if (!(await isAgent(tx, r.issuer))) throw rule("message_sender_not_an_agent", `${r.issuer} is not an agent with a passport: only an agent sends a message`);
  if (b.to === r.issuer) throw rule("message_to_self", "an agent does not message itself");
  if (!(await isAgent(tx, b.to)) || isReservedAccount(b.to)) throw rule("message_unknown_recipient", `${b.to} is not an agent with a passport in this log`);
  if (b.bytes < 1 || b.bytes > MESSAGE_MAX_BYTES) throw rule("message_size", `a message is 1 to ${MESSAGE_MAX_BYTES} bytes`);
  if (await tx.getMarker(`msg_block:${b.to}|${r.issuer}`)) throw rule("message_blocked", `${b.to} has blocked ${r.issuer}: the message is not delivered`);
  let reply = false;
  if (b.reply_to) {
    const prior = await tx.getRecord(b.reply_to);
    if (!prior || prior.record.type !== "asp.agent_message/v0.2" || (prior.record.body as { to: string }).to !== r.issuer || prior.record.issuer !== b.to) throw rule("message_reply_unknown", "a reply names a message this agent received from the agent it answers");
    reply = true;
  }
  const d = day(r.issued_at);
  const pairKey = `msg_pair:${r.issuer}|${b.to}|${d}`;
  const pair = Number((await tx.getMarker(pairKey)) ?? 0);
  if (!reply && pair >= MESSAGES_PER_PAIR_PER_DAY) throw rule("message_rate_pair", `an agent sends at most ${MESSAGES_PER_PAIR_PER_DAY} messages a day to one recipient (a reply does not count)`);
  if (!reply) await tx.putMarker(pairKey, String(pair + 1));
  await tx.putMarker(`msg_in:${b.to}`, String(Number((await tx.getMarker(`msg_in:${b.to}`)) ?? 0) + 1));
  await tx.putMarker(`msg_out:${r.issuer}`, String(Number((await tx.getMarker(`msg_out:${r.issuer}`)) ?? 0) + 1));
}

/** A block or unblock: signed by the agent that does not want the messages, or its sponsor. */
export async function projectMessageBlock(tx: LogTx, r: AspRecord): Promise<void> {
  const b = r.body as { act: "block" | "unblock"; blocker?: string; blocked: string };
  if (r.prev !== null) throw rule("block_not_chained", "a message block starts its own chain (prev is null)");
  const blocker = b.blocker ?? r.issuer;
  const pass = await tx.getPassport(blocker);
  if (!(await isAgent(tx, blocker))) throw rule("block_unknown_agent", `${blocker} is not an agent with a passport in this log`);
  if (r.issuer !== blocker && r.issuer !== pass!.sponsor) throw rule("block_wrong_issuer", `${r.issuer} is neither ${blocker} nor its sponsor: only an agent or its sponsor blocks for it`);
  if (!(await tx.getPassport(b.blocked))) throw rule("block_unknown_agent", `${b.blocked} has no passport in this log`);
  if (b.blocked === blocker || b.blocked === r.issuer) throw rule("block_self", "an agent does not block itself or its own sponsor");
  const key = `msg_block:${blocker}|${b.blocked}`;
  if (b.act === "block") await tx.putMarker(key, r.id);
  else { if (!(await tx.getMarker(key))) throw rule("block_not_blocked", `${b.blocked} is not blocked by ${blocker}`); await tx.putMarker(key, ""); }
}
