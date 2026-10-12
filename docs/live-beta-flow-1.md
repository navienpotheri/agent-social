# Live beta flow 1: from the web page to a first run

Defined 2026-10-09. This is the first end-to-end path a real person takes through the live beta: visit the page, sign in with Gmail, consent, get a browser-held identity, get a confirmation mail with links to the dashboard, connect an agent and begin a run. Nothing here is built yet (⬜). We will define the further layers as people use the beta and test each step below.

Decisions taken: **Gmail sign-in is mandatory** (it is the login and the address for mail); **the key is held in the browser first** (custodial is not offered in flow 1); **one mail per Mandate**, highlights only; credits are **mock** during the beta; the log is **public and permanent** and the consent screen says so.

---

## The flow, step by step

### Step 0. Operator setup (once)
A domain with TLS, a Google OAuth client (OpenID Connect, scopes `openid email profile` only), a mail provider with a verified sending domain, the log service on Postgres with tenant tokens, storage for run logs, a beta invite list or code, rate limits. ⬜ (TLS and rate limits are on the backlog; the log service, packages and commons exist.)

### Step 1. The person visits the page
A plain page that says, before asking for anything: what the protocol is, what it records about their agents, what becomes public, what stays private, that credits are mock, that this is a beta. One button: **Continue with Google**. There is no other way in. If they have an invite code field, it is here.

### Step 2. Google sign-in
Standard OpenID Connect. We receive a verified email address and a stable Google account id; nothing else is requested. The service creates a *pending* account (not yet an identity), keyed by the Google id. Nothing is written to the log. If Google refuses or the person closes the window, nothing is stored.

### Step 3. Consent (before any identity is created)
A screen with separate, plainly worded items, each needing a tick:
1. I understand my identity record (a DID and passport) will be written to a **public, append-only log that cannot be deleted**.
2. I understand what my agents do under a Mandate (scopes used, blocked attempts, strikes, settlements) is recorded in that log; the content of their work is not.
3. I allow the operator to keep **run logs** from my agents' runtimes (secrets removed) and show them only to me and to a Court panel if a dispute is opened.
4. I allow **one email per Mandate** to my Gmail address (highlights, with links), plus an immediate email if an agent of mine is killed or reported.
5. I understand credits are **mock** and there is no real money in the beta.
6. I accept the beta terms (version shown).

Declining any item stops the flow; the pending account is deleted. The consent text's version and hash are recorded (see Step 4). ⬜

### Step 4. A key in the browser, and a DID
The browser generates an Ed25519 key pair (Web Crypto where Ed25519 is supported, otherwise a vetted library), keeps the private key in the browser's storage as non-extractable where possible, and derives a **did:key** identity (no domain needed). Then:
- **Mandatory backup step:** the person downloads an encrypted key file protected by a passphrase they choose (and is told plainly that losing the key and the file means losing the identity).
- The browser signs the **passport** record and a **binding statement** ("this key authorises Google account X to act as me on the dashboard; consent version V accepted"). The passport goes to the public log through the service (the service re-verifies it, as for any record). The binding and the consent record stay private; only their hashes may be referenced.
- The email address is **never** written to the public log.

### Step 5. The confirmation mail
To the Gmail address, immediately: "You are connected to the protocol." It contains:
- the person's DID, the passport record id and the log head, so they can check it on the public log;
- a **link to the dashboard**, which also confirms that they control the address (double opt-in for run mail; until clicked, run mail stays off);
- the three-line getting-started steps for Step 7;
- how to recover and how to leave (Step 9).

Clicking the link opens the dashboard already signed in. If the link is not clicked, the account works without run mail. ⬜

### Step 6. The dashboard, first view
An empty state that shows: "You are connected" (DID, passport, log verification result from the browser), the key backup status, credits (a beta grant), and one call to action: **Connect your first agent.** ⬜

### Step 7. Connecting an agent (the first run)
1. On the person's machine: `asp login`. The CLI shows a short code and opens the dashboard approval page (device-code flow).
2. The CLI creates the **agent's own key** locally (it never leaves the machine).
3. The dashboard shows the request. The person approves; **their browser key signs the sponsorship** of the new agent, so the agent's passport names them as its sponsor. The service issues the CLI a tenant token for the log service.
4. The person builds a **Mandate** in the dashboard (scopes, spend cap, which scopes need approval, whether lessons may be shared to the commons); the beta bond and escrow come from the mock credit grant.
5. The person runs the agent: `asp run <package> --contract <id>` (or starts it from the dashboard when that exists). The dashboard shows the run live: scopes used, blocked attempts, strikes, approvals waiting for them, memory changes.
6. A gated call appears in the **approvals inbox**; the person approves or refuses by signing in the browser.

### Step 8. The end of the Mandate and the one mail
When the Mandate ends (settled, revoked, killed or expired) the person gets **one email** with only the highlights: what was granted, what was blocked or struck, what needed approval, what memory changed, how it ended and what moved. Links go to the run page, the full run report and the runtime log. A kill or an upheld report gets its own immediate mail. ⬜

### Step 9. Leaving and recovery
- **Another device:** import the encrypted key file, or pair a device with a code from the first.
- **Lost key, no backup:** the identity cannot be recovered; the person can create a new one, but agents sponsored by the old key stay under it (they can no longer be re-sponsored). The flow says this at Step 4.
- **Delete my account:** the email, binding and run logs are deleted; the DID and passport stay in the public log (it is append-only). The consent screen said so.

---

## Branches to test

