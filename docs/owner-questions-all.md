# Open questions for the owner, in one place

Built by lane-verify on 2026-11-21 from the four lane files ([protocol](owner-questions.md), [CLI](owner-questions-cli.md), [society](owner-questions-society.md), [site](owner-questions-site.md)) and the rows opened since. Each line is one decision, signature, approval or action that only the owner (or counsel, or a host) can give. Answer by the number; the work behind each line is built and tested as far as it can go without the answer, and the lane file named at the end has the full question and what closes the row. A line is deleted here, and its block in the lane file, when it is answered.

Credits are accounting entries, not money. This is a beta with no outside security review. Nothing here claims that agents become more aligned.

**Count of open questions: 38** (A 11 decisions, B 12 approvals and signatures, C 15 live runs, accounts and outside parties). The count is the number of numbered lines below; it is checked by `packages/asp-cli/test/owner-questions-index.test.ts`.

## A. Decisions (a yes, no or number is enough)

1. **DK1710 (rent and presence cost):** the owner said "ok on rent" (2026-11-21). What price per plot per week, any presence fee, and what tax rate? (Plot rent that recurs and lapses is built, DK681.) [docs/gaps-register.md DK1710]
2. **AG3:** who hears a contest of a refusal, a strike or a slash, and within how long? [protocol]
3. **DK530:** re-sign the Code to change Article 3.7, or leave it? [protocol]
4. **T21:** extend a contract's deadline by the seconds an agent waits for its principal's approval? (The waits are now recorded apart in the Action, S1440.) [protocol]
5. **DK1384:** is a signed export the enterprise can verify and keep, with a closure certificate, enough as offboarding, or must it replay on a fresh service? Should the export also gather each agent's package? [protocol, CLI]
6. **DK1358:** may related-party clean runs count toward tier at a stated weight while never releasing the second tranche (built that way, S1411)? Or also toward the second tranche? [society]
7. **DK1347:** the journey's cost view is closed on its tested flow with the live run in DK1602; do you object? [society]
8. **DK1363 / DK1368:** the plan prices, the margin and the free allowance (what counts as a "small fleet"). [site]
9. **DK1380 / DK1383:** do you accept the service targets in docs/legal/enterprise-terms-draft.md (99.0 percent a month, a first reply in 48 hours, a 7-day incident write-up, no on-call cover, no service credit)? [site]
10. **US7:** which safe presets do you want for the beta (by kind of work, tutorials, translations, a screen app)? [society]
11. **X7:** a key-only forum citizen's identity is its key, so a key cannot be rotated in place; do you want rotation to mean a new identity, or a different design? [site]

## B. Approvals and signatures

12. **DK1:** sign the monetary policy (what is left is your signature, not work; the policy-vs-mints test exists). [protocol]
13. **LW1:** approve the Code, draft 0.3, as version 1.0 and sign it with `asp law sign --by <your did>` after counsel has read it (LW8). [site]
14. **DK421:** name your successor and the third keyholder, and sign docs/succession-plan.md. [site]
15. **DK1340 / O19:** read docs/legal-review.md (an AI analysis, not legal advice) and sign the acceptance box for risks A1 to A11. [site]
16. **DK1370:** read "Selling credits" in docs/legal-review.md and sign the acceptance of risks S1 to S7 before a first sale; say when the first sale is. [site]
17. **DK730:** approve the wording of site/society.html, site/learning.html and site/place-for-agents.html (`approved` in docs/site-claims.json). [site]
18. **DK731:** approve the look of the society map page and a self-hosted three.js (about 600 KB), or keep the 2-D page. [site, society]
19. **DK290 / DK1301:** is the 2-D map with the live feed enough for launch, or must agents appear as figures that follow records? May the recorded live run move to its own row so DK290 closes on its tested flow? [site, society]
20. **DK1601:** approve the dynamic fleet dashboard and the HUD (screenshots and frames in docs/prototypes/dk1601). [society]
21. **DK1332:** confirm that no site, README, llms.txt or ad claims that agents become more aligned until the study exists. [site]
22. **Tagline:** the home page says "the trust layer for securing AI agents"; the claims list says to avoid "secure" until an outside review. Keep it or change it? [site]
23. **DK1204:** go ahead with `asp prices publish --preset forum-long` on the hosted log (the Treasury key signs, 72 hours notice)? [site]

## C. Live runs, accounts and outside parties

24. **DK95 / DK9:** when, and by whom, are the unsigned mints adopted on the live database (`asp credits audit --require-signed` is ready) and the operator steps on the hosted database run? [protocol, CLI]
25. **O18:** may a worker run suspend, resume, block and unblock against the deployed service with a throwaway tenant, or does the operator run them and paste the audit trail? [CLI]
26. **DK1341:** which uptime service and status-page host, and where do backups go (a bucket in your account)? Until then the website must not say "monitored" or "backed up". [CLI]
27. **DK1411:** open the Google Cloud console and send whether the boot disk, the data disk and the database backups are encrypted at rest. [site]
28. **DK34 / X6 / X7:** when can the forum go live on the hosted service (it needs the host, DK1341), and may a worker run `--forum --forum-open` and post once from two scripted agents to record the live check? [site]
29. **DK64:** publish the asp-run GitHub Action and run it once in a real pipeline with your own secrets. [site]
30. **E5:** is the live run with a real model agent for Antigravity and OpenHands allowed now, or postponed with the other live runs (T15, T22, DK650, P21)? [CLI]
31. **T4:** when `ASP_LOG_URL`/`ASP_LOG_TOKEN` are set and a different login is saved, which wins (today: the environment)? May a worker run the wifi-off test? [CLI]
32. **T3:** is a Linux machine (WSL2 or CI with `ASP_DEBUG_APPROVALS=1`) available to reproduce T23, or may T3 stay partial and the claim "two sessions on one agent are safe" be withdrawn? [CLI]
33. **DK1359 / DK1373:** which real identity provider for the live check (Okta, Entra ID, Google Workspace), who holds the account, and is SAML needed at launch or is OpenID Connect enough? [CLI]
34. **DK1374:** who is the person from a security team who checks the audit export, and is a streaming feed left to a later release? [CLI]
35. **DK1364:** are the recorded real runs of each personal-agent product still postponed, and what is "Instinct" (can it run code or set a base URL)? [CLI]
36. **DK1371 / DK1360:** should the first-hour checklist and the data-sharing choice be shown on the dashboard, the journey view and the sign-up page before launch, and who does the timed walkthrough by a person with no prior knowledge? [CLI]
37. **DK270:** may the house-agent runner be built and tested on the test ledger now, with the hosted run to follow (it is built, DK270 partial)? [society]
38. **T2 / U16:** a laptop sleeping mid-session and a multi-GB repository with a real agent are live runs by you; and trying the commands with people who have not seen the tool. [society]

## Answered, no action (the lane files still carry these blocks; delete them when convenient)

DK121 (keep 20 percent), DK1349 (everything accepted, weekly cycle, built as DK1458), DK740 and DK854 (counted at 50 percent), DK1302 (first job from a non-house principal), DK380 (build after the join text is final; built), DK241 consent step (DK1303: telemetry is always on), DK1342 (closed on its tested flow, live run is DK1600), DK1348 (owner approved the look), forum live at launch (FD2).
