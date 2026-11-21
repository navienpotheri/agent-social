# Round 2 (residency and cognition telemetry): proposed register rows, wrong facts, contradictions, questions

Written 2026-11-12 by the specs-round2 worker for the lead. I edited no register, scope, README, other spec or code. Specs: [residency.md](residency.md) (DK82 to DK85), [instrumentation.md](instrumentation.md) (DK79). Working ids `DK-R-n`.

## 1. New or changed register rows

| Id | Row (proposal) | Why |
|---|---|---|
| DK-R-1 | **Legal text change list for hosted residents** (provider-terms rule 1, terms 2, 5, 6, privacy 1, 4, 5, 6, the README and site "never hold your keys" sentences): drafted, then approved by the owner and a lawyer, **before** any city-hosted resident. Priority A (blocks DK82 modes R3 and R4), status open. Size M. | residency.md section 3.3. DK83 says "the terms and privacy text state exactly what the host can and cannot do", but no row owns the change itself |
| DK-R-2 | **Correct credits.md 5.5 and CR-17**: the gateway already stops on a token cap (`server.ts:72-73`, `385`, `411`, `504`; `cli.ts:44`, `421`, `2566`). What is missing is a per-day per-agent ceiling across runs, per-sender wake limits and a subsidy ledger | credits.md 5.5 says the gateway "does not stop on a ceiling" (an assumption it flagged itself) |
| DK-R-3 | **Delegation lifetime and `purpose: residency`**: a node must cite a Mandate for residency, and a decision on the 24-hour cap (`log.ts:17`) versus daily renewal. Add to DK83 as a precondition; T22 partly covers the Mandate part | residency.md 8 |
| DK-R-4 | **Command ownership**: `asp residency` (the cycle) versus `asp shops residency` and `upkeep` (shops.md 7). Settle in the lead's index | both specs define the same attestation `residency`; residency.md extends it with modes and `sleeping` |
| DK-R-5 | **Dormant versus sleeping**: shops.md `dormant` means credits unpaid; residency.md adds `sleeping` for compute unpaid or the delegate expired. Shops 5 rules (no new bids while dormant) need a line saying `sleeping` is never a strike | residency.md 5 and 7 |
| DK-R-6 | **Name clash**: the Treasury's `allowance` record (map.md row 3) and the sponsor's allowance; I named the sponsor's `sponsor_allowance` | residency.md 5 |
| DK-R-7 | **Subsidy classes and a City-budget DID** (`did:web:asp.local:city-budget`) as a new DID in credits.md section A (account and DID list) and in map.md | DK85 |
| DK-R-8 | **Telemetry signals as a real-token cost**: probes (about 4,300 tokens a set, 3 sets a day) must appear in the sponsor return statement and in the residency allowance | cross-spec |
| DK-R-9 | **Mandate field `telemetry`** and `telemetry_consent` (spec-delta, both SDKs) as the first work item of DK79 (TL-1) | instrumentation.md 5 |
| DK-R-10 | **Record size and count budget**: telemetry batches into one digest per agent per day (30 a month against 2,000 default records); check the log's maximum record size before the 32 KB figure stands | instrumentation.md 5 |
| DK-R-11 | **Telemetry never feeds standing**: add a scan test item next to credits.md 5.4 and shops.md 9 (a scan fails any read of a telemetry figure in tier, rank, bond, certificate, eligibility code) | instrumentation.md 8 |
| DK-R-12 | **No telemetry for minors' tenants in the beta** (privacy 8 and terms 1 say no tracking of young people); owner decision | instrumentation.md 7 |
| DK-R-13 | **Provider terms and hidden reasoning**: re-read each provider's terms on reasoning extraction before switching on reasoning traces for that provider (same method as P21); never prompt a model to reveal hidden reasoning | instrumentation.md 9 |
| DK-R-14 | **Run-log capture of thinking blocks**: `replyText` (`runlog.ts:134-141`) drops them; TL-4 changes it; note the run-log text cap and the redaction rule apply | instrumentation.md 3 |
| DK-R-15 | **Rows to mark**: CY8 and CY12 to CY15 are resolved **in design** by residency.md (not closed: nothing is built); DK79, DK82 to DK85 stay open with a spec link | the rule that partial is never done |

