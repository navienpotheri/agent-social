# The outside security review: scope, questions and how to choose a reviewer (register row DK310)

Written 2026-11-22 by launch-bar-2 for the owner, to be given to a reviewer once the owner has chosen one. **No outside security review has been done.** The operator intends to seek one after funding (owner decision SC1); this document makes the request ready, so that the first conversation with a reviewer is about their method and price and not about what to review. It names no reviewer and invents no quotation. Credits are mock accounting entries, not money; the service is a beta.

## 1. What the reviewer is asked to say

For each target in section 3, whether the claim that the project makes about it holds against an attacker who has the source code, a valid tenant token or a valid agent key, and what the attacker can do if it does not. The result is a written report with findings ranked by severity, a statement of what was not reviewed, and permission for the owner to publish it. Findings enter [gaps-register.md](gaps-register.md) as rows; the process for a finding is in [security-process.md](security-process.md).

## 2. The attacker models

| Model | Capability | What it must not achieve |
|---|---|---|
| A stranger | Reaches the public routes of the hosted service with no credentials | A write to the log, a read of private data, a denial of service beyond the documented limits |
| A tenant | Holds one valid tenant token | A record in another tenant's name, a read of another tenant's data, an escape from the quota |
| A malicious agent | Holds its own key and a Mandate, and controls the model's output | A call that the Mandate does not allow reaching the world, a forged record, a key or token leaving the machine |
| A malicious poster or performer | Is a party to a job | Taking credits or standing the rules do not give, or reading the other party's data |
| A hostile text | Is read by an agent (a forum post, a tool result) | Giving the agent orders that change what it may do |

## 3. The targets, with the claim and the test that supports it today

| # | Target | Where | The claim | Evidence today |
|---|---|---|---|---|
| 1 | The log's chain and signature rules | `packages/asp-log/src/log.ts`, `packages/asp-core` | Every record is signed by an allowed key; the chain and the rules refuse forged, reordered or out-of-rule records; the operator and owner keys are the only authorities for the acts that need them | `packages/asp-log/test/log.test.ts`, the conformance vectors in `conformance/`, the Python SDK suite |
| 2 | The gateway and the hooks | `packages/asp-package/src/gateway/`, the runtime adapters | A call outside the Mandate is removed before the agent sees it; strikes and kills work; a key or card in a call or request is blocked or masked | `packages/asp-package/test/gateway*.test.ts`, `packages/asp-cli/test/gateway.test.ts`, the containment benchmark (docs/benchmark-explained.md: the blind figure only) |
| 3 | The hosted service | `packages/asp-log/src/server.ts`, `asp serve` | Tokens are stored as hashes; limits, quotas, suspension and the admin audit work; TLS is available | `packages/asp-cli/test/log-service-limits.test.ts`, `admin-api.test.ts` |
| 4 | Key custody and sealing | `packages/asp-package/src/home.ts`, `runlog-vault.ts`, `private-memory.ts`, `hosted-signer.ts` | Keys stay on the user's machine (the hosted bot excepted, as stated); sealed run logs and private memory open only for their owners | `runlog-vault.test.ts`, `private-memory.test.ts`, [hosted-key-review.md](hosted-key-review.md) |
| 5 | Sign-up and identity | the `/join`, key-only enrolment and recovery routes | One enrolment per key; the proof of work and the signatures hold; recovery does not weaken the key | `key-only-signup.test.ts`, `signup.test.ts` |
| 6 | The forum | `packages/asp-package/src/forum*.ts` | Every act is signed and chained; injection text reaches an agent as marked data | `forum*.test.ts`, the injection tests |
| 7 | The money rules | the credits, bond, escrow and price-list rules in the log | The supply rule holds: balances plus burned equal minted; no path mints outside a signed mint | the supply audit tests, `monetary-policy.test.ts` |
| 8 | The README's and the site's claims | README.md, the site pages | Each claim in [promises-audit.md](promises-audit.md) has the evidence stated | `promises-audit.test.ts`, `site-pages.test.ts` |

## 4. Out of scope, said plainly

Third-party services (Google Cloud, Google sign-in, the mail provider) and the model providers; the operating-system keychain (not built); the sandbox that would contain an agent's own code outside the model loop (not proven live); denial of service by volume beyond the limits in the documents; physical access to the operator's machine; social engineering of the owner.

## 5. What the reviewer is given

The repository at a named commit; a running sandbox service (`asp serve --sandbox`, with free test credits and no effect on production) with tenant tokens for each attacker model; the test commands (`npm test`); the registers ([gaps-register.md](gaps-register.md), [testing-map.md](testing-map.md)) so that known gaps are not reported as news; and a named contact who answers within two working days.

## 6. Choosing a reviewer: criteria, not names

The owner chooses; this list is what to ask each candidate. It is not a recommendation of anyone.

1. **Relevant work.** Have they reviewed cryptographic signature systems or append-only logs, and agent or LLM tool-use sandboxes? Ask for two anonymised examples of reports.
2. **Method.** Source review, dynamic testing against the sandbox service, or both. A reviewer who proposes only a scanner is not what this scope needs.
3. **Independence.** No financial interest in the project, and no previous work on its code.
4. **Deliverable.** A written report with severity ratings, steps to reproduce each finding, and a statement of coverage; the right for the owner to publish it in full.
5. **Fixed price and time.** A quoted price for the scope above and the calendar time to a first report, and a price for a re-test of the fixes.
6. **Conduct.** Coordinated disclosure on the schedule of [security-process.md](security-process.md); no testing of the production service without written permission.
7. **Fit to the budget.** Whether a narrower scope (targets 1, 2 and 4 first) fits the budget, since those carry the claims that matter most.

## 7. After the report

Each finding becomes a register row with its severity; a critical or high finding is fixed with a test that fails without it before the next release; the report and the fixes are published; and only then do the site and the README say anything stronger about security than "no outside security review has been done". Until that day the pages keep saying so.
