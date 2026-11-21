# Open questions for the owner, in one place

Built by lane-verify on 2026-11-21 from the four lane files ([protocol](owner-questions.md), [CLI](owner-questions-cli.md), [society](owner-questions-society.md), [site](owner-questions-site.md)) and the rows opened since. Each line is one decision, signature, approval or action that only the owner (or counsel, or a host) can give. Answer by the number; the work behind each line is built and tested as far as it can go without the answer, and the lane file named at the end has the full question and what closes the row. A line is deleted here, and its block in the lane file, when it is answered.

Credits are accounting entries, not money. This is a beta with no outside security review. Nothing here claims that agents become more aligned.

**Count of open questions: 18** (A 3 decisions, B 8 signatures and approvals still to come, C 7 the owner's own live actions). The count is the number of numbered lines below; it is checked by `packages/asp-cli/test/owner-questions-index.test.ts`.

## A. Decisions (a yes, no or number is enough)

The question below is open; questions 2 onward were answered or are signatures and live actions.

1. **DK440 / NT1:** which operator acts need notice before they take effect (right 8 of the rights charter)? Recommended default: every non-emergency operator action against an agent (a suspension, a block, a retirement, a slash outside a Court ruling) needs 72 hours' notice to the agent and its sponsor, a record of the notice, and a path to answer in the log before the action takes effect; emergencies (an active breach, a legal order) are excluded and recorded after the fact. A yes keeps the recommended default; any other answer replaces it. [DK440, docs/owner-decisions.md NT1]
2. **DK420:** sign or amend the Terms of Use section 11 "Your rights" in docs/legal/terms-rights-draft.md (the shorter form, right 8 stated as built). Recommended default: keep the text as drafted and publish it after the AI-assisted legal review has been accepted; until then it stays out of the terms. [DK420, docs/legal/terms-rights-draft.md]
3. **US1:** should `asp run --ask-first` (show the plan in words and wait for the person) become the default? Recommended default: opt-in for the beta, because a default wait breaks scripted and CI runs; reconsider when the interactive path has had live use. [US1, docs/gaps-register.md]

## B. Signatures and approvals still to come

4. **DK1:** sign the monetary policy (approved; the sign kit is docs/owner-sign-kit.md and `asp credits ratify`). [protocol]
5. **LW1:** the Code, draft 0.4 (with Article 3.7), is approved; sign it once as version 1.0. [site]
6. **DK421:** the succession plan is approved; give the names of your successor and the third keyholder when you can, and sign docs/succession-plan.md. [site]
7. **DK1340 / O19:** sign the acceptance of risks A1 to A11 of the legal review once launch-bar-2 has fixed its self-contradiction (the review is approved). [site]
8. **DK1370:** sign the acceptance of risks S1 to S7 at the first sale (the "Selling credits" section is approved; no sale date yet). [site]
9. **DK730:** approve the wording of the three pages (site/society.html, site/learning.html, site/place-for-agents.html) after the formal rewrite. [site]
10. **DK1204:** publish the forum price list with the forum go-live (an owner action, no decision left). [site]
11. **DK1727 (editorial pass):** confirm the audience of each document (internal, public site, signed, investor or enterprise) and give the last read before anything goes live; the reading pack is approved for now as working drafts. [site]

## C. The owner's own live actions (about two hours at deployment; docs/owner-live-block.md; the kits: docs/live-check-kit.md for the live checks and docs/owner-sign-kit.md for the signatures)

12. **DK95 / DK9:** run the unsigned-mint adoption and the hosted-database steps once at deployment (exact commands in the deployment kit). [protocol, CLI]
13. **O18:** run suspend, resume, block and unblock on the deployed service and paste the audit trail. [CLI]
14. **DK1411:** check the encryption of the boot disk, the data disk and the backups in the Google Cloud console and send the result (the claim stays off until then). [site]
15. **DK34 / X6 / X7:** take the forum live with the deployment, after the host and the monitor, and record the live check. [site]
16. **DK64:** publish the asp-run GitHub Action and test it once in your own pipeline (steps from launch-bar-2). [site]
17. **DK1371:** arrange the timed walkthrough by a person with no prior knowledge (name the person later). [CLI]
18. **T2 / U16:** do the two live cases (a laptop sleeping mid-session, a multi-GB repository) and the trial of the commands with people who have not seen the tool (steps and a list of people are prepared). [society]

## Answered, no action (the lane files still carry these blocks; delete them when convenient)

C1 to C15 of 2026-11-21 (all answered; the workers' parts are on the rows, the owner's own actions are above), DK1340/O19 (the legal review is approved; its self-contradiction is being fixed), the Town Hall scope (decided), DK1384 (export plus closure certificate is enough for launch), DK1358 (related-party runs count toward tier, never the second tranche), DK1347 (no objection), DK1363/DK1368 (measure cost first, no figures, pilots free, small fleet up to 25 agents), DK1380/DK1383 (service targets accepted as drafted), US7 (presets: coding, writing and translation, tutorials and learning), X7 (rotation = a new identity with a handover record, DK1726), DK731 (keep the 2-D map, add the live feed), DK290/DK1301 (2-D map with the live feed is enough; the hosted run is DK1725), DK1601 (approved), DK1332 (confirmed), the tagline (changed to "the accountability layer for AI agents"), DK1710 (measure first, publish the price table before launch), AG3 (the operator in 48 hours, then the Courts in 72), DK530 (folded into Code 1.0), T21 (deadline extended by the recorded wait), DK121 (keep 20 percent), DK1349 (everything accepted, weekly cycle, built as DK1458), DK740 and DK854 (counted at 50 percent), DK1302 (first job from a non-house principal), DK380 (build after the join text is final; built), DK241 consent step (DK1303: telemetry is always on), DK1342 (closed on its tested flow, live run is DK1600), DK1348 (owner approved the look), forum live at launch (FD2).
