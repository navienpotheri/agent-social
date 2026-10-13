# Short-horizon and long-horizon tasks

Status: 2026-10-13. What changes when an agent works for minutes versus hours or days, what the protocol does about each difference, and what has been tested.

| | Short horizon (minutes) | Long horizon (hours to days) |
|---|---|---|
| **Shape** | One prompt, one session, one answer | A goal split into stages, over many sessions |
| **Mandate and standing job** | One, created on first use; the session ends long before it expires | One job must outlast the work (7 days); it must be renewed, and a renewed job must not lose the earlier history |
| **Records** | One to three per session | About half a record per tool call (64 records for 76 calls over 2.2 hours): a real quota cost, so the account's record limit matters |
| **Memory and learning** | Starts clean, nothing to carry | Memory carried between stages and written back; a wrong lesson early poisons later stages |
| **Drift** | Not a risk in a few minutes | The agent's behaviour can change across stages, after a memory update or a runtime change: needs a check at each stage (the canary, gap D1) |
| **Approvals** | The person is at the keyboard and answers | The person is away: a held call waits, an agent that retries must not hold the job for ever (two unanswered requests stop the asking) |
| **Failure** | Run it again | A failure in stage 6 must not lose stages 1 to 5: resume, not restart |
| **Interruptions** | Ctrl-C ends it | Sleep, wifi drops, provider rate limits (a real 429 for 3 minutes was seen), a restart: the work must survive and the unsent records must be kept |
| **Cost** | A few thousand tokens | Many sessions' tokens; a provider's usage limit can be reached partway |
| **What the person needs to see** | The answer and the summary | Progress, what is stuck, what was refused, and the day's view (docs/daily-view.md) |
| **Principal's control** | Reject the result | Redirect between stages, stop and keep the stages already done |

## What has been tested

- **Short horizon:** all of the common path (docs/testing-map.md), live, many times today.
- **Long horizon:** one real run on 2026-10-12, 2.2 hours, nine stages, 76 tool calls, 64 records, with memory carried between stages (UC-36, live). It found three real bugs (a stopped session leaving an approval open, a retry loop of 40 minutes, duplicate approval requests), all fixed.

## What has not

| Gap | Why it matters |
|---|---|
| Stage-by-stage drift checks on a long run (D1, D2) | The long-horizon failure that is hardest to see |
| Resuming after a failure partway, not restarting | A long job that restarts from the beginning is useless |
| Renewing a standing job that expires mid-work | A seven-day job cannot silently end on day seven |
| A person away for hours while approvals wait | The agent must carry on with what it can and stop asking, which the two-request limit does but has only been tested with stand-ins |
| The analysis backlog of the 2.2-hour run (docs/testing-map.md) | A real long run has more to teach than was read from it |

## What a long-horizon run needs the protocol to do that a short one does not

1. **Keep the history across sessions** (the standing job and its chain).
2. **Survive the person leaving** (queued approvals, a policy for what to do while away).
3. **Check itself as it goes** (a drift check, a canary, at each stage boundary).
4. **Never lose work to a record problem** (the outbox of T16 is the first piece of that).
5. **Say, at any moment, where it is** (the day's view).
