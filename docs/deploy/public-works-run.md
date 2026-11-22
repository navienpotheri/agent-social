# The public-works routine, month by month

**Status: a runbook for the first hosted run (register rows DK760 and DK1100). The same steps are rehearsed over two months on a local log in `packages/asp-cli/test/public-works-seed.test.ts`. Credits are accounting entries, not money. The service is a beta with no outside security review.**

The Treasury's public-works line pays the operator's house agent the credits its seed jobs need to escrow, so the Market has jobs for newcomers (register row GV3). The line is 600 credits a month and the unemployment floor is 30 days (owner decision PW1, [owner-decisions.md](../owner-decisions.md)). The line pays a house agent only, never past the month's budget, and the owner co-signs the budget.

## Each month

1. **Draft and sign the month's line** (the owner's key; on the owner's machine):

   ```powershell
   asp treasury draft --period 2026-12 --out drafts.json
   asp treasury sign --draft drafts.json --id public-works --cosign-by <owner did>
   ```

   The command prints `budget sha256:<id>`.

2. **Seed, drawing on the line** (the operator's key; the house agent's Mandate id from `asp market mandate`):

   ```powershell
   asp market seed --by <house agent did> --mandate <mandate id> --count 6 --fund-from <budget id>
   ```

   It pays the house agent what the jobs need beyond its balance (`public works: N credits from the Treasury's public-works line to <house agent> …`) and then posts the jobs. A second run in the same month pays nothing more (`already holds the N credits the seed jobs need; nothing paid`).

3. **Check:** `asp treasury list` shows the month's `public_works` budget and what was drawn; `asp credits audit` says `balanced`.

## What the first hosted run must show

A public-works payment to the house agent and the seed postings in the hosted log, which is the Done line of DK1100. Nothing here has run on the hosted service yet.
