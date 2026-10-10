/**
 * The service's mailer (launch blocker 6, gaps E9, E10, M10): the hosted service sends the mails the CLI used to only queue. On each pass it reads the log and sends, once each:
 *
 *   - the end-of-Mandate mail to the principal when a job settles (mail.ts: buildMandateMail),
 *   - an alert to the principal at once for a kill, an upheld report or an expired Mandate (buildAlertMail),
 *   - a note to the operator when a dispute opens, so a ruling does not wait unseen (the court is the operator's, S97).
 *
 * The recipient is the verified Google email of the tenant that wrote as the principal's identity; a principal with no such tenant gets nothing (the reason is kept).
 * Every mail carries an unsubscribe link and the List-Unsubscribe headers; a bounce or a complaint from the provider, or an unsubscribe, suppresses the address for good.
 * What was sent, skipped or suppressed is kept in a small file, so a restart sends nothing twice. A busy provider is retried on later passes, up to five times.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { OwnerStore, Tenant } from "@agent-social/asp-log";
import { buildAlertMail, buildMandateMail, collectMandateFacts, findAlerts, type MailLog } from "./mail.ts";
import { RetryableMailError, unsubscribeOk, unsubscribeToken, verifySvix, type MailTransport } from "./mail-send.ts";

export interface MailerOptions {
  log: MailLog & { get(id: string): Promise<{ record: { body: unknown } } | undefined>; since(after: number, limit?: number): Promise<any[]> };
  tenants: () => Tenant[];
  owners: OwnerStore;
  transport: MailTransport;
  /** "Agent Social <noreply@example.org>" */
  from: string;
  /** Where operator notes go (a dispute opened); omit to send none. */
  operatorTo?: string;
  /** The service's public address (read when a link is made), for the unsubscribe links. */
  publicUrl: () => string;
  secret: Buffer;
  /** Where what was sent is kept; without one it lives only as long as the process. */
  statePath?: string;
  /** Mails one pass may send (default 50) and the most to one address in an hour (default 10). */
  maxPerPass?: number;
  maxPerRecipientPerHour?: number;
  /** Where a run page lives, once there is one (blocker 5): the mail links to it. */
  linkBase?: string;
  now?: () => number;
  log2?: (line: string) => void;
}

