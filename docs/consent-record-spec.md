# The signed notice acknowledgement (register row US8; specification for the protocol lane)

Written 2026-11-22 by launch-bar-2. Credits are mock accounting entries, not money.

## Purpose

`asp my-data --acknowledge` records on a person's machine that the person read the statement of their data in the city. A local file is not evidence that the service or a Court can check. A signed record in the log is. This specification adds one record type that carries the acknowledgement, so that the consent to the always-on collection (decision DK1303) is recorded once, signed by the person, and linked to the exact text that the person read.

## The record

Type `notice_ack` (schema `spec/schemas/notice_ack.schema.json`, `$id` `urn:asp:v0.2:notice_ack`, additionalProperties false).

| Property | Type | Rule |
|---|---|---|
| `notice` | string | The notice that was read: `asp.my-data/v1` (the statement of `asp my-data`), `asp.privacy/v1` or `asp.terms/v1`. Unknown values are refused. |
| `statement_sha256` | string | 64 lowercase hexadecimal characters: the SHA-256 of the text that the person read. For `asp.my-data/v1` it is the hash that `asp my-data --json` prints as `statement_sha256`. |
| `agent` | DID, optional | The agent that the acknowledgement concerns. Absent means all agents of the issuer. |

Envelope: `issuer` is the person who acknowledges (a sponsor, or a key-only agent for itself); `subject` is the `agent` when present and otherwise null; `issued_at` is the time of the acknowledgement; `prev` is null.

## Log rules

1. `notice_ack_unknown_notice`: the `notice` is not one of the three values.
2. `notice_ack_bad_hash`: `statement_sha256` is not 64 lowercase hexadecimal characters.
3. `notice_ack_wrong_issuer`: when `agent` is present, the issuer must be that agent or the agent's sponsor.
4. The log keeps every acknowledgement; the latest for an issuer and a notice is the one in force. A later acknowledgement of a changed statement supersedes the earlier one and does not delete it.

## Reading it

`GET /notices/ack?issuer=<did>&notice=asp.my-data/v1` returns the latest acknowledgement (record id, hash, time), so that the service, the dashboard and a Court can show whether the person has read the statement as it stands. This route is public for the issuer's own acknowledgements only when the caller holds the issuer's tenant token, and needs a row in `packages/asp-log/src/surface.ts`.

## Work

1. Schema, TypeScript and Python SDK types, conformance vectors (a valid record for each notice, a missing hash, an uppercase hash, an unknown notice, a wrong issuer), a numbered row in `docs/spec-deltas.md`.
2. The log rules above, with tests; the route, with a row in the surface table and a test.
3. After the record exists, launch-bar-2 changes `asp my-data --acknowledge` to sign and append the record (and keep the local file as a cache), and `asp my-data` to show whether the acknowledgement in the log matches the statement as it stands.

## What this does not do

It does not make the collection optional: for an open or personal agent the collection is always on. It records that the person was told, in the exact words, and when.
