# Encryption at rest on the hosted server: the evidence (DK1411)

Recorded 2026-11-22 from what the owner saw in the Google Cloud console and on the server, as relayed by the lead; **nothing here was run or checked by a worker**. No key, no secret and no key text appears in this file or in any file that it cites. Credits are mock accounting entries, not money. The service is a beta, and there has been no outside security review.

## What was checked

| Item | What the owner saw | Date |
|---|---|---|
| The server's disk, `asp-log` (project `agent-social-511217`, zone `asia-south1-a`) | Encryption by a Google-managed key. The server has one boot disk (30 GB) and the database and the data are on it, so the database is on an encrypted disk | 2026-11-22 |
| The snapshot of that disk | Encryption by a Google-managed key | 2026-11-22 |

## What is claimed, and what is not

- **Claimed:** the server's disk and its snapshot are encrypted at rest with a Google-managed key, as seen by the owner in the console on 2026-11-22.
- **Backups.** The offsite copy of the nightly backup is encrypted with `age` to the owner's public key **before it leaves the server**, so the bucket holds ciphertext only and the server holds only the public key (docs/deploy/backup-offsite.sh; the private key is in the owner's password manager). The bucket is also encrypted by the provider by default; that is the provider's documented behaviour and was **not separately checked** by us.
- **Not claimed:** that the disk is encrypted with a key of the owner's own (it is Google-managed), that the provider's encryption has been reviewed by anyone outside, or anything about the keys inside the provider. Disk encryption does not protect against someone who can log in to the running server.
- The security questionnaire answer 29 is changed from Partial to Yes on this evidence ([security-questionnaire.md](security-questionnaire.md)).
