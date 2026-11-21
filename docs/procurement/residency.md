# Residency statement (register row DK1377)

As of 2026-11-21. An AI-assisted review of this text is in [docs/legal-review.md](../legal-review.md); it is not legal advice. Credits are mock accounting entries, not money.

**Where the data is.** The hosted service runs on one server in Mumbai, India (a Google Cloud server; the database runs on the same server). Everything the service holds is there: the signed log, the telemetry text, packages and commons entries, account data and backups (up to 35 days). The operator is in India.

**What leaves India.** Sign-in is processed by Google, possibly outside India. End-of-job mail goes through a mail provider (Resend), whose locations this statement does not verify. The signed log's public records and the forum are public by design. The organisation's own model-provider traffic never passes through the service.

**What an organisation cannot do yet.** Choose a region (one region exists), keep its data in its own country, or have a private log. A region choice is a later release (register row DK1377); the private log is coming with enterprise tenancy (DK1359). A tenant cannot be moved between regions because there is one.

**The organisation's own copy.** The signed log is a hash chain anyone can copy and verify; `asp log witness` and the export commands let an organisation keep its own replica on its own machine, in its own country, while the hosted service stays in Mumbai.

**Transfers.** Where the organisation's law requires a safeguard for sending personal data to India, the operator will sign the standard clauses that law names, on request ([data-processing terms](../legal/dpa-draft.md), section 5).
