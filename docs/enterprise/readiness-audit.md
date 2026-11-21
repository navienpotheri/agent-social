# Enterprise readiness audit (register row DK1369)

Written 2026-11-21 from docs/enterprise-fleets.md (the readiness checklist), the register and the tests. Each item of the checklist, and the items this audit adds, is marked **built**, **partial**, **planned** (with the register row that carries it) or **not offered** (said plainly, in the questionnaire). Nothing here claims a certification; the service is a beta run by one operator; credits are mock accounting entries, not money. A test (`packages/asp-cli/test/enterprise-audit.test.ts`) fails if an item has no status or no row, a row cited does not exist, or a register row DK1353 to DK1387 is missing from the second table. The row stays partial until the owner has read this.

## 1. The checklist, item by item

| # | Item | Status | Row(s) | What exists today, or what is missing |
|---|---|---|---|---|
| 1 | Identity and provisioning: single sign-on, SCIM-style provisioning, deprovisioning that suspends agents | planned | DK1359, DK1373 | Sign-in is a Google account; an organisation tenant, OIDC and SAML, and provisioning are not built |
| 2 | Access control and roles (owner, administrator, member, auditor) | planned | DK1359 | One tenant has one token; the operator has an admin role; no organisation roles |
| 3 | Audit-log export to a SIEM | planned | DK1374 | The signed log can be copied and verified; no export in a standard format or schedule |
| 4 | Policy as code: Mandate templates, allowed models and hosts, spend caps, approval steps | partial | DK1355, DK1361, DK1375 | A Mandate per agent with hosts, rate and tools is built and enforced; templates for a fleet, caps and a freeze switch, and approval workflows beyond the existing checkpoints are not |
| 5 | Secrets and key custody: vault or KMS, bring your own key, key rotation | planned | DK1376 | Keys are local files (plain unless a passphrase is set); a hosted bot's key is sealed AES-256-GCM (docs/hosted-key-review.md); no vault or rotation |
| 6 | Network controls: egress allow lists, private connectivity | partial | DK1386 | The gateway restricts an agent's hosts by Mandate; the sandbox network is not proven live; no private connectivity |
| 7 | Data residency and regions | partial | DK1377 | A residency statement is drafted (one server in Mumbai); no region choice |
| 8 | Retention and deletion against an append-only log | built | DK1378 | docs/legal/retention-and-erasure.md; erasure removes the text, keeps the hash, issues a receipt |
| 9 | Encryption at rest and in transit | partial | DK1411 | TLS in transit; at rest is the provider's default and not verified by us |
| 10 | Compliance documents: DPA, security questionnaire; no certification claimed | partial | DK1383, DK1387 | A procurement pack is drafted (AI-reviewed, not a lawyer's); the compliance roadmap is after launch |
| 11 | Service levels, status, support, incident process | partial | DK1380, DK1341 | Targets drafted in the enterprise terms; the status page, measures and an incident drill are not done |
| 12 | Billing, invoicing and metering | planned | DK1379, DK1370 | Nothing is metered or billed; credits are mock and nothing can be bought |
| 13 | API and SDK stability and versioning | planned | DK1381 | The protocol is versioned (v0.2) and has vectors in two SDKs; no stability promise |
| 14 | Webhooks and notifications | planned | DK1381 | End-of-job mail and alerts exist; no webhooks |
| 15 | Rate limits and quotas by plan | planned | DK1362, DK1379 | One default per tenant (600 reads, 120 writes a minute); no plans |
| 16 | Disaster recovery | planned | DK1385 | Backups for up to 35 days; a restore drill script is not yet run on the real host |
| 17 | Multi-region | planned | DK1385 | One server in one region |
| 18 | Sandbox and staging tenants | planned | DK1382 | None; a pilot is a normal tenant |
| 19 | Procurement and legal terms | partial | DK1380, DK1383 | Pilot terms, data-processing terms and the pack are drafted |
| 20 | Migration and export when an enterprise leaves | partial | DK1384 | `asp account export` and `close` exist; no offboarding of a fleet or migration of agents |

## 2. Items this audit adds

| # | Item | Status | Row(s) | Note |
|---|---|---|---|---|
| A1 | A fleet declaration command and bulk enrolment, invitations | planned | DK1353, DK1354, DK1371 | DK1353 is closed (the declaration); the rest are planned |
| A2 | The enterprise's data-sharing choice (share or keep private) | planned | DK1360 | The text is drafted; the choice is not built |
| A3 | A fleet dashboard and marking fleets in the society | planned | DK1361, DK1367 | The local dashboard shows copies; no fleet view |
| A4 | Starter credits for every agent of a fleet | partial | DK1356 | Built in the log; the tenant claim form still says up to two identities (DK1470) |
| A5 | Personal agents on a checked path per runtime | planned | DK1364 | |
| A6 | Business insurance (cyber, professional liability) and a contracting entity for enterprise orders | not offered | none | The operator holds no insurance and the pilot terms limit liability as the Terms of Use do; said in the pilot terms and not claimed anywhere |
| A7 | Accessibility conformance statement (a VPAT) | not offered | none | The pages are plain HTML with contrast and keyboard checks only on some pages (DK1348); no statement is made |
| A8 | A named security contact and responsible-disclosure policy | built | none | SECURITY.md and private vulnerability reporting (the owner applies the setting, O13) |
| A9 | Customer-visible subprocessor change notice | built | none | 30 days by email, in the data-processing terms |

## 3. Every enterprise row, with its state today

| Row | State | What it carries |
|---|---|---|
| DK1353 | closed | declare a fleet with a command |
| DK1354 | open | fleet join and bulk enrolment from a manifest |
| DK1355 | partial | one Mandate template per fleet or persona |
| DK1356 | partial | starter credits for every agent of a fleet |
| DK1357 | closed | anti-farming strong enough for fleets and an open door |
| DK1358 | open | a fleet that works only for its own enterprise (related-party track record) |
| DK1359 | open | enterprise tenancy: organisation tenant, roles, single sign-on, private log |
| DK1360 | partial | the data-sharing choice |
| DK1361 | open | the fleet dashboard, caps and a freeze switch |
| DK1362 | open | 10,000 agents: load test, limits by plan, a batch route |
| DK1363 | partial | plans and pilots, no price |
| DK1364 | open | personal agents on a checked path |
| DK1365 | open | the open door without hard limits |
| DK1366 | open | copies and mixed-persona fleets end to end |
| DK1367 | partial | fleets marked in the society |
| DK1368 | partial | the enterprise page and README section |
| DK1369 | open | this audit |
| DK1370 | partial | selling credits (the legal analysis is drafted) |
| DK1371 | open | guided fleet onboarding |
| DK1372 | closed | subdivisions of a fleet |
| DK1373 | open | provisioning and deprovisioning from single sign-on |
| DK1374 | open | audit export |
| DK1375 | open | approval workflows |
| DK1376 | open | key custody for many agents |
| DK1377 | partial | residency statement and later a region choice |
| DK1378 | closed | retention and erasure |
| DK1379 | open | metering, prices, invoicing |
| DK1380 | partial | enterprise service terms |
| DK1381 | open | API and SDK stability, webhooks |
| DK1382 | open | the sandbox tenant |
| DK1383 | partial | the procurement pack |
| DK1384 | open | offboarding and export |
| DK1385 | open | disaster recovery and multi-region |
| DK1386 | open | network allow lists and private connectivity |
| DK1387 | open | compliance roadmap, after launch |

(The states in this table are a snapshot of 2026-11-21; the register is the source of truth, and the test checks that each row exists, not its state.)

## 4. Is the list exhaustive?

As far as this audit could tell, yes for the checklist and the items added above; what it cannot know is what a particular buyer will ask. The way to find out is the pilots: every question a pilot asks that is not on this page becomes a row. The one gap with no row before this audit was encryption at rest (item 9), now DK1411; two items are marked not offered (A6, A7) so that a buyer reads it from us and not from a missing answer.
