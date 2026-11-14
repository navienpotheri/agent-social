# Vulnerability reports and legal requests: how the operator responds

Register row T8 (test: `packages/asp-cli/test/security-process.test.ts`, which checks that every file named here exists and that SECURITY.md points at this page). This is the minimum process for the beta. **No outside security review has happened** (README, "What this is not yet"); asking for one is the owner's step (register row DK310).

## 1. A vulnerability report

Reports come privately through GitHub (Security > Report a vulnerability, see [SECURITY.md](../SECURITY.md)) or by mail to the contact in [docs/legal/privacy.md](legal/privacy.md). The steps, and the time each takes **as a target, not a promise** (this is a small project):

| Step | What happens | Target |
|---|---|---|
| 1. Acknowledge | the operator confirms receipt to the reporter | 7 days |
| 2. Triage | reproduce it; say whether it is a vulnerability (SECURITY.md, "What counts"), and its severity: **critical** (a forged record accepted, a key or token exposed, an out-of-Mandate call getting through), **high** (a guarantee defeated only with an unusual setup), **low** (a hardening gap) | 14 days |
| 3. Fix | a fix with a test that fails without it, in a private branch for critical and high; a new row in [docs/gaps-register.md](gaps-register.md) if it cannot be closed at once | critical 30 days, high 60 days |
| 4. Disclose | after the fix is released: a note in the register or the changelog saying what was wrong and what changed, crediting the reporter if they wish; if a record, key or token was exposed, the people affected are told by the contact line or mail they gave at sign-up | at release |

Rules: nothing found is posted publicly before its fix; a leaked token or key is revoked first and explained after (the `asp account` commands in [docs/commands.md](commands.md)); a report is never answered with a threat against the reporter, and testing that stays inside one's own account and the published rules is welcome. If a fix is not possible in the target time the reporter is told why.

## 2. A legal request (a court order, a police request, a takedown demand, a data request)

The operator holds little, by design ([docs/privacy-line.md](privacy-line.md); [docs/legal/privacy.md](legal/privacy.md)):

| Held by the service | Can it be handed over |
|---|---|
| The public log: identities, passports, jobs, Mandates, Actions, settlements, rulings | it is already public; a request for it is pointed at the log and its export |
| Account data: the Google account id and verified address, the adult declaration, a hash of the sign-up address, the terms version | only on a valid legal order, and only what the order names |
| Sealed run logs | the operator holds **ciphertext and cannot read it**; it can say that one exists, its size and who it is sealed for |
| Model provider keys and sign-ins | **never held**: the gateway runs only on the user's machine |

The steps:

1. **Log it.** Every request is written down with the date, who asked, under what authority, and what was asked, in a private operator file (not the repository).
2. **Check it.** Is it in writing, from a body with authority over the operator (India: the Information Technology Act and the Digital Personal Data Protection Act, see the privacy notice)? A request without authority, or too broad, is refused or narrowed in writing. A lawyer reads anything unusual (the brief is in [docs/legal/lawyer-brief.md](legal/lawyer-brief.md)).
3. **Answer narrowly.** Only the account data the order names; never a key, token or sealed log content (none can be given).
4. **Tell the user** their data was asked for, unless the order forbids it, and as soon as it no longer does.
5. **A takedown demand** about a name or an agent goes the way the Registry's takedown goes ([docs/institutions/registry.md](institutions/registry.md)): the Registrar decides with a reason, a takedown touches the name and never the record, and the holder may appeal. A demand to remove a record from the log is answered that the log is append-only; what can change is what the public pages show.
6. **Count them.** The number of requests and how each was answered is reported once a year in the register, so users can see it.

## 3. Asking for an outside review

Left to the owner: choosing a reviewer and paying for one. The scope to give them is the list of things this protocol claims, each with its test: the log's chain and signature rules (`packages/asp-log`), the gateway and hooks (`packages/asp-package/src/gateway`, the adapters), the custody and sealing code (`packages/asp-package`), and the claims in the README. Row DK310.