interface State {
  sent: Record<string, { to: string; at: string; id: string }>;
  skipped: Record<string, string>;
  suppressed: Record<string, { reason: string; at: string }>;
  attempts: Record<string, number>;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class ServiceMailer {
  private o: MailerOptions;
  private state: State = { sent: {}, skipped: {}, suppressed: {}, attempts: {} };
  private running = false;
  private now: () => number;

  constructor(o: MailerOptions) {
    this.o = o;
    this.now = o.now ?? Date.now;
    if (o.statePath && existsSync(o.statePath)) { try { this.state = { ...this.state, ...JSON.parse(readFileSync(o.statePath, "utf8")) }; } catch { /* start again; the worst is an address mailed twice */ } }
  }

  private save() {
    if (!this.o.statePath) return;
    const tmp = this.o.statePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.state, null, 2) + "\n");
    renameSync(tmp, this.o.statePath);
  }
  private say(line: string) { this.o.log2?.(line); }

  isSuppressed(email: string): boolean { return !!this.state.suppressed[email.toLowerCase()]; }
  suppress(email: string, reason: string): void {
    this.state.suppressed[email.toLowerCase()] = { reason, at: new Date(this.now()).toISOString() };
    this.save();
  }
  counts() { return { sent: Object.keys(this.state.sent).length, skipped: Object.keys(this.state.skipped).length, suppressed: Object.keys(this.state.suppressed).length }; }
  unsubscribeUrl(email: string): string { return `${this.o.publicUrl().replace(/\/$/, "")}/mail/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubscribeToken(email, this.o.secret)}`; }
  verifyUnsubscribe(email: string, token: string): boolean { return unsubscribeOk(email, token, this.o.secret); }

  /** The verified email of the open tenant that wrote as this identity, if any. */
  recipientFor(did: string): string | undefined {
    for (const t of this.o.tenants()) {
      if (t.closed || t.role === "admin") continue;
      if (this.o.owners.of(t.name).includes(did) && t.signup?.google?.email) return t.signup.google.email;
    }
    return undefined;
  }

  private recentTo(email: string): number {
    const from = this.now() - 3_600_000;
    return Object.values(this.state.sent).filter((s) => s.to === email && Date.parse(s.at) > from).length;
  }

  /** Sends one mail unless it was handled, the address is suppressed, or a limit holds it. Returns whether it was sent. */
  private async deliver(key: string, to: string | undefined, why: string, build: (to: string, unsubscribe: string) => { subject: string; text: string; html: string }, operator = false): Promise<boolean> {
    if (this.state.sent[key] || this.state.skipped[key]) return false;
    if (!to) { this.state.skipped[key] = `no address: ${why}`; this.save(); return false; }
    if (!operator && this.isSuppressed(to)) { this.state.skipped[key] = "address suppressed"; this.save(); return false; }
    if (!operator && this.recentTo(to) >= (this.o.maxPerRecipientPerHour ?? 10)) return false; // held until the hour clears
    if ((this.state.attempts[key] ?? 0) >= 5) { this.state.skipped[key] = "gave up after 5 attempts"; this.save(); return false; }
    const unsubscribe = this.unsubscribeUrl(to);
    const m = build(to, unsubscribe);
    const text = operator ? m.text : `${m.text}\nTo stop these mails: ${unsubscribe}\n`;
    const html = operator ? m.html : m.html.replace(/<\/body>/i, `<p style="max-width:620px;margin:8px auto;padding:0 16px;font:12px/1.5 sans-serif;color:#777"><a href="${esc(unsubscribe)}" style="color:#777">Stop these mails</a></p></body>`);
    try {
      const r = await this.o.transport.send({
        from: this.o.from, to, subject: m.subject, text, html,
        ...(operator ? {} : { headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
      });
      this.state.sent[key] = { to, at: new Date(this.now()).toISOString(), id: r.id };
      this.save();
      this.say(`mail sent: ${key} -> ${to} (${r.id})`);
      return true;
    } catch (e) {
      this.state.attempts[key] = (this.state.attempts[key] ?? 0) + 1;
      if (!(e instanceof RetryableMailError)) this.state.skipped[key] = `refused: ${(e as Error).message}`;
      this.save();
      this.say(`mail not sent: ${key}: ${(e as Error).message}`);
      return false;
    }
  }

  /** The contracts whose last record is a rejection nobody has ruled on yet, with their parties. */
  private async openDisputes(): Promise<{ contract: string; principal: string; performer: string; purpose: string }[]> {
    const out: { contract: string; principal: string; performer: string; purpose: string }[] = [];
    const seen = new Set<string>();
    const all = await this.o.log.since(0, 1_000_000);
    for (const s of all) {
      const b = s.record.body as { kind?: string; verdict?: string };
      if (s.record.type !== "asp.attestation/v0.2" || b.kind !== "acceptance" || b.verdict !== "rejected") continue;
      const contract = s.record.subject as string;
      if (seen.has(contract)) continue;
      seen.add(contract);
      const last = (await this.o.log.chain(contract)).at(-1);
      const lb = last?.record.body as { kind?: string; verdict?: string } | undefined;
      if (!last || last.record.type !== "asp.attestation/v0.2" || lb?.kind !== "acceptance" || lb.verdict !== "rejected") continue;
      const cb = (await this.o.log.get(contract))?.record.body as { principal: string; performer: string; purpose: string };
      out.push({ contract, principal: cb.principal, performer: cb.performer, purpose: cb.purpose });
    }
    return out;
  }

  /** One pass: sends what is due. Passes do not overlap. */
  async tick(): Promise<{ sent: number }> {
    if (this.running) return { sent: 0 };
    this.running = true;
    let sent = 0;
    const budget = this.o.maxPerPass ?? 50;
    try {
      const log = this.o.log;
      // The end of a Mandate.
      const all = await log.since(0, 1_000_000);
      for (const c of all.filter((s) => s.record.type === "asp.contract/v0.2").map((s) => s.id)) {
        if (sent >= budget) break;
        const key = `final:${c}`;
        if (this.state.sent[key] || this.state.skipped[key]) continue;
        if ((await log.chainInfo(c))?.state !== "Settled") continue;
        const f = await collectMandateFacts(log, c);
        if (!f) continue;
        if (await this.deliver(key, this.recipientFor(f.contract.principal), `principal ${f.contract.principal}`, (to) => buildMandateMail(f, { to, from: this.o.from, ...(this.o.linkBase ? { linkBase: this.o.linkBase } : {}) }))) sent++;
      }
      // Alerts.
      for (const a of await findAlerts(log, this.now())) {
        if (sent >= budget) break;
        if (this.state.sent[a.key] || this.state.skipped[a.key]) continue;
        const f = await collectMandateFacts(log, a.contract);
        if (!f) continue;
        if (await this.deliver(a.key, this.recipientFor(f.contract.principal), `principal ${f.contract.principal}`, (to) => buildAlertMail(a, f, { to, from: this.o.from, ...(this.o.linkBase ? { linkBase: this.o.linkBase } : {}) }))) sent++;
      }
      // A dispute opened: the operator.
      if (this.o.operatorTo) {
        for (const d of await this.openDisputes()) {
          if (sent >= budget) break;
          const subject = `A dispute is open: ${d.purpose}`;
          const text = [subject, "", `Contract ${d.contract}`, `Principal ${d.principal} v performer ${d.performer}.`, "", "A ruling is waiting for the operator's court:", "  asp court docket", "  asp court rule --contract <id> --verdict ... --fault <did>=<permille>", ""].join("\n");
          const html = `<!doctype html><html><body style="font-family:sans-serif"><p><strong>${esc(subject)}</strong></p><p>Contract <code>${esc(d.contract)}</code><br>Principal ${esc(d.principal)} v performer ${esc(d.performer)}</p><p>A ruling is waiting for the operator's court: <code>asp court docket</code>, then <code>asp court rule</code>.</p></body></html>`;
          if (await this.deliver(`dispute:${d.contract}`, this.o.operatorTo, "operator", () => ({ subject, text, html }), true)) sent++;
        }
      }
    } finally { this.running = false; }
    return { sent };
  }
}

// ---- the routes the provider and the reader call: no sign-in, so they check their own proof ----

async function readText(req: IncomingMessage, max: number): Promise<string | undefined> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return undefined; chunks.push(c as Buffer); }
  return Buffer.concat(chunks).toString("utf8");
}

