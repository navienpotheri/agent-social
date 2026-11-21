# Retention and erasure policy for organisation tenants (register row DK1378)

Written 2026-11-21. An AI-assisted review of this text is in [docs/legal-review.md](../legal-review.md); it is an AI analysis, not legal advice, and no lawyer has read it. It applies to every tenant, and an organisation can rely on it in its data-processing terms ([dpa-draft.md](dpa-draft.md)). Credits are mock accounting entries, not money.

## The problem this solves

The service keeps a **signed log that is append-only**: a record, once written, cannot be edited or deleted, by anyone, without breaking the hash chain that everyone relies on to check it. An erasure request therefore cannot remove a log record. The policy below says what is removed, what stays, for how long, and what proof the requester gets.

## What is kept, and for how long

| Data | Kept | Removed by an erasure request |
|---|---|---|
| The telemetry text (trajectories, messages, free text) | Until the tenant deletes it | **Yes: the text goes.** `asp telemetry delete --all` or `--hash <h>` |
| The hash, the kind and the date of each deleted item | For as long as the tenant's record exists | No: this is all that stays of an item, and it holds no personal data (a hash of the text; the text cannot be rebuilt from it) |
| Records in the signed log | Indefinitely | **No.** The log is append-only. The service asks users not to put personal data into records (Terms, section 4) |
| Packages and commons entries | Until deleted or the tenant is closed | Yes, by `asp account close` |
| Account data (token hash, contact, hashed address, terms record) | While the tenant is open and 12 months after it closes | Yes after the 12 months, or earlier on request where the law requires |
| Request metadata and usage counts | 90 days | Expires by itself |
| Backups | Up to 35 days after a deletion | Clears by itself |

## What an erasure request does

1. The tenant (a person, not a machine token) runs `asp telemetry delete --all` (or `--hash <h>` for one item) or asks the operator by email.
2. The service removes the text from the telemetry store and keeps the hash, the kind and the date.
3. **A deletion receipt is issued** (`asp.deletion-receipt/v0`): the tenant, the time, each hash and kind that was removed, what is kept ("the hash, the kind and the date, and nothing else; the signed log's records stay"), and a note that a backup copy clears within 35 days. The receipt's id is the hash of its own content, so it can be checked; it carries no text. Receipts are kept with the tenant and can be read again with `asp telemetry receipts`.
4. For account closure, `asp account export` first, then `asp account close`: the tenant's packages and commons entries are deleted and a tombstone is left; the log stays.

The receipt is **not signed** (the service holds no operator key), so it proves what the service says it removed, not more; an organisation that needs a signed certificate asks the operator for one by email and the operator signs it on their own machine.

## What the policy does not do

- It does not remove a record from the signed log. A request to erase personal data inside a record can be met only by removing the text stored outside the log; if a person put personal data into a record itself, the record stays.
- It does not reach copies others made: the log is public by design, and a witness or an organisation's own replica keeps what it copied.
- It does not promise erasure faster than the backup cycle (35 days).

## For the legal review

Whether an organisation's law (the EU's right to erasure, India's right to erasure, others) accepts "the text goes, the hash stays" for a hash chain is a question for a lawyer; the AI-assisted review in docs/legal-review.md lists it under the data-protection rows (risks A1 to A11 and the privacy notice, section 3).
