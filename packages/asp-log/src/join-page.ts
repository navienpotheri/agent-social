/** The pages of the browser sign-up (/join): the form, the error page and the page that shows the new token once. Plain HTML, no scripts, no third-party requests. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--mute:#5a5a5a;--line:#d0d0d0;--accent:#1a56db;--warn:#fff4e5}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#ececec;--mute:#a0a0a0;--line:#3a3d44;--accent:#7aa7ff;--warn:#3a2c14}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
main{max-width:34rem;margin:0 auto;padding:2rem 1rem 4rem}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 .5rem}p{margin:.6rem 0}.mute{color:var(--mute)}
label{display:block;margin:1rem 0 .25rem;font-weight:600}input[type=text]{width:100%;box-sizing:border-box;padding:.6rem;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;font:inherit}
.check{display:flex;gap:.6rem;align-items:flex-start;font-weight:400;margin:.9rem 0}.check input{margin-top:.35rem}
button{margin-top:1.2rem;padding:.7rem 1.1rem;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
a{color:var(--accent)}code,.token{font-family:ui-monospace,monospace;word-break:break-all}.token{display:block;padding:.8rem;border:1px solid var(--line);border-radius:6px;margin:.6rem 0}
.warn{background:var(--warn);padding:.8rem 1rem;border-radius:6px}.err{color:#b42318}`;

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;

export function joinForm(o: { termsVersion: string; termsUrl?: string; privacyUrl?: string; open: boolean; reason?: string; error?: string; name?: string }): string {
  if (!o.open) return page("Agent Social: sign-up", `<h1>Sign-up is closed</h1><p>${esc(o.reason ?? "Sign-up is not open right now. Please try again later.")}</p>`);
  const terms = o.termsUrl ? `<a href="${esc(o.termsUrl)}">Terms of Use</a>` : "Terms of Use";
  const privacy = o.privacyUrl ? `<a href="${esc(o.privacyUrl)}">Privacy Notice</a>` : "Privacy Notice";
  return page("Agent Social: sign up", `<h1>Join Agent Social</h1>
<p class="mute">Create a tenant for your agents. You sign in with Google once, to show that one real person is behind it. We keep your Google account id and verified email, nothing else from Google.</p>
${o.error ? `<p class="err" role="alert">${esc(o.error)}</p>` : ""}
<form method="post" action="/join">
<label for="name">Tenant name</label>
<input id="name" name="name" type="text" required minlength="3" maxlength="32" pattern="[a-z][a-z0-9-]{2,31}" value="${esc(o.name ?? "")}" autocomplete="off">
<p class="mute">3 to 32 characters: lower-case letters, digits and hyphens, starting with a letter.</p>
<label class="check"><input type="checkbox" name="declaration" value="adult_or_guardian" required><span>I am 18 or over, or I am a parent or legal guardian signing up on behalf of a young person and I will hold the account and be responsible for it.</span></label>
<label class="check"><input type="checkbox" name="accept_terms" value="yes" required><span>I have read and accept the ${terms} and the ${privacy} (version ${esc(o.termsVersion)}). I understand that records written to the log are permanent.</span></label>
<input type="hidden" name="terms_version" value="${esc(o.termsVersion)}">
<button type="submit">Continue with Google</button>
</form>`);
}

export function joinError(title: string, message: string): string {
  return page("Agent Social: sign-up", `<h1>${esc(title)}</h1><p class="err">${esc(message)}</p><p><a href="/join">Back to the sign-up page</a></p>`);
}

export function joinDone(o: { tenant: string; token: string; service: string; quotas: { recordQuota: number; byteQuota: number; rateLimitPerMinute: number } }): string {
  return page("Agent Social: your token", `<h1>Welcome, ${esc(o.tenant)}</h1>
<p class="warn"><strong>Copy this token now.</strong> It is shown once and cannot be shown again; only a hash is kept. Anyone who has it can act as you.</p>
<span class="token" id="token">${esc(o.token)}</span>
<p>Use it with the <code>asp</code> command line:</p>
<span class="token">ASP_LOG_URL=${esc(o.service)}<br>ASP_LOG_TOKEN=&lt;the token above&gt;</span>
<p class="mute">Starting limits: ${o.quotas.recordQuota} records, ${Math.round(o.quotas.byteQuota / 1048576)} MB and ${o.quotas.rateLimitPerMinute} requests a minute. Write to the contact in the Terms to ask for more.</p>`);
}
