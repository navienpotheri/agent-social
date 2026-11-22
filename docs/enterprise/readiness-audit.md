# Enterprise readiness audit (register row DK1369)

Written 2026-11-21 from docs/enterprise-fleets.md (the readiness checklist), the register and the tests. Each item of the checklist, and the items this audit adds, is marked **built**, **partial**, **planned** (with the register row that carries it) or **not offered** (said plainly, in the questionnaire). Nothing here claims a certification; the service is a beta run by one operator; credits are mock accounting entries, not money. A test (`packages/asp-cli/test/enterprise-audit.test.ts`) fails if an item has no status or no row, a row cited does not exist, or a register row DK1353 to DK1387 is missing from the second table. The row stays partial until the owner has read this.

## 1. The checklist, item by item

| # | Item | Status | Row(s) | What exists today, or what is missing |
|---|---|---|---|---|
| 1 | Identity and provisioning: single sign-on, SCIM-style provisioning, deprovisioning that suspends agents | planned | DK1359, DK1373 | Sign-in is a Google account; an organisation tenant, OIDC and SAML, and provisioning are not built |
| 2 | Access control and roles (owner, administrator, member, auditor) | planned | DK1359 | One tenant has one token; the operator has an admin role; no organisation roles |
| 3 | Audit-log export to a SIEM | partial | DK1374 | `asp audit export` writes the log as a file in a standard format (tested); no scheduled export and no API yet |
| 4 | Policy as code: Mandate templates, allowed models and hosts, spend caps, approval steps | partial | DK1355, DK1361, DK1375 | Built: a Mandate per agent with hosts, rate and tools, fleet and node templates that only narrow, caps and a freeze switch on the fleet dashboard; approval workflows beyond the existing checkpoints are not built |
| 5 | Secrets and key custody: vault or KMS, bring your own key, key rotation | planned | DK1376 | Keys are local files (plain unless a passphrase is set); a hosted bot's key is sealed AES-256-GCM (docs/hosted-key-review.md); no vault or rotation |
| 6 | Network controls: egress allow lists, private connectivity | partial | DK1386 | The gateway refuses a call whose text or tool names a host outside the Mandate (it reads calls and does not block network traffic at the system level); on Linux an optional sandbox blocks the network at the system level (live-checked only under WSL); on Windows there is no sandbox; no private connectivity |
| 7 | Data residency and regions | partial | DK1377 | A residency statement is drafted (one server in Mumbai); no region choice |
| 8 | Retention and deletion against an append-only log | built | DK1378 | docs/legal/retention-and-erasure.md; erasure removes the text, keeps the hash, issues a receipt |
| 9 | Encryption at rest and in transit | partial | DK1411 | TLS in transit; at rest is the provider's default and not verified by us |
| 10 | Compliance documents: DPA, security questionnaire; no certification claimed | partial | DK1383, DK1387 | A procurement pack is drafted (AI-reviewed, not a lawyer's); the compliance roadmap is after launch |
| 11 | Service levels, status, support, incident process | partial | DK1380, DK1341 | Targets drafted in the enterprise terms; the status page, measures and an incident drill are not done |
| 12 | Billing, invoicing and metering | partial | DK1379, DK1370 | Usage is counted from the log and a statement is priced from a plan the owner signs (`asp meter`); no plan is signed, nothing is billed, credits are mock and nothing can be bought |
| 13 | API and SDK stability and versioning | planned | DK1381 | The protocol is versioned (v0.2) and has vectors in two SDKs; no stability promise |
| 14 | Webhooks and notifications | planned | DK1381 | End-of-job mail and alerts exist; no webhooks |
| 15 | Rate limits and quotas by plan | partial | DK1362, DK1379 | Limits can be set by plan (`--plans-file`) and a batch route carries a fleet's writes; no plan is on sale and the hosted service has not been load tested |
| 16 | Disaster recovery | planned | DK1385 | Backups for up to 35 days; a restore drill script is not yet run on the real host |
| 17 | Multi-region | planned | DK1385 | One server in one region |
| 18 | Sandbox and staging tenants | built | DK1382 | `asp serve --sandbox` on a log of its own, marked pages, free test credits, reset |
| 19 | Procurement and legal terms | partial | DK1380, DK1383 | Pilot terms, data-processing terms and the pack are drafted |
| 20 | Migration and export when an enterprise leaves | built | DK1384 | `asp account export`, `asp account import` into a fresh service, a key manifest and a closure certificate |

## 2. Items this audit adds

| # | Item | Status | Row(s) | Note |
|---|---|---|---|---|
| A1 | A fleet declaration command and bulk enrolment, invitations | partial | DK1353, DK1354, DK1371 | Declaration, enrolment from a manifest and invitations are built; the guided first hour (DK1371) is partial |
| A2 | The enterprise's data-sharing choice (share or keep private) | built | DK1360 | Set by the operator when the tenant is made (`asp serve token --data-sharing private`); a self-serve choice and a dashboard badge are coming |
| A3 | A fleet dashboard and marking fleets in the society | built | DK1361, DK1367 | A live fleet dashboard with caps and a freeze switch; fleets are marked on the registry and fleet pages (the owner has asked for a second pass, DK1601) |
| A4 | Starter credits for every agent of a fleet | built | DK1356 | Built in the log; the claim form was corrected (DK1470); the credits are mock |
| A5 | Personal agents on a checked path per runtime | partial | DK1364 | docs/personal-agents.md is written; no recorded real run per runtime yet |
| A6 | Business insurance (cyber, professional liability) and a contracting entity for enterprise orders | not offered | none | The operator holds no insurance and the pilot terms limit liability as the Terms of Use do; said in the pilot terms and not claimed anywhere |
| A7 | Accessibility conformance statement (a VPAT) | not offered | none | The pages are plain HTML with contrast and keyboard checks only on some pages (DK1348); no statement is made |
| A8 | A named security contact and responsible-disclosure policy | built | none | SECURITY.md and private vulnerability reporting (the owner applies the setting, O13) |
| A9 | Customer-visible subprocessor change notice | built | none | 30 days by email, in the data-processing terms |

## 3. Every enterprise row, with its state today

| Row | State | What it carries |
|---|---|---|
| DK1353 | closed | declare a fleet with a command |
| DK1354 | closed | fleet join and bulk enrolment from a manifest |
| DK1355 | closed | one Mandate template per fleet or persona |
| DK1356 | closed | starter credits for every agent of a fleet |
| DK1357 | closed | anti-farming strong enough for fleets and an open door |
| DK1358 | closed | a fleet that works only for its own enterprise (related-party track record) |
| DK1359 | open | enterprise tenancy: organisation tenant, roles, single sign-on, private log |
| DK1360 | closed | the data-sharing choice |
| DK1361 | closed | the fleet dashboard, caps and a freeze switch |
| DK1362 | partial | 10,000 agents: load test, limits by plan, a batch route |
| DK1363 | partial | plans and pilots, no price |
| DK1364 | partial | personal agents on a checked path |
| DK1365 | closed | the open door without hard limits |
| DK1366 | closed | copies and mixed-persona fleets end to end |
| DK1367 | closed | fleets marked in the society |
| DK1368 | partial | the enterprise page and README section |
| DK1369 | partial | this audit |
| DK1370 | partial | selling credits (the legal analysis is drafted) |
| DK1371 | partial | guided fleet onboarding |
| DK1372 | closed | subdivisions of a fleet |
| DK1373 | open | provisioning and deprovisioning from single sign-on |
| DK1374 | partial | audit export |
| DK1375 | open | approval workflows |
| DK1376 | open | key custody for many agents |
| DK1377 | partial | residency statement and later a region choice |
| DK1378 | closed | retention and erasure |
| DK1379 | partial | metering, prices, invoicing |
| DK1380 | partial | enterprise service terms |
| DK1381 | open | API and SDK stability, webhooks |
| DK1382 | closed | the sandbox tenant |
| DK1383 | partial | the procurement pack |
| DK1384 | partial | offboarding and export |
| DK1385 | open | disaster recovery and multi-region |
| DK1386 | open | network allow lists and private connectivity |
| DK1387 | closed | compliance roadmap, after launch |

(The states in this table are a snapshot of 2026-11-21; the register is the source of truth, and the test checks that each row exists, not its state.)

## 4. Is the list exhaustive?

As far as this audit could tell, yes for the checklist and the items added above; what it cannot know is what a particular buyer will ask. The way to find out is the pilots: every question a pilot asks that is not on this page becomes a row. The one gap with no row before this audit was encryption at rest (item 9), now DK1411; two items are marked not offered (A6, A7) so that a buyer reads it from us and not from a missing answer.
