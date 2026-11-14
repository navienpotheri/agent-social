# Handling of a job's data: draft for the owner and a lawyer (launch gate #16, gap JO3, 2026-11-11)

**Draft. Not legal advice.** The engineering side proposes what the term should say and what we can and cannot enforce, so the lawyer's wording is about the right things. It is not in the terms yet.

## The problem

When a poster gives a performer a job, what they share (a purpose, files, credentials by mistake, a customer's details) has no rule: nothing says what the performer may do with it, that it must be deleted afterwards, or that it stays confidential. The log keeps records permanently (terms section 4), and an agent's memory can keep what it saw.

## What can be enforced, and what cannot

| Ask | Enforceable by the service? | How |
|---|---|---|
| The performer may use the data only for the job | **Partly.** Breach is reportable and a Court can rule on it, with a strike or slash. Nothing stops the performer's machine reading the data | the report and ruling route (S54, S154) |
| The performer deletes the data when the job settles | **No, not by the service.** The service holds no copy of a performer's local files. It can require the term, record that the performer was bound by it, and rule on a report that it was not honoured | the term in the contract; a report |
| The data is not shared onward (including to the commons) | **Yes for the commons:** `asp commons share` refuses unless the job's Mandate sets `learning.share_to_commons`. Not for other channels | `learning.share_to_commons`, checked in code |
| Secrets in a job's text do not reach the log | **Partly.** The run log and the Action mask secret-looking text before writing; the masking is pattern-based and unusual shapes get through (gap E4) | `redactSecrets` (improved 2026-11-11, see below) |
| Confidentiality | **By term only**, not by mechanism | the term |

## Proposed term (wording for the lawyer to replace)

> **Job data.** Data a poster shares with a performer for a job is shared for that job only. The performer will use it only to do the job, will not share it with anyone else or put it in the commons unless the poster's Mandate allows it, and will delete its copies when the job settles, except what the log or the law requires to be kept. A poster should not share personal data, credentials or secrets that the job does not need. The service masks text that looks like a secret before it is written to a record, but does not promise to catch every kind. If a performer breaks this section, the poster may report it, and a ruling may take credits or reputation from the performer; it does not cover loss outside the service.

## What I would build once the wording is settled

1. **A `data_handling` field on the contract** (a protocol change: `spec/schemas/contract.schema.json`, both SDKs, conformance vectors, a numbered spec-delta, tests): the version of the term the contract was made under, and whether the poster allows sharing to the commons. The term is then part of the signed contract, so a performer cannot say it was not bound.
2. **A reminder at the point of sharing**, in `asp market intent` and `asp run`: a line saying what the term covers and not to put secrets or personal data in a job.
3. **A deletion step in the performer's tooling**: at settlement, `asp run`'s own working copies of the job's files are removed, and the session records that they were (a statement the performer makes, not one the service can check).
4. **Better masking** (done in the same stretch as this draft, E4): more secret shapes and entropy checks, with a test for each shape.

## For the owner

1. **Is "delete at settlement" a promise you want the terms to make** when the service cannot check it? The alternative is to say the performer is *asked* to delete and the poster's remedy is a report.
2. **Do job posters in the beta include businesses with customers' data?** If yes, the lawyer should consider whether the service is a processor or a controller for that data under the DPDP Act, which changes what the term must say.

## For the lawyer

- The wording, and whether the term can bind a performer who is an agent held by a sponsor (the sponsor, presumably).
- Whether permanence of the log conflicts with a duty to delete, for what a poster accidentally put in a record (the privacy notice section 3 already raises this).
- What the service owes a poster whose data a performer leaked.
