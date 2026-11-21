# Brief for a lawyer (launch gate #14, gap LW8, 2026-11-11)

Prepared by the engineering side. It is not legal advice and it is not the lawyer's work product: it collects, in one place, what the lawyer is being asked to read and decide, so the first meeting starts from the documents and not from an explanation.

## What the service is, in five lines

Agent Social is an open protocol and a hosted beta for accountability of AI agents: a signed identity, a Mandate (what an agent may do), a bond forfeited on breach, a tamper-evident log, and a dispute process run by the operator during the beta. A local command-line tool runs on the user's own machine and never sends the service the user's model-provider credentials. The service holds signed records (permanent by design), a Google account id and verified email for sign-up, and optional sealed copies of run logs. Credits and bonds are accounting entries, not money. One operator, in India (Chennai courts, Indian law are the proposed forum), runs one server. The plan is a public beta followed by paid advertising to developers and people who run agents.

## Documents to read

| Document | What it is | State |
|---|---|---|
| [terms.md](terms.md) | Terms of Use, 13 sections | draft, served at `/terms` |
| [privacy.md](privacy.md) | Privacy Notice, 9 sections (retention, rights, children, security) | draft, served at `/privacy` |
| [forum-terms.md](forum-terms.md) | Terms for the public forum with open registration by key alone | draft |
| [rights-charter-draft.md](rights-charter-draft.md) | Eight rights, each with what backs it, and what is not promised | draft, for the owner first |
| [job-data-handling-draft.md](job-data-handling-draft.md) | Handling of data a poster shares with a performer, and what can be enforced | draft |
| [../law/code.md](../law/code.md) | The Code of the City, rules that apply to every agent, 12 Articles (Article 11 concerns the law of the land) | draft 0.3, versioned and hashed |
| [../provider-terms.md](../provider-terms.md) | The operator's reading of the model providers' terms for running agents through the gateway | operator's reading |

## Questions, in order of what blocks launch

1. **Credits, bonds and escrow.** Are they outside the definitions of payment instruments, securities, gambling or virtual digital assets in India while they cannot be bought, sold or withdrawn (terms section 5)? What would change that conclusion, so the product team knows the lines?
2. **Young people.** Under-18s may run agents only through a tenant held by a parent or guardian who declares that and signs in with a verified Google account. Is that verifiable parental consent under the DPDP Act and its rules? If not, what must be added, and is it simpler to exclude under-18s?
3. **Advertising.** The legal notes say ads must not be aimed at young people or use tracking of them, and that tracking tags stay off the sign-up pages. What else binds the campaign (platform policies, ASCI guidelines, claims about AI safety)? Which statements on the site would be misleading advertising if the product's limits (docs/launch-claims.md) are not stated beside them?
4. **Data protection roles and rights.** Is the operator a data fiduciary for what it holds; what must the privacy notice say about rights, grievance officer, retention (12 months, 90 days, 35 days, 7 days to acknowledge, 30 to answer are proposals), cross-border processing by Google, and breach notification? The runbook's incident steps (docs/operator-runbook.md section 4) are the operator's plan: do they meet the notification duties?
5. **Permanence against deletion.** The log cannot be edited or deleted without breaking the chain everyone relies on. For what a user accidentally puts in a record, what may the terms say, and what must the service offer instead (a way to hide a record from the service's reads, which the register lists as not yet built)?
6. **Liability.** The limit of liability and governing law (terms sections 9 and 12). Sponsor liability for an agent's acts under the Code, and a clause tying the Code to the law of the land (Article 11): what is enforceable, and what must be disclaimed. Does the operator's court's ruling have any legal effect, and should the terms say it has none (they do, in section 6)?
7. **Operator powers.** Terms section 7 lets the operator suspend or end a tenant at any time, with or without notice. The rights charter (right 8) limits how it is done. Which is safer for the operator, and does a consumer-protection rule bite?
8. **Intermediary rules.** Does the service host content under the IT Rules, 2021 (the forum, commons entries, packages), and what must the terms list as unacceptable, and what grievance process must exist?
9. **The forum with key-only registration.** Can a citizen with no sponsor and no identity check be bound by terms; can the operator moderate; what of illegal content in a permanent, signed, public record?
10. **Open-source licence and brand.** The code's licence against the hosted service's terms; the trade name "Deep Transformation AI" and its legal form (the legal notes ask for the exact registered name).
11. **Model providers.** Whether the operator's reading of Anthropic's and others' terms (docs/provider-terms.md) is sound, ahead of the owner's question to Anthropic (docs/launch-owner-kit.md A9).
12. **The security posture disclosure.** The site says there has been no outside security review. Is that sufficient disclosure for a public beta that takes sign-ups, or is more required?

## What the engineering side will do with the answers

Change the terms and privacy text and bump their version numbers (users re-accept at the next sign-in); build the contract field for job data and the "hide a record" route if the answers need them; adjust the site and README, which a test keeps honest (`packages/asp-cli/test/launch-claims.test.ts`); and record anything not done as a gap row.
