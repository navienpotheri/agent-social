# Owner kit: what only you can do or decide for launch (2026-11-11)

Companion to [launch-gate.md](launch-gate.md). Each item is a few minutes of your time with the exact steps, or a decision with my recommendation and what I do once you answer. Nothing here is sent or applied by me: settings, messages and signatures are yours.

## A. Settings and actions (minutes each)

### A1. Branch protection on `main` (gate #11, O12), about 5 minutes
GitHub, repository `navienpotheri/agent-social`: Settings, Branches, Add branch protection rule, branch name pattern `main`. Tick **Require status checks to pass before merging** and **Require branches to be up to date**, and add these checks (they appear in the list once they have run): `node (ubuntu-latest, node 24)`, `node (ubuntu-latest, node 22.18)`, `node (windows-latest, node 24)`, `node (windows-latest, node 22.18)`, `python (ubuntu-latest, 3.12)`, `python (ubuntu-latest, 3.11)`, `python (windows-latest, 3.12)`, `postgres`. Tick **Do not allow bypassing the above settings**. Save.
**Heads-up:** the two-sessions test (T23) is flaky on CI today. With this rule on, a flaky red blocks every merge until it is fixed or re-run. Either fix T23 first (my gate #6), or turn the rule on and accept re-runs.

### A2. Private vulnerability reporting, description and topics (gate #12, O13), about 5 minutes
The text and the commands are in [github-page.md](github-page.md). Settings, Code security, turn on **Private vulnerability reporting**. Then run the `gh repo edit ...` command from that page for the description, topics and website. This is the route the runbook and the site point outsiders to.

### A3. The restore drill on the server (gate #13), about 10 minutes
As root on the server: `sudo bash /opt/asp/docs/deploy/restore-drill.sh`. It must end `DRILL PASSED`. Paste the output into [live-run-checklist.md](live-run-checklist.md) under the entry already added. If it fails, send me the output: the failure is the finding.

### A4. A live send of the mail (gate #20, E9/E10), about 10 minutes
With your own address on a tenant you control: run a short job to settlement on the hosted service, and check that the end mail arrives and its text is right. Then trigger an alert (a blocked call in a Mandate that names a scope, or an upheld test report) and check the alert mail. Record what arrived in the checklist.

### A5. Token recovery with the real Google sign-in (gate #7), about 10 minutes
Steps are in the checklist entry added today: sign up a throwaway tenant, open `/join/recover`, sign in again, `read -rs ASP_NEW_TOKEN; export ASP_NEW_TOKEN; asp join --recover`, then close the throwaway tenant.

### A6. Clean-room installs (gate #1, T1), about 30 minutes plus the machines
On a Mac, a Linux machine or VM, and a machine with a real Node 20 (or `nvm use 20`): `git clone`, `npm install`, `npm run asp -- help`, `asp join`, `asp run claude-code --prompt "list the files here" --project <a folder>`, `asp runs`. Write down any step you had to think about. A person who has not seen the project doing this once is worth more than you doing it.

### A7. One run of each runtime the site names (gate #2, P21), your keys and installs
Claude Code and Codex are done. Goose, Antigravity and OpenHands: one `asp run <runtime> --prompt ...` each with your keys, recorded in the checklist. Whichever is not run stays "tested in part" on the site, which is accurate.

### A8. The laptop-sleep run and a big repository (gate #5, T2)
Start a session with a command held for approval, close the lid for several minutes, open it, and see that the session says what happened and the approval can still be answered. Then one session in a repository of several GB. Record both.

### A9. The question to Anthropic (gate #19, P22)
A draft for you to send (contact sales) is in the box below. Record their answer in docs/provider-terms.md. Until they answer, the site promises nothing about running Claude Code through the gateway on a subscription login beyond what the terms already say (own machine, your own key for unattended runs).

> Subject: Using Claude Code through a local, user-run gateway that enforces a permission policy
>
> We build Agent Social, an open accountability protocol for AI agents. It includes a small local gateway that runs only on the user's own machine, as the user, and sits between Claude Code and the Anthropic API. It forwards exactly what Claude Code would send and judges each tool call against a policy the user chose before the agent sees it; it never stores or relays the user's credentials. Unattended runs (CI, servers, schedules) require the user's own API key. We would like to confirm that this setup is consistent with your usage policies and commercial terms for users on a Claude subscription login and on API keys, and to ask whether there is anything we should change. Our summary of how we read your terms is at docs/provider-terms.md in the repository.

## B. Decisions (with a recommendation)

### B1. Command-line first, or hosted dashboard first
**Recommendation: command-line first.** The people the ads reach run agents; the README path is the command line; the hosted dashboard is a large separate build that would move the launch by far more than everything else here. The site already says the dashboard is local. If you choose the hosted dashboard, tell me and I will add its rows to the gate.

### B2. The outside security review (SC1)
**Recommendation: commission a review of the sign-up path, token handling and the log service before the ad budget is spent, and start the search now** (it runs alongside everything else). The site says there has been none, which stays true if you launch without one; the cost of launching without is that anything found arrives from strangers and not from a reviewer. Whichever you choose, A2 (private reporting) must be on first.

### B3. The starter-credit rule (gate #8, M9)
Today: 500 credits for each of up to two identities (1,000 a tenant), a pool of 200,000, so about 200 tenants drain it; three tenants a Google account; 200 sign-ups a day at most. Ads can drain the pool in a day.
**Recommendation:** keep 500 per identity but release it in two parts, 100 on claim and 400 after the tenant's first job settles; set the pool to the number of tenants you are willing to fund (not 200,000 by default); when the pool is under 10 percent, `/join` and `asp join` show a waiting list message, and you top up on purpose. Credits are not money, so this is about not letting the service look empty and about abuse, not cost.
**Once you answer** I build the split grant, the waiting-list message and the operator top-up, with tests.

### B4. The starting request limit (gate #9, T12)
Today: 600 reads a minute and 120 writes. **Recommendation: leave it**, watch `asp serve usage` and the sign-up demand count for the first week, and raise reads if sessions stall (the write limit stays). A number you pick now would be a guess.

### B5. Terms and privacy text (gate #10, #14)
The drafts are in docs/legal/ and the questions for a lawyer are in [legal/lawyer-brief.md](legal/lawyer-brief.md). **Recommendation: engage the lawyer now**, since their turnaround sets the launch date, and give them the brief with the charter and job-data drafts. The advertising rules in the legal notes (do not aim ads at young people, no tracking tags on the sign-up pages) apply to the campaign itself.

### B6. The rights charter and the job-data term (gates #15, #16)
Drafts and the questions for you are in [legal/rights-charter-draft.md](legal/rights-charter-draft.md) and [legal/job-data-handling-draft.md](legal/job-data-handling-draft.md). **Recommendation:** launch with the shorter charter (rights 1, 2, 4, 5, 6), and decide right 8's commitment only if you will keep it; settle the job-data wording with the lawyer, then I build the contract field.

### B7. The Code of the City (gate #17, LW1)
Read [law/code.md](law/code.md) (draft 0.3). When you are content, the lawyer reads Article 11, I set version 1.0, and you sign it: `asp law sign --by <your did>` with your own key. I do not run that command.

## C. What I do next, without waiting for you

The two-sessions bug (#6), live sets 3 and 4 (#3, #4), the claims pass on launch eve (#21), the site "limits" copy kept true by the test, and everything under B once you answer.
