# The operator's powers, their limits, and what is public

Register row GV9 (test: `packages/asp-log/test/operator-powers.test.ts`, which checks that each limit below is a rule in the code and that the operator's acts are listed in the public record). In the beta the operator is the officer of every institution ([charters](institutions/charters.md)). This page says what the operator can do, what stops it doing more, and how anyone sees it.

## Each power and its limit

| Power | The limit, and the rule that enforces it |
|---|---|
| Create credits | only a signed `mint` with a reason; a `treasury_issuance` needs the owner's co-signature (`mint_needs_cosign`); the supply rule is audited (`asp credits audit`) |
| Set a Treasury budget | the first budget of an institution, and a rise of more than a quarter, need the owner's co-signature; never beyond the Treasury's balance (`budget_over_balance`) |
| Suspend an identity | at most 7 days, with a reason and the Code article; a holder can take it to a Court panel that may extend it (`interim_too_long`, `case`) |
| Remove a name | the name only, never the identity, record or credits; the holder is heard first and can appeal (`takedown_not_heard`, `name_takedown`) |
| Publish or change a charter | 72 hours' notice, never retroactive; the owner co-signs officers, funding and a closing (`charter_notice`, `charter_needs_owner`) |
| Seat a Court | the operator seats the panel in the beta; a juror may not be a party, a party's sponsor, or share a sponsor, and one seat for each sponsor (`appeal_panel_conflict`) |
| Act as an institution | each act is a signed record in the log with its reason, so it can be read, cited and answered |

## What is public

Every record the operator or an institution it runs signs is listed in order at `GET /operator/acts`, from `EventLog.operatorActs()`. The log is append-only: an act can be answered by a later one and never removed.

## Succession

If the operator is unavailable, the owner holds the owner key that co-signs every founding, closing and issuance; the operator key and the institution keys are held as sealed key files and a recovery code (docs/live-run-identity.md). The plan the owner must choose and sign is on docs/owner-checklist.md.
