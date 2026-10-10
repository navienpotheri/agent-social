/**
 * Sign in with Google for the sign-up page (gap U1, O19): the person proves they hold a Google account with a verified email, and the tenant is tied to it.
 * The standard authorization-code flow, done by the server so no secret reaches the browser:
 *
 *   /join (form: tenant name, the terms, the adult-or-guardian declaration)  ->  Google  ->  /auth/callback  ->  the tenant is made and its token shown once.
 *
 * What the form said travels in a signed `state` (HMAC, ten minutes); a random value in a cookie must match the one inside it, so a callback that someone else
 * started cannot be used on another person's browser (login CSRF). The code is exchanged at Google's token endpoint with the client secret, and the person is read
 * from Google's userinfo endpoint with the access token that exchange returned. Only the Google account id (`sub`) and the verified email are kept.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface GoogleOptions {
  clientId: string;
  clientSecret: string;
  /** Must equal an authorized redirect URI of the client, for example https://log.example.org/auth/callback. */
  redirectUri: string;
  /** Endpoints, overridable so a test can stand in for Google. */
  authUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  fetch?: typeof fetch;
  secret?: Buffer;
  now?: () => number;
}

export interface JoinForm { name: string; accept_terms: boolean; terms_version: string; declaration: string; contact?: string }
export type GoogleStart = { location: string; nonce: string };
export type GoogleFinish =
  | { ok: true; form: JoinForm; google: { sub: string; email: string } }
  | { ok: false; status: number; code: string; message: string };

const STATE_LIFETIME_MS = 10 * 60_000;
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

export class GoogleSignIn {
  private o: GoogleOptions;
  private secret: Buffer;
  private now: () => number;
  private f: typeof fetch;

  constructor(o: GoogleOptions) {
    this.o = o;
    this.secret = o.secret ?? randomBytes(32);
    this.now = o.now ?? Date.now;
    this.f = o.fetch ?? fetch;
  }

  private mac(payload: string): string { return createHmac("sha256", this.secret).update(payload).digest("base64url"); }

  /** The address to send the person to, and the nonce to put in their cookie. */
  begin(form: JoinForm): GoogleStart {
    const nonce = randomBytes(16).toString("hex");
    const payload = b64(JSON.stringify({ n: nonce, f: form, e: this.now() + STATE_LIFETIME_MS }));
    const q = new URLSearchParams({
      client_id: this.o.clientId, redirect_uri: this.o.redirectUri, response_type: "code", scope: "openid email profile",
      state: `${payload}.${this.mac(payload)}`, prompt: "select_account", access_type: "online",
    });
    return { location: `${this.o.authUrl ?? "https://accounts.google.com/o/oauth2/v2/auth"}?${q}`, nonce };
  }

  private fail(status: number, code: string, message: string): GoogleFinish { return { ok: false, status, code, message }; }

  /** The callback: checks the state and the cookie, exchanges the code, reads the person. */
  async finish(query: URLSearchParams, cookieNonce: string | undefined): Promise<GoogleFinish> {
    if (query.get("error")) return this.fail(400, "GOOGLE_DECLINED", "Google sign-in was not completed, so nothing was created");
    const state = query.get("state") ?? "", code = query.get("code") ?? "";
    const [payload, mac] = state.split(".");
    if (!payload || !mac || !code) return this.fail(400, "BAD_STATE", "this sign-in link is not valid; start again from the sign-up page");
    const want = Buffer.from(this.mac(payload)), got = Buffer.from(mac);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return this.fail(400, "BAD_STATE", "this sign-in link is not valid; start again from the sign-up page");
    let s: { n: string; f: JoinForm; e: number };
    try { s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return this.fail(400, "BAD_STATE", "this sign-in link is not valid"); }
    if (s.e < this.now()) return this.fail(400, "STATE_EXPIRED", "this sign-in took too long; start again from the sign-up page");
    if (!cookieNonce || cookieNonce.length !== s.n.length || !timingSafeEqual(Buffer.from(cookieNonce), Buffer.from(s.n))) return this.fail(400, "BAD_STATE", "this sign-in was not started in this browser; start again from the sign-up page");
    let access: string;
    try {
      const r = await this.f(this.o.tokenUrl ?? "https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: this.o.clientId, client_secret: this.o.clientSecret, redirect_uri: this.o.redirectUri, grant_type: "authorization_code" }),
      });
      const t = (await r.json().catch(() => undefined)) as { access_token?: string } | undefined;
      if (!r.ok || !t?.access_token) return this.fail(502, "GOOGLE_ERROR", "Google did not accept the sign-in; try again");
      access = t.access_token;
    } catch { return this.fail(502, "GOOGLE_ERROR", "could not reach Google; try again"); }
    try {
      const r = await this.f(this.o.userinfoUrl ?? "https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${access}` } });
      const u = (await r.json().catch(() => undefined)) as { sub?: string; email?: string; email_verified?: boolean } | undefined;
      if (!r.ok || !u?.sub || !u.email) return this.fail(502, "GOOGLE_ERROR", "Google did not say who you are; try again");
      if (u.email_verified !== true) return this.fail(403, "EMAIL_NOT_VERIFIED", "this Google account has no verified email address");
      return { ok: true, form: s.f, google: { sub: u.sub, email: u.email.toLowerCase() } };
    } catch { return this.fail(502, "GOOGLE_ERROR", "could not reach Google; try again"); }
  }
}
