# Procurement pack (register row DK1383, with DK1377 and DK1380)

For an organisation's security, legal and procurement teams. Everything here is a **draft**: an AI-assisted review of the legal texts is in [../legal-review.md](../legal-review.md) (an AI analysis, not legal advice), and no lawyer has read them. **No price is named, no certification is held or claimed, there has been no outside security review, and credits are mock accounting entries, not money.** The service is a beta run by one operator with an AI assistant.

| Document | What it answers |
|---|---|
| [security-questionnaire.md](security-questionnaire.md) | 39 standard questions, each answered Yes, Partial, No or Not applicable, with the test or document that backs it |
| [data-flow.md](data-flow.md) | Where each kind of data goes, drawn and tabulated |
| [subprocessors.md](subprocessors.md) | The third parties that process an organisation's data, and where |
| [residency.md](residency.md) | Where the data is, what leaves it, and what an organisation cannot choose yet |
| [../legal/dpa-draft.md](../legal/dpa-draft.md) | Data-processing terms: roles, data, the data-sharing choice, breach notice in 72 hours, deletion, transfers |
| [../legal/enterprise-terms-draft.md](../legal/enterprise-terms-draft.md) | Pilot and service terms: free pilots, targets (not commitments), support, incidents |
| [../enterprise/plans.md](../enterprise/plans.md) | The planned plans, with no price |
| [../enterprise-fleets.md](../enterprise-fleets.md) | What is built for fleets and what is not |

A test (`packages/asp-cli/test/procurement-pack.test.ts`) fails if an answer cites evidence that does not exist, a price appears, a certification is claimed, or the subprocessors list differs from the Privacy Notice.