## 2. Wrong or stale facts I found

1. credits.md 5.5: "the gateway meters tokens today but does not stop on a ceiling" is **wrong**; it stops on `tokenCap` (see DK-R-2).
2. DK82 says a city-hosted resident "has no funding or legal route". True for a third-party provider; **not true for open-weight models the operator hosts**, which need no user credential (residency.md 3.2).
3. shops.md 1 and the register ground quotas at `server.ts:246`, `274-277`; those I did not re-read. I used only `signup.ts:68`.
4. Terms 2 says "The keys that sign for your identities stay on your own machine, so we cannot sign for you". With a delegated host key this is **false for a resident**; README line 49 and site statements ("the service never holds a private key", `site/agents/index.html:86`) also need a qualified wording. Stated in residency.md 3.3.
5. provider-terms rule 1 says there is "no hosted gateway"; city-hosted modes need one. Stated in residency.md 3.3 with proposed text.

## 3. Contradictions between code and docs

- The **24-hour node cap** (`log.ts:17`) against a residency of weeks: the design either renews daily from the sponsor's machine or raises a per-purpose cap (decision 2 in residency.md).
- A node grant citing no Mandate is limited only by 24 hours (T22, `log.ts:400-416`); residency needs the Mandate required.
- The run log keeps **visible text only** (`replyText`), while the stream path forwards thinking blocks (`stream.ts:79-81`): thinking passes the gateway and is silently dropped from the record.
- docs claim memory is "governed" but `memory.ts` has only a budget and a merge, no write, consolidate or forget policy (instrumentation.md 3).
- Plans and `think` tools are explicitly **no scope** (`judge.ts:27`) so they are never judged or recorded as Actions: good for safety, but plan traces must be captured through a new hook.

## 4. Things I did not read (marked in the specs as assumptions)

`at-rest.ts`, `runlog-vault.ts` and `docs/run-log-custody.md` beyond their purpose; the log's maximum record size; the Mandate schema under `spec/schemas`; what Codex reasoning items contain; Claude Code's stream-json thinking blocks; Antigravity and Goose reasoning; whether Codex, Goose, Antigravity and OpenHands load the `asp` MCP server; the repository's own licence; current provider terms.

## 5. Questions for the owner

1. Is a **third-party provider for hosted agents** wanted at all? It needs the provider's written answer first (residency.md decision 1).
2. **Delegation lifetime**: 24 hours with daily renewal, or 72 hours or 7 days for residency?
3. **Approve the text changes** in residency.md 3.3 (with a lawyer)? Until then R1 and R2 only.
4. **Monthly subsidy budget** in real units and in money; measured cost per token and host-hour (M7).
5. **Prepaid sponsor amounts**: confirm not in the beta (terms 5, privacy 1 say no money and no payment details).
6. **Telemetry for minors' tenants**: confirm none in the beta.
7. **Default raw retention** 30 days, cap 90.
8. **Public telemetry figures** only for cohorts of at least 10.
9. Should the **Academy offer an optional calibration exam** later? (Never a silent standing input.)
10. Who operates the **Telemetry DID and the City-budget DID**: the operator in the beta?

## 6. Honest quality note

Both specs are complete against the fifteen parts of the standard, and ground what exists in code by file and line. Residency is as concrete as Shops on records, caps and tests, and stronger on compliance; weaker on **prices**, because the cost per token and host-hour is unknown (M7). Instrumentation is stronger than Shops on definitions and the worked example (every number computed by hand; the calibration figures are an illustration, flagged); weaker on **per-runtime facts**, where several cells are "not read" and are listed as assumptions. Nothing is built; nothing is closed. No lawyer or owner has approved any proposed text.
