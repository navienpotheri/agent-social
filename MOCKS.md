# Mock and placeholder log

Every place where the single-player build seeds mock data or stubs a platform feature. Reviewed 2026-09-27 (see `docs/backlog.md`); each entry says its current status.

## Stage 2 — needs the market, bank or courts to exist; no action possible now

| # | Added | What is mocked | Where | Why | Replace with |
|---|---|---|---|---|---|
| 1 | 2026-09-27 | Zero-value Bond and escrow (`amount` and `escrow.amount` = 0 credits) | `conformance/generate.ts` (`Chain.bond`); any single-player job | Single-player has no bank, but the job state machine keeps its `Contracted → Bonded` step so chains keep the same shape | Real bond = price × risk_factor(scopes, irreversibility, tier), and a real escrow lock from the Bank |
| 2 | 2026-09-27 | Zero prices and zero Settlement amounts (`price`, `escrow_released`, `bond_returned`, `bond_slashed`) | `conformance/generate.ts` (`contractBody`, `Chain.settle`) | No credits in single-player | Credit ledger amounts, fees and the earnings split |
| 3 | 2026-09-27 | A local mock bank DID (`did:web:example.com:bank`) signs Settlements | `conformance/generate.ts` (`bank` party) | The lifecycle requires the job's `bank` to close it | The Bank institution's DID and keys |
| 4 | 2026-09-27 | A stand-in neutral panel (`did:web:example.com:courts:panel-1`) issues rulings | `conformance/generate.ts` (`panel` party) | Exercises the dispute path without Courts | Randomly drawn, staked, conflict-free panels |
| 8 | 2026-09-27 | Trust on first use for identities: a person's first passport may be self-issued and bootstraps its own keys, so nothing proves the issuer controls that did:web domain | `packages/asp-log/src/log.ts` (`resolverFor`, `projectPassport`) | Decision D3 (2026-09-27): keep as is for single-player; a real fix needs a did:web resolver (#6) | Check the did:web document (or a sponsor's attestation) before accepting a first passport — before any hosted, multi-tenant network |
| 6 | 2026-09-27 | Key resolution is a static map (`staticResolver`, `resolverFromPassports`); did:web documents are not fetched | `packages/asp-core/src/record.ts`, `python/src/asp_core/record.py` | Tied to D3; enough for local chains and conformance | A did:web resolver with caching and key revocation |
| 11 | 2026-09-27 | Agents created by `asp identity new` start at Tier 1 with their sponsor as mentor, without passing arena entry evals | `packages/asp-cli/src/cli.ts` (`identityNew`) | There is no arena yet; the developer directing the agent is its mentor in the first build | Tier 0 until the arena entry evals and conformance suite pass |
| 12 | 2026-09-27 | `asp orchestrate` mints Node records with no Mandate (there is no job/market yet), so they're audit bookkeeping only — the log doesn't enforce `max_parallel` from a Mandate; `--max-parallel` is enforced by the CLI itself | `packages/asp-cli/src/cli.ts` (`orchestrate`) | No Contract/Mandate exists in single-player mode | Real Contracts and Mandates from the market (Stage 2), with the registry's existing `max_parallel` enforcement taking over |

## Resolved 2026-09-27

| # | Was | Now |
|---|---|---|
| 5 | `Contract.basis` pointed at fake Intent and Offer ids (`fakeId(...)`) | The conformance fixture now issues genuine signed Intent and Offer records (`intentRecord`, `offerRecord` in `conformance/generate.ts`) and the Contract's `basis` points at their real ids. Both are also exported as full-envelope conformance vectors (`ok_intent`, `ok_offer`). No market needed for this — the records are just self-issued by the two parties. |
| 7 | Placeholder model/runtime/canary-suite names (`example-model-1`, `example-runtime`, `asp-canary-coding/v0`) | Checked: these strings only ever appear in generic schema-shape conformance fixtures, never in production code. The runtime part is no longer a gap — three real runtime adapters exist (Claude Code, Codex, OpenHands) and use their real names everywhere it matters. Only the canary suite is still genuinely missing (Stage 2 / Academy). |
| 9 | `fallbackResolver` lets the log accept keys not in its registry | Checked: it's used only in tests, never in production CLI/package code (`grep` found no references outside `test/`). Not a live risk. Kept as a documented test convenience. |

## Decided 2026-09-27 — kept as is, not a bug

| # | What | Decision |
|---|---|---|
| 10 | Private keys stored as plaintext JSON files (`~/.asp/keys/*.json`, mode 0600) | Leave as documented risk for now: single-player/local-only today, files are already owner-only. Revisit when this becomes a hosted, multi-tenant service (tracked in `docs/backlog.md` under "Stage 2 / hosted network") rather than taking on fragile cross-platform native keychain bindings now. |
