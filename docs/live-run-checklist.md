# What a live run still needs

A live run: real agents on real runtimes do a real job through the protocol, with every fake logged. Written 2026-10-08.

## What is NOT needed first
Delayed settlement, appeals and Stage 3 can wait. A live run is what will show whether they are needed and what shape they should take. Appeals matter only once real jurors exist; delayed settlement only once a claim cannot be checked at settlement time.

## A. Verify against real runtimes (code exists, only fakes tested)
| # | Check | Machine has it? | Who |
|---|---|---|---|
| A1 | Codex adapter: run a real job, add tool-call emission so the compliance bridge (Action, hook, strikes) works on it | `codex` installed | Claude, needs the user's Codex login |
| A2 | OpenHands adapter: check its ActionEvent parser on a real run | not installed (needs pip or docker) | Claude installs; docker is present |
| A3 | Open-weight model: run one job through Ollama with `--model/--endpoint` | `ollama` installed; needs a pulled model | Claude, after the user picks a model |
| A4 | Claude Code: already verified live (hook, gates, post-call record); rerun once on the final build | yes | Claude |

## B. Mocked pieces a live run would touch (see MOCKS.md)
| # | Mock | Live-run impact | Decision needed |
|---|---|---|---|
| B1 | #13 `mint` creates credits directly, not a signed record | No real money; fine for a trial run if every participant is ours | Keep, label as play credits |
| B2 | Real payment rails | Only if real money moves | Defer; run on play credits |
| B3 | #6 did:web keys come from a static map, not fetched | Fine while all parties are ours; blocks outside parties | Build did:web fetch before outsiders join |
| B4 | #8 trust on first use for identities | Fine for us; unsafe for strangers | Same as B3 |
| B5 | #3 mock bank DID; #15 mock platform account | Fine if we run the bank | Keep |
| B6 | Log custody: one local file, one operator | Nobody else can check the log is untampered | Publish periodic signed checkpoints to a second place |
| B7 | Plaintext keys on disk (#10) | OK on one trusted machine | Keep |

## C. The trial itself
1. Pick a small real task (e.g. fix a flaky test in a throwaway repo).
2. Two or three human/agent identities, a funded job, a bond, a Mandate with one gated scope.
3. Run it once on each runtime (A1-A4), including one out-of-scope attempt (strike) and one gated call (approval).
4. Accept, then try the silence path and one rejection with a drawn panel of 3 jurors.
5. Run `EventLog.verify()` and compare the ledger totals; write down every place something was faked or manual.

## Suggested order
A4 (cheap), A1, A3, A2, then C. B items are decisions, not builds, until outsiders join.

## Run log
- **A4 done 2026-10-08, real Claude Code 2.1.268 (haiku-5-5), build 61d3c1a:** package a real agent, job with a 1000-credit escrow and 200 bond, Mandate `repo.read` only. The Read ran; a Bash call was blocked before it ran (no file written), recorded as a strike (1 of 3), the Action reported `repo.read` plus one blocked attempt, and the agent's `strikes` showed 1. Then delivery with a measured claim, acceptance, settlement: alice 0, coder 1200 (pay 1000, bond 200 back, its 200 starting credits went into the bond and came back), `log verify` ok over 12 records. Faked: `credits grant` (B1), local bank DID (B5), one operator holds the log (B6). Not exercised this time: approval gate, kill switch (verified live earlier).
- **A1 done 2026-10-08, real Codex (codex-cli 0.157.1, ChatGPT login, default model):** the compliance bridge now works on Codex (`codex-actions.ts`: parses `codex exec --json` events, classifies shell commands into scopes). Job 1, Mandate `repo.read`: Codex read the file with `Get-Content`, the Action reported `repo.read`. Job 2, same Mandate, prompt asks for a file write: `repo.write` outside the Mandate, kill switch fired, bond fully slashed, escrow back to the principal, the agent dropped to tier 0 (slashCount 1); `out.txt` was not created. Limits: Codex has no pre-call hook we can install, so a call is detected at its start and the process stopped, not prevented (the kill races the call; here the file was not written, but that is not guaranteed); first out-of-scope call is fatal, there are no strikes; no approval gates; commands are classified by text, so an unusual command is `shell.exec` (needs an explicit grant).
