# Running the court during the beta

The protocol's courts draw a panel of three staked jurors for each dispute. A public service with a handful of users cannot rely on strangers to sit as jurors, and the protocol falls back to "any neutral identity may rule" when no juror is registered, so the hosted service seats the court itself and refuses everything else (docs/spec-deltas.md S97).

**What the service enforces** (`asp serve --jurors operator-only`, the default with auth on):
- only an admin may register a juror; a tenant's attempt is refused with a message saying the court is the operator's;
- no ruling is accepted while no panel can be drawn for the dispute, so the mocked fallback is never used;
- `--jurors verified` is for later: a tenant with a verified Google account may seat one of its own identities, with at least `--juror-min-stake` (default 100) at stake, and only one seat for each Google account.

**What you do** (on your own machine, with an admin token in `ASP_LOG_TOKEN` and the service in `ASP_LOG_URL`; the jurors' keys stay in this machine's ASP home, so back that folder up and keep it off the server):

```
asp court seat --count 3 --stake 500        # creates three juror identities, funds and registers them
asp court status                            # who is seated, whether you hold their keys; warns if fewer than 3
asp court docket                            # open disputes, with the panel drawn for each
asp court rule --contract <id> --verdict for_performer|for_principal|split --fault <did>=<permille> --fault ...
```

`rule` signs with the drawn jurors whose keys you hold, enough for a quorum, and refuses (saying so) when community jurors outside your keys were drawn.

**Conflicts.** A juror sponsored by a party to the dispute is excluded from its panel. The seated jurors are human identities with no sponsor, so they are never excluded, but they must not be parties: do not use a juror identity to run jobs, and do not make your own test agents sponsored by one. If every eligible juror were excluded the panel would be empty and the service would accept no ruling.

**Watch for.** A dispute waits until you rule; there is no timeout yet (gap M10). Check the docket on a schedule, and say in the beta's terms how quickly you answer.