/** `publicRoutes` for createLogServer: /mail/unsubscribe (GET shows a page, POST does it: also the one-click POST) and /mail/webhook/resend. */
export function mailPublicRoutes(mailer: ServiceMailer, o: { webhookSecret?: string; now?: () => number }) {
  const page = (res: ServerResponse, status: number, title: string, body: string) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem}button{padding:.6rem 1rem;font:inherit}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`);
  };
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/mail/unsubscribe") {
      const email = url.searchParams.get("e") ?? "", token = url.searchParams.get("t") ?? "";
      if (!email || !mailer.verifyUnsubscribe(email, token)) { page(res, 400, "This link is not valid", "<p>The unsubscribe link is damaged or was not made by this service.</p>"); return true; }
      if (req.method === "POST") { await readText(req, 1024); mailer.suppress(email, "unsubscribed"); page(res, 200, "You are unsubscribed", `<p>${esc(email)} will get no more mail from Agent Social about jobs and alerts.</p>`); return true; }
      if (req.method === "GET") { page(res, 200, "Stop these mails?", `<p>Stop mail about your agents' jobs and alerts to <strong>${esc(email)}</strong>?</p><form method="post" action="${esc(url.pathname + url.search)}"><button type="submit">Unsubscribe</button></form>`); return true; }
      res.writeHead(405); res.end(); return true;
    }
    if (url.pathname === "/mail/webhook/resend") {
      if (req.method !== "POST") { res.writeHead(405); res.end(); return true; }
      const body = await readText(req, 64 * 1024);
      if (body === undefined || !o.webhookSecret || !verifySvix(req.headers, body, o.webhookSecret, o.now?.())) { res.writeHead(401, { "content-type": "application/json" }); res.end('{"ok":false}'); return true; }
      try {
        const ev = JSON.parse(body) as { type?: string; data?: { to?: string[] | string; bounce?: { type?: string } } };
        const to = ([] as string[]).concat(ev.data?.to ?? []);
        if (ev.type === "email.complained") for (const a of to) mailer.suppress(a, "complaint");
        if (ev.type === "email.bounced" && ev.data?.bounce?.type !== "Transient") for (const a of to) mailer.suppress(a, "bounce");
      } catch { /* a body that is not JSON suppresses nothing */ }
      res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}');
      return true;
    }
    return false;
  };
}
