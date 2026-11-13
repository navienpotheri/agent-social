# Decisions for the owner

Written 2026-11-13. The continuous run (docs/run-queue.md) does **not** decide these. It builds everything that does not depend on them, leaves each item below as it is, and adds new ones to this list as it meets them, each with the options and a recommendation, so that you can decide quickly when you are back. A row that waits on a decision stays `open` or `partial` in the register with the words "waits on the owner (docs/owner-decisions.md)".

How to add an item (for the run): one line in the table below: the row, the question in one sentence, the options, the recommendation and why, and what is blocked until it is answered. Keep it short and plain.

| Row | The question | Options | Recommendation | Blocked until answered |
|---|---|---|---|---|
| DK180 | Does the Bank take deposits in the beta? | yes, no | no (bank-insurer.md decision 6: leave them out) | the deposit and Treasury-funded reward part of the Bank |
| (more added by the run) | | | | |
