/**
 * Delivering mail (launch blocker 6, gaps E9 and E10): a transport that hands a built mail to a provider, the unsubscribe token, and the check of the provider's
 * bounce and complaint webhook. The mail itself is made by mail.ts; the service's mailer (service-mailer.ts) decides what to send, to whom and once.
 *
 * Resend (https://resend.com) is the provider: one HTTPS call to send, no library. Nothing is sent without a key; without one the mailer writes the mail to a folder
 * (FileTransport) so an operator can see exactly what would go out.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface OutMail { from: string; to: string; subject: string; text: string; html: string; headers?: Record<string, string> }
export interface MailTransport { send(mail: OutMail): Promise<{ id: string }> }

/** A failure the mailer may try again later (the provider is busy or down), as opposed to a refusal. */
export class RetryableMailError extends Error {}

export class ResendTransport implements MailTransport {
  private o: { apiKey: string; baseUrl?: string; fetch?: typeof fetch };
  constructor(o: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }) { this.o = o; }
  async send(m: OutMail): Promise<{ id: string }> {
    const f = this.o.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.o.baseUrl ?? "https://api.resend.com"}/emails`, {
        method: "POST", headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html, ...(m.headers ? { headers: m.headers } : {}) }),
      });
    } catch (e) { throw new RetryableMailError(`could not reach the mail provider: ${(e as Error).message}`); }
    const body = (await res.json().catch(() => undefined)) as { id?: string; message?: string } | undefined;
    if (res.status === 429 || res.status >= 500) throw new RetryableMailError(`the mail provider answered ${res.status}`);
    if (!res.ok || !body?.id) throw new Error(`the mail provider refused the mail (${res.status}): ${body?.message ?? "no reason given"}`);
    return { id: body.id };
  }
}

/** Writes each mail to a folder instead of sending it (no key yet, or a dry run). */
export class FileTransport implements MailTransport {
  private dir: string;
  private n = 0;
  constructor(dir: string) { this.dir = dir; }
  async send(m: OutMail): Promise<{ id: string }> {
    mkdirSync(this.dir, { recursive: true });
    const id = `file-${Date.now()}-${++this.n}`;
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(m, null, 2) + "\n");
    return { id };
  }
}

/** Collects mail in memory (tests). */
export class MemoryTransport implements MailTransport {
  sent: OutMail[] = [];
  async send(m: OutMail): Promise<{ id: string }> { this.sent.push(m); return { id: `mem-${this.sent.length}` }; }
}

// ---- unsubscribe: a token that proves a link was made by this service for this address, with no database ----

export const newMailSecret = () => randomBytes(32);
export function unsubscribeToken(email: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(`unsubscribe:${email.toLowerCase()}`).digest("base64url");
}
export function unsubscribeOk(email: string, token: string, secret: Buffer): boolean {
  const want = Buffer.from(unsubscribeToken(email, secret)), got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ---- the provider's webhook (Resend signs with Svix): bounces and complaints suppress an address ----

/** Checks a Svix signature: HMAC-SHA256 of "<id>.<timestamp>.<body>" with the secret (whsec_<base64>), within five minutes. */
export function verifySvix(headers: Record<string, string | string[] | undefined>, body: string, secret: string, nowMs: number = Date.now()): boolean {
  const h = (k: string) => String(Array.isArray(headers[k]) ? (headers[k] as string[])[0] : headers[k] ?? "");
  const id = h("svix-id"), ts = h("svix-timestamp"), sigs = h("svix-signature");
  if (!id || !ts || !sigs || !secret) return false;
  if (!Number.isFinite(Number(ts)) || Math.abs(nowMs / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const want = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return sigs.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && !!sig && sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  });
}