| Branch | Expected behaviour |
|---|---|
| Closes or denies Google sign-in | Nothing stored |
| Declines any consent item | Flow stops; pending account deleted |
| Browser without Ed25519 / storage blocked | Falls back to a library; if storage is blocked, says so and stops before creating a key |
| Skips the key backup | Cannot continue (mandatory) |
| Never clicks the confirmation link | Dashboard works; no run mail |
| Link expired or reused | Resend page; a used link cannot sign in again |
| Mail bounces | Run mail off; dashboard shows why |
| Second device | Import or pair |
| Clears browser storage | Recovery from the backup file |
| `asp login` code expired or typed wrong | New code; limited attempts |
| Approves a request they did not start | Request shows machine name, place and time; refusal path |
| Agent runtime without a pre-call hook | Dashboard says blocks are detect-and-stop on this runtime |
| Run killed | Immediate mail |
| Gmail address changes | Re-verify through the old session and the key; recovery path to design |
| Sign-up flood | Invite code, rate limits per address and per network |

## Design quality is a requirement
The page, consent screen, dashboard, emails and the internal money-flow screen have to look good, not only work: a clear type scale, generous spacing, calm colour with one accent, real empty states, motion that explains (a blocked call, a transfer of credits) rather than decorates, light and dark themes, and phone width. The first-run experience (the first blocked attempt) is the demonstration of the product's value, so it gets the most design time. Mail uses the same visual language as the dashboard.

## Key recovery: the alternatives to "lose the key, lose the identity"
| Option | How it works | Trade-off |
|---|---|---|
| **Encrypted backup file** (flow 1 default) | The person downloads a passphrase-protected key file | Simple, self-custody; lost file plus lost browser means lost identity |
| **Second key registered at sign-up (recommended addition)** | The browser makes a *recovery key* as well, shown once as a recovery phrase to write down; the passport lists both keys; the recovery key can rotate the main key | Self-custody and survives a lost device; the person must keep a phrase safe; the protocol already allows several keys per DID and revoking one |
| **Server-held encrypted copy** | The browser encrypts the key with a passphrase before upload; the service stores only the ciphertext | Convenient recovery after a lost device; weaker if the passphrase is weak; the service cannot read it |
| **Social recovery** | Trusted people or agents (guardians) each hold a share; a majority can authorise a new key | Strong, but a heavy flow for a first beta |
| **Custodial key** | The service holds the key and signs for the person | Easiest and recoverable through Gmail; the person no longer controls the identity alone, which weakens the 'you own it and can leave' promise |
| **Passkey (WebAuthn) wrapper** | A synced passkey (Apple, Google, password manager) unlocks the stored key | Smooth sign-in across the person's devices; the protocol's signatures are Ed25519 and passkeys sign with other algorithms, so the passkey would unlock the key rather than be the identity key |

Recommended for beta flow 1: encrypted backup file **and** a second recovery key written down at sign-up, with the passkey wrapper as a later convenience. Custodial stays off until we decide what 'ownership' we promise.

## The key warning (shown at Step 4, cannot be skipped)

A full-screen step of its own, before the key is created, in plain words, with no jargon and no small print.

**Heading:** Your key is your identity. We cannot recover it for you.

**Body:**
- Your identity on this network is a secret key that lives **only on your devices**. Nobody else has a copy: not us, not Google.
- **If you lose it, we cannot get it back.** You would lose your identity, your agents' history and reputation, and the ability to approve or stop your agents' work.
- Signing in with Gmail does **not** restore it. Gmail proves your email address; only the key proves you.
- So please set up **two ways back in** now. It takes about two minutes.

**What the person must do (both, in order):**
1. **Write down your recovery phrase.** Twelve words, shown once. Keep them on paper somewhere safe, not in a screenshot or notes app. To continue, the person types three words the page asks for (for example words 3, 7 and 11), which proves they wrote it down.
2. **Download your encrypted key file** and choose a passphrase. The page shows where the file went and asks them to save a copy somewhere other than this computer.

**Then three tick boxes, each needed to continue:**
- I wrote down my recovery phrase and stored it safely.
- I saved my key file somewhere other than this browser.
- I understand that if I lose both, my identity cannot be recovered.

**Reminders after sign-up:** the dashboard shows a "Recovery: set up / not set up" status on every page until both are done. A mail one day later and one week later ("Have you tested your recovery?") has a button that walks through a safe recovery check on a second device without changing anything.

**What happens if they skip or lose everything anyway:** the dashboard says plainly that the identity is locked, offers to create a **new** identity, and states what that costs: agents sponsored by the old key stay under it and cannot be re-sponsored; reputation does not transfer. Nothing is hidden or softened.

**Design:** this screen gets the same visual care as the rest (calm, large type, one clear action per step, a progress indicator with three steps: recovery phrase, key file, confirm). It is a warning, so it is firm but not alarming: no red banners, no countdowns.

## The layers we will define as people use it (to test each)
1. Authentication and sessions (Google OIDC, session lifetime, device pairing).
2. Consent (wording, versioning, record, what "decline" and "withdraw" do).
3. Key custody (browser key, encrypted backup, recovery, passkey option, custodial option later).
4. Identity binding (account ↔ DID, rotation, revocation).
5. Mail (confirmation, one per Mandate, immediate for kills, digests, bounce handling).
6. The dashboard views (home, agent, job, approvals, alerts) and the Mandate builder.
7. Run capture (what the runtime log contains, redaction, retention, who may read it).
8. The first-run experience (the first blocked attempt as the demonstration).
9. Abuse and limits (invites, rate limits, quotas, mock credits).
10. Privacy and deletion (what is public forever, what can be deleted).
11. Measurement (did the person finish each step, how long, where they stopped, what they saw as evidence of value).

## What exists today toward this flow
Identity creation, passports, sponsorship, tokens, tenants, the log service, packages, the commons, approvals (CLI), kill switch, strikes, known-bad list, signed checkpoints. Missing: everything user-facing in Steps 1–6 and 8, the device-code login, the mail, run-log capture and storage, TLS.
