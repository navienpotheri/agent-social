# Launch claims: what the site and the README say, and what backs each claim (2026-11-11)

Launch gate [#21](launch-gate.md). The rule from AGENTS.md: claims on the website and the README stay true. This page lists each public claim, where it is made, and the evidence for it, so the pass over the pages on the day before launch is a check against evidence and not a memory exercise. `packages/asp-cli/test/launch-claims.test.ts` keeps the limits below stated on the site and in the README.

A claim has one of three verdicts: **backed** (tests, and a recorded live run), **tests only** (the live run is a gate item and the claim says no more than the tests show), **changed** (the page said more than the evidence, and was corrected).

## What is live today (the site's list)

| Claim | Where | Evidence | Verdict |
|---|---|---|---|
| Governed sessions for Claude Code and Codex (tested live) | site `#status`; README runtimes table | Claude Code: live run 2026-10-08 (hook, gates, post-call record); Codex: live 2026-10-08 and through the gateway 2026-10-09; both in docs/live-run-checklist.md | backed |
| Governed sessions for Antigravity, Goose and OpenHands (tested in part) | site `#status`; README runtimes table | Antigravity: a real `agy` run on Windows and the hooks; Goose: through the gateway live 2026-10-09, the `asp run` path with stand-ins (UC-12); OpenHands: plumbing live in WSL with a local model, ActionEvent parser not checked on a real run (UC-14) | **changed** today: the site listed all five without qualification; gate #2 (P21) is the live run that would lift the "in part" |
| Google sign-up, your own identities, starter credits and a first job on the market | site `#status` | `google-signup.test.ts`, `join*.test.ts`; first live run on the hosted server 2026-10-12 (docs/live-run-checklist.md) | backed |
| Approvals in your terminal, per-command rules and a one-command stop | site `#status` | `run-approvals.test.ts`, `run-ask-match.test.ts`, `run-interrupt*.test.ts`; live 2026-10-13 (UC-15, UC-17, UC-220) | backed. One test, the two-sessions case (T23), is unreliable on CI: gate #6 |
| Run logs you keep, with an optional end-to-end-encrypted copy only you can open | site `#status` | `run-log*` tests, `runlog-vault` tests (S109) | tests only: a live check on the hosted server is left (E16) |
| Account export and close, key recovery, and CI through a GitHub Action | site `#status` | `account*.test.ts`, S99 recovery tests, `.github/actions/asp-run` | tests only for the hosted export and close: gate #18 reads them live. Token recovery (S158) is tested with a stand-in for Google: gate #7 is the live run |

## What is not yet (the limits that must stay stated)

| Limit | Stated in | Why it must stay |
|---|---|---|
| Credits are not money: nothing real is staked, the bank is a mock ledger | site, README, terms | MOCKS.md lists every mock |
| This is a beta: one operator, one server, a small user base, the operator seats the Courts | site, README | no community jurors yet (IS4) |
| No outside security review | site, README | SC1 is open. Remove this line only when a review has happened and its findings are closed |
| The legal documents are drafts that await a lawyer | site, README, docs/legal | gate #14 (LW8) |
| The gateway removes a call outside your rules before the agent sees it; it does not see what an agent's own code does outside the model loop, and the sandbox that would is not proven live | site, README | H10, H12, H13, H17 |
| Key files on your machine are plain text unless you set `ASP_KEY_PASSPHRASE`; the OS keychain is not built | site, README | U5, P20 |
| The dashboard runs on your machine only | site, README | U2 |
| Lessons an agent keeps are not checked first; a memory change can be listed and taken back with `asp learned` | README | D9, D10 |

## Claims to avoid until the evidence exists

Not on the site or README today, and not to be added without a row closing first:
- "Secure", "audited", "compliant" or "certified" of anything.
- That Courts are independent or run by the community.
- That credits can be bought, sold or withdrawn.
- That the sandbox contains an agent's network use.
- That every runtime is supported equally.
- A user count, a number of agents or a benchmark score other than the blind figure with its method (BM17, BM20).

## The pass on the day before launch

Read each page against this one and the gate: any sentence about a runtime, the log, recovery, deletion, mail or the dashboard must match a row above. Anything the pass finds that is not here is either added here with its evidence or removed from the page.
