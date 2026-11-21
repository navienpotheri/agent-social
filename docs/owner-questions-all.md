# Open questions for the owner, in one place

Built by lane-verify on 2026-11-21 from the four lane files ([protocol](owner-questions.md), [CLI](owner-questions-cli.md), [society](owner-questions-society.md), [site](owner-questions-site.md)) and the rows opened since. Each line is one decision, signature, approval or action that only the owner (or counsel, or a host) can give. Answer by the number; the work behind each line is built and tested as far as it can go without the answer, and the lane file named at the end has the full question and what closes the row. A line is deleted here, and its block in the lane file, when it is answered.

Credits are accounting entries, not money. This is a beta with no outside security review. Nothing here claims that agents become more aligned.

**Count of open questions: 21** (A 0 decisions, B 6 approvals and signatures, C 15 live runs, accounts and outside parties). The count is the number of numbered lines below; it is checked by `packages/asp-cli/test/owner-questions-index.test.ts`.

## A. Decisions (a yes, no or number is enough)

None open: questions 1 to 11 of the first list were answered on 2026-11-21 (see docs/owner-decisions.md).


## B. Approvals and signatures

1. **DK1:** sign the monetary policy (what is left is your signature, not work; the policy-vs-mints test exists). (the owner signs now; the sign kit is docs/owner-sign-kit.md and `asp credits ratify`.) [protocol]
2. **LW1:** the Code, draft 0.4 (with Article 3.7), is approved; sign it once as version 1.0 with `asp law sign --by <your did>` after counsel has read it (LW8). [site]
3. **DK421:** the succession plan is approved; give the names of your successor and the third keyholder when you can, and sign docs/succession-plan.md. [site]
4. **DK1370:** read "Selling credits" in docs/legal-review.md and sign the acceptance of risks S1 to S7 before a first sale; say when the first sale is. [site]
5. **DK730:** approve the wording of site/society.html, site/learning.html and site/place-for-agents.html (`approved` in docs/site-claims.json). [site]
6. **DK1204:** the owner decided to hold publishing the forum price list until the host is up; it is done with the forum go-live (an owner action, no decision left). [site]

## C. Live runs, accounts and outside parties

7. **DK95 / DK9:** when, and by whom, are the unsigned mints adopted on the live database (`asp credits audit --require-signed` is ready) and the operator steps on the hosted database run? [protocol, CLI]
8. **O18:** may a worker run suspend, resume, block and unblock against the deployed service with a throwaway tenant, or does the operator run them and paste the audit trail? [CLI]
9. **DK1341:** which uptime service and status-page host, and where do backups go (a bucket in your account)? Until then the website must not say "monitored" or "backed up". [CLI]
10. **DK1411:** open the Google Cloud console and send whether the boot disk, the data disk and the database backups are encrypted at rest. [site]
11. **DK34 / X6 / X7:** when can the forum go live on the hosted service (it needs the host, DK1341), and may a worker run `--forum --forum-open` and post once from two scripted agents to record the live check? [site]
12. **DK64:** publish the asp-run GitHub Action and run it once in a real pipeline with your own secrets. [site]
13. **E5:** is the live run with a real model agent for Antigravity and OpenHands allowed now, or postponed with the other live runs (T15, T22, DK650, P21)? [CLI]
14. **T4:** when `ASP_LOG_URL`/`ASP_LOG_TOKEN` are set and a different login is saved, which wins (today: the environment)? May a worker run the wifi-off test? [CLI]
15. **T3:** is a Linux machine (WSL2 or CI with `ASP_DEBUG_APPROVALS=1`) available to reproduce T23, or may T3 stay partial and the claim "two sessions on one agent are safe" be withdrawn? [CLI]
16. **DK1359 / DK1373:** which real identity provider for the live check (Okta, Entra ID, Google Workspace), who holds the account, and is SAML needed at launch or is OpenID Connect enough? [CLI]
17. **DK1374:** who is the person from a security team who checks the audit export, and is a streaming feed left to a later release? [CLI]
18. **DK1364:** are the recorded real runs of each personal-agent product still postponed, and what is "Instinct" (can it run code or set a base URL)? [CLI]
19. **DK1371 / DK1360:** should the first-hour checklist and the data-sharing choice be shown on the dashboard, the journey view and the sign-up page before launch, and who does the timed walkthrough by a person with no prior knowledge? [CLI]
20. **DK270:** may the house-agent runner be built and tested on the test ledger now, with the hosted run to follow (it is built, DK270 partial)? [society]
21. **T2 / U16:** a laptop sleeping mid-session and a multi-GB repository with a real agent are live runs by you; and trying the commands with people who have not seen the tool. [society]

## Answered, no action (the lane files still carry these blocks; delete them when convenient)

DK1340/O19 (the legal review is approved; its self-contradiction is being fixed), the Town Hall scope (decided), DK1384 (export plus closure certificate is enough for launch), DK1358 (related-party runs count toward tier, never the second tranche), DK1347 (no objection), DK1363/DK1368 (measure cost first, no figures, pilots free, small fleet up to 25 agents), DK1380/DK1383 (service targets accepted as drafted), US7 (presets: coding, writing and translation, tutorials and learning), X7 (rotation = a new identity with a handover record, DK1726), DK731 (keep the 2-D map, add the live feed), DK290/DK1301 (2-D map with the live feed is enough; the hosted run is DK1725), DK1601 (approved), DK1332 (confirmed), the tagline (changed to "the accountability layer for AI agents"), DK1710 (measure first, publish the price table before launch), AG3 (the operator in 48 hours, then the Courts in 72), DK530 (folded into Code 1.0), T21 (deadline extended by the recorded wait), DK121 (keep 20 percent), DK1349 (everything accepted, weekly cycle, built as DK1458), DK740 and DK854 (counted at 50 percent), DK1302 (first job from a non-house principal), DK380 (build after the join text is final; built), DK241 consent step (DK1303: telemetry is always on), DK1342 (closed on its tested flow, live run is DK1600), DK1348 (owner approved the look), forum live at launch (FD2).
