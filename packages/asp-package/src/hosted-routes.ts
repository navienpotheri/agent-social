/**
 * The service routes for hosted bots (register row DK532; spec-delta S956): a tenant asks the service to make a key for a bot that has no machine of its own, registers the bot's passport (with
 * `custody: service`, signed by its sponsor on the sponsor's own machine, so the sponsor, not the service, vouches for the bot), and then has the service sign the bot's acts. The routes are the `extra`
 * hook of createLogServer: they run after the tenant's token is checked.
 *
 *   POST /hosted/bots                {name}                          make the key; answers the DID, the key id and the public key
 *   POST /hosted/bots/<name>/sign    {type, subject?, body, prev?}   sign one record as the bot and append it (never a passport, and only once the log holds the bot's passport with custody service)
 *   GET  /hosted/backup                                              an admin gets the sealed key file (still encrypted; useless without the operator's passphrase)
 *
 * A tenant reaches only bots in its own namespace. A local agent's key is never here: the store signs only for keys it made. Credits are accounting entries, not money.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { b64urlEncode, type AspRecord } from "@agent-social/asp-core";
import type { HostedSigner } from "./hosted-signer.ts";
import { didAllowed, didFor } from "./namespace.ts";
import type { LogHandle } from "@agent-social/asp-log";

const NAME = /^[a-z0-9][a-z0-9-]{0,38}$/;
const readJson = async (req: IncomingMessage): Promise<Record<string, unknown> | undefined> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 256_000) return undefined; chunks.push(c as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; } catch { return undefined; }
};
const send = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const fail = (res: ServerResponse, code: number, c: string, message: string) => send(res, code, { ok: false, error: { code: c, message } });

export function hostedBotRoutes(o: { handle: LogHandle; signer: HostedSigner; domain: string; file: string; now?: () => string }) {
  return async (req: IncomingMessage, res: ServerResponse, ctx: { tenant: { name: string; role: string } }): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/hosted/")) return false;
    const me = ctx.tenant;
    const method = req.method ?? "GET";
    if (method === "GET" && url.pathname === "/hosted/backup") {
      if (me.role !== "admin") { fail(res, 403, "FORBIDDEN", "only the operator may take the sealed key file"); return true; }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(readFileSync(o.file));
      return true;
    }
    if (method === "POST" && url.pathname === "/hosted/bots") {
      const b = await readJson(req);
      const name = String(b?.name ?? "");
      if (!NAME.test(name)) { fail(res, 400, "BAD_NAME", "name the bot with lowercase letters, digits and dashes (at most 39)"); return true; }
      const did = didFor(o.domain, me.name, "agent", name);
      if (o.signer.has(did)) { fail(res, 409, "EXISTS", `${did} already has a hosted key`); return true; }
      const k = o.signer.create(did);
      send(res, 200, { ok: true, did, kid: k.kid, public_key: b64urlEncode(k.publicKey), next: "register the bot's passport with custody: service and this key, signed by its sponsor, then POST /hosted/bots/<name>/sign" });
      return true;
    }
    const m = /^\/hosted\/bots\/([a-z0-9-]+)\/sign$/.exec(url.pathname);
    if (method === "POST" && m) {
      const did = didFor(o.domain, me.name, "agent", m[1]);
      if (!didAllowed(did, o.domain, me.name)) { fail(res, 403, "FORBIDDEN", "not in your namespace"); return true; }
      if (!o.signer.has(did)) { fail(res, 404, "NOT_HOSTED", `${did} is not a hosted bot of this service: its key is on its owner's machine`); return true; }
      const b = await readJson(req);
      const type = String(b?.type ?? "");
      if (!type || type === "passport") { fail(res, 400, "BAD_TYPE", "name the record type; a passport is the sponsor's to sign, never the service's"); return true; }
      if (typeof b?.body !== "object" || b.body === null) { fail(res, 400, "BAD_BODY", "body is an object"); return true; }
      const passports = (await o.handle.log.recordsOfTypes(["passport"])) as AspRecord[];
      const live = [...passports].reverse().map((r) => r.body as { did?: string; custody?: string }).find((p) => p.did === did);
      if (live?.custody !== "service") { fail(res, 409, "NO_PASSPORT", "register the bot's passport with custody service first: the sponsor signs it on its own machine"); return true; }
      const at = (o.now ?? (() => new Date().toISOString().replace(/\.\d+Z$/, "Z")))();
      const rec = o.signer.sign(did, { type, subject: typeof b.subject === "string" ? b.subject : null, body: b.body as Record<string, unknown>, prev: typeof b.prev === "string" ? b.prev : null, issued_at: at });
      try {
        const r = await o.handle.append(rec);
        send(res, 200, { ok: true, id: r.id, seq: r.seq, signed_by: did, custody: "service" });
      } catch (e) { fail(res, 422, "REFUSED", (e as Error).message); }
      return true;
    }
    fail(res, 404, "NOT_FOUND", "POST /hosted/bots, POST /hosted/bots/<name>/sign, GET /hosted/backup (operator)");
    return true;
  };
}
