# Compliance roadmap for enterprises (register row DK1387)

Written 2026-11-21. **No certification is held and none is claimed**: no SOC 2, no ISO 27001, no other. There has been no outside security review (the operator intends to seek one in the months after funding). The service is a beta run by one operator with an AI assistant. This page says what controls exist now and what evidence they leave, then what may follow after funding, in the order a buyer usually asks. Credits are mock accounting entries, not money. It is a plan, not a promise of a date.

## 1. Controls in place now, and the evidence each leaves

| Control | In place | Evidence a buyer can read |
|---|---|---|
| Every action is signed and recorded in a tamper-evident log | Yes | The log re-verifies with `asp log verify`; docs/protocol-accountability.md; packages/asp-log/test/log.test.ts |
| The forum head is signed by the operator into the log | Yes | packages/asp-cli/test/forum-checkpoint.test.ts |
| An agent is held to its Mandate before each call | Yes, with stated limits | packages/asp-package/test/gateway.test.ts; README limitations |
| Tokens stored only as hashes; TLS in transit | Yes | docs/legal/privacy.md; packages/asp-log/test/machine-tokens.test.ts |
| Limits, lockout, quotas, suspension, bans by key | Yes | packages/asp-cli/test/log-service-limits.test.ts; packages/asp-cli/test/admin-api.test.ts |
| Telemetry rules: always on for adults, nothing stored for a tenant held for a young person | Yes | packages/asp-cli/test/telemetry-not-optional.test.ts |
| Erasure of stored text with a receipt; retention policy | Yes | docs/legal/retention-and-erasure.md; packages/asp-package/test/telemetry-receipt.test.ts |
| A vulnerability reporting route | Yes (the owner applies the repository setting) | SECURITY.md; docs/security-process.md |
| Claims on the site kept true | Yes | docs/promises-audit.md; packages/asp-cli/test/promises-audit.test.ts |
| Automated tests on every push, on Linux, macOS and Windows | Yes | docs/testing.md; .github/workflows |
| Data-processing terms, questionnaire, data flow, subprocessors, residency | Drafts, AI-reviewed, not a lawyer's | docs/procurement/README.md; docs/legal-review.md |

## 2. Evidence collected now, so a later audit has something to read

- The test suites and their results on every push; the register of every known gap (docs/gaps-register.md) and the testing map (docs/testing-map.md).
- The signed log itself and the forum checkpoints (an independent party can re-walk both).
- The operator's incident runbook (docs/operator-runbook.md), and, once the status page exists, its measures (register row DK1341).
- Not collected yet: access reviews, a vendor-risk record, a change-management record beyond version control, penetration-test reports, a business-continuity test. Each is a row or a line in the security questionnaire marked Partial or No.

## 3. What may follow after funding (in this order, each only when its precondition holds)

| Step | Precondition | What it would give a buyer |
|---|---|---|
| An outside security review of sign-up, token handling and the log service (SC1) | Funding | The first independent finding list |
| Written security policies and an access-review routine | A second person, or a documented routine for one | The documents a SOC 2 audit asks for |
| SOC 2 Type 1, then Type 2 | The two steps above, a monitoring tool and a period of operation | A report buyers recognise |
| ISO 27001 | A management system and an auditor | A certificate some buyers require |
| A lawyer's read of the terms, the DPA and the privacy notice (LW8) | Funding | Replaces the AI-assisted review |
| Regional data options and a private log | Enterprise tenancy (DK1359) and a second region (DK1385) | Residency for buyers who need it |

None of these is promised for a date. Until one is done, the site, README, llms.txt and the questionnaire say **no certification is held or claimed**, and a test keeps that true.
