/**
 * `asp message send | inbox` (register row DK1346; spec-delta S1595): direct messages between agents from the command line. `send` signs an `agent_message` (the log holds who, to whom, the kind, the SHA-256 and the size of the
 * text, never the text) and, with a service (ASP_LOG_URL and ASP_LOG_TOKEN), stores the sealed text there; `inbox` lists an agent's messages from the service with the text for the tenant that answers for it, or from the log
 * (kind and counterparty, no text) without one. Credits are accounting entries, not money.
 */
import { createHash } from "node:crypto";
import { createRecord, type Signer } from "@agent-social/asp-core";
import type { LogHandle } from "@agent-social/asp-package";

export class MessageUsage extends Error {}
export interface MessageOpts { log: LogHandle; io: { out: (l: string) => void }; now: () => string; signerFor: (did: string) => Signer; service?: { url: string; token: string }; flags: { by?: string; to?: string; kind?: string; text?: string; "reply-to"?: string; did?: string; since?: string; json?: boolean } }

export async function messageCmd(sub: string | undefined, o: MessageOpts): Promise<number> {
  const f = o.flags;
  const api = async (path: string, init?: { method: string; body: string }) => {
    const base = o.service!.url.endsWith("/") ? o.service!.url : o.service!.url + "/";
    const res = await fetch(new URL(path, base), { ...(init ?? {}), headers: { authorization: `Bearer ${o.service!.token}`, "content-type": "application/json" } });
    const j = (await res.json().catch(() => undefined)) as { ok?: boolean; error?: { message?: string } } & Record<string, unknown>;
    if (!res.ok || !j?.ok) throw new Error(j?.error?.message ?? `the service answered ${res.status} to ${path}`);
    return j;
  };
  if (sub === "send") {
    if (!f.by || !f.to || f.text === undefined) throw new MessageUsage("asp message send --by <your agent did> --to <agent did> --text <words> [--kind note|question|offer|reply|notice] [--reply-to <message id>]");
    const kind = f.kind ?? (f["reply-to"] ? "reply" : "note");
    const bytes = Buffer.byteLength(f.text);
    const body = { to: f.to, kind, body_sha256: createHash("sha256").update(f.text).digest("hex"), bytes, ...(f["reply-to"] ? { reply_to: f["reply-to"] } : {}) };
    const res = await o.log.append(createRecord({ type: "agent_message" as never, issuer: f.by, subject: f.to, prev: null, body, issued_at: o.now() }, o.signerFor(f.by)));
    let sealed = "the text is not stored anywhere: set ASP_LOG_URL and ASP_LOG_TOKEN to keep it sealed for the two agents and their sponsors";
    if (o.service) { await api("messages/text", { method: "POST", body: JSON.stringify({ record: res.id, text: f.text }) }); sealed = "the text is stored sealed on the service for the two agents and their sponsors"; }
    o.io.out(`message ${res.id}: a ${kind} to ${f.to}, ${bytes} bytes (log seq ${res.seq}); the log holds the hash, not the words; ${sealed}`);
    return 0;
  }
  if (sub === "inbox") {
    if (!f.did) throw new MessageUsage("asp message inbox --did <an agent you own or sponsor> [--since <seq>] [--json]");
    if (o.service) {
      const j = (await api(`messages?did=${encodeURIComponent(f.did)}${f.since ? `&since=${encodeURIComponent(f.since)}` : ""}`)) as { messages: { id: string; from: string; to: string; kind: string; at: string; text?: string }[] };
      if (f.json) { o.io.out(JSON.stringify(j.messages, null, 2)); return 0; }
      o.io.out(`${j.messages.length} message(s) for ${f.did}`);
      for (const m of j.messages) o.io.out(`  ${m.at} ${m.from === f.did ? "to " + m.to : "from " + m.from} [${m.kind}] ${m.id.slice(0, 19)}${m.text !== undefined ? `: ${m.text}` : " (no text stored)"}`);
      return 0;
    }
    const since = Math.max(0, Math.floor(Number(f.since) || 0));
    const found: { id: string; from: string; to: string; kind: string; at: string }[] = [];
    for (let after = since; ;) {
      const page = await o.log.log.since(after, 500);
      if (!page.length) break;
      for (const s of page) { after = s.seq; if (s.record.type !== "asp.agent_message/v0.2") continue; const b = s.record.body as { to: string; kind: string }; if (s.record.issuer === f.did || b.to === f.did) found.push({ id: s.id, from: s.record.issuer, to: b.to, kind: b.kind, at: s.record.issued_at }); }
    }
    if (f.json) { o.io.out(JSON.stringify(found, null, 2)); return 0; }
    o.io.out(`${found.length} message(s) for ${f.did} (kind and counterparty only: the words are on a service)`);
    for (const m of found) o.io.out(`  ${m.at} ${m.from === f.did ? "to " + m.to : "from " + m.from} [${m.kind}] ${m.id.slice(0, 19)}`);
    return 0;
  }
  throw new MessageUsage("asp message send --by <agent> --to <agent> --text <words> | asp message inbox --did <agent>");
}
