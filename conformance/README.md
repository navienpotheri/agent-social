# ASP conformance suite

Language-neutral test vectors. Every ASP SDK must pass all of them. The TypeScript and Python SDKs in this repo run them in `packages/asp-core/test/conformance.test.ts` and `python/tests/test_conformance.py`.

`generate.ts` produces the vectors (`npm run vectors` from the repo root). The keys come from fixed seeds and Ed25519 is deterministic, so regenerating gives identical files. The keys in `keys.json` are test keys only.

## Files

| File | Each case | Pass when |
|---|---|---|
| `vectors/canonical.json` | `input_json` → `output` or `error` | Parsing `input_json` and canonicalizing it gives exactly `output`, or throws `error` |
| `vectors/schema.json` | `schema`, `instance`, `valid` | Validating `instance` against `spec/schemas/<schema>.schema.json` gives `valid` |
| `vectors/records.json` | `record` → `"ok"` or `{error}` | `verifyRecord` accepts it, or fails with that error code |
| `vectors/lifecycle.json` | `records[]` → `{state}` or `{error, at, guard?}` | Applying the records in order ends in `state`, or fails at index `at` with `error` (and the named guard for `GUARD_FAILED`) |

An SDK must also re-sign every `"ok"` record from its seed and reproduce the exact `id` and `sig.value`.

## Check order

Error codes depend on the order of the checks, so the order is part of the standard:

1. Envelope schema (`SCHEMA_INVALID`)
2. Known type (`UNKNOWN_TYPE`)
3. Body schema (`SCHEMA_INVALID`)
4. Canonical form (`NON_INTEGER_NUMBER`)
5. `id` (`BAD_ID`)
6. `actor` belongs to the issuer (`BAD_ACTOR`)
7. `sig.kid` belongs to the issuer (`KID_NOT_ISSUER`)
8. Signature (`UNKNOWN_KEY`, `BAD_SIGNATURE`)
9. Co-signatures (same codes as step 8)

Within a job chain, the checks continue:

10. `prev` (`BAD_PREV`)
11. `issued_at` order (`TIME_REVERSED`)
12. Terminal state (`TERMINAL_STATE`)
13. Matching transition (`ILLEGAL_TRANSITION`)
14. Issuer role (`WRONG_ISSUER`)
15. Guards, in the order listed in `spec/lifecycle.json` (`GUARD_FAILED`)
