# Hosted bots: what an attacker gets if the service is breached (register row CY8, DK532)

Written 2026-11-21 from the code, for the owner to read before launch. Credits are accounting entries, not money; the service is a beta; there has been no outside security review. This is a reading of what the code does, not an audit.

## What is held

A **hosted bot** is an agent with no machine of its own that its sponsor asks the service to run (owner decision CY8, 2026-11-18). For it, and only it, the service holds the signing key (`packages/asp-package/src/hosted-signer.ts`). A local agent's key never reaches this store: `create` is the only way a key enters it, and `signerFor` refuses any DID it did not make. The bot's passport says `custody: service`, so the record shows the mode.

## How the keys are kept

- One file, sealed with AES-256-GCM under a key derived with scrypt from a passphrase the operator supplies from the environment (at least 12 characters; never a flag, never written beside the file). The file is written with mode 0600 and replaced atomically.
- A wrong passphrase makes the file refuse to open.
- The operator can take the sealed file as a backup (`GET /hosted/backup`, admin role only); the copy is still encrypted and is useless without the passphrase.
- While the service runs, the decrypted seeds are held in the process's memory so it can sign.

## What an attacker gets, by kind of breach

| Breach | What the attacker gets | What they do not get |
|---|---|---|
| The sealed file alone (a disk image, a backup) | Nothing readable without the passphrase; guessing the passphrase is slowed by scrypt. A short or reused passphrase weakens this, which is why the operator sets it from the environment and the code refuses under 12 characters. | Any key, if the passphrase is strong and not stored beside the file. |
| The file and the passphrase, or the running process (memory) | The signing keys of every hosted bot on that service: they can sign as any hosted bot. | The key of any local agent or person; the sponsor's key; a passport (the sign route refuses to sign a passport, so the attacker cannot change a bot's sponsor, custody or key through the service); any other tenant's token (tokens are stored as hashes). |
| A tenant token of a sponsor | The sign route for that sponsor's own bots only (it checks the namespace); no other tenant's bots. | Other tenants' bots; the sealed file. |

## How far a stolen hosted key reaches

The sign route appends through the log's ordinary rules, so a record signed by a hosted bot is checked like any other: the bot's tier, its bond and the Mandate caps, the quarantine, the rate limits and the log's guards all still apply, and a slash or a quarantine still lands on the bot and its sponsor. A new bot is tier 1 with the starter credits only, so the harm is bounded by what that identity may do and hold: it is bounded by the bond and the mock starter allowance, not by the attacker's good will. A hosted bot that is given a network, shell or push scope is the dangerous case; the same tier limits for those scopes apply as for any agent (decision TB1 is open).

## How it is limited and undone

- **Opt-in and visible.** Only a bot whose sponsor asked for it exists; the passport shows `custody: service`. A public label on the society pages is row DK740 and is not built yet.
- **The sponsor vouches.** The passport is signed by the sponsor on the sponsor's own machine; the service never signs a passport.
- **Custody can be taken back.** A hosted bot can bind its own key (`POST /signup/bind`, row DK733): the service then deletes the seed (`forget`) and cannot sign for that identity again.
- **After a breach.** The operator suspends the tenant or blocks the address, stops signing, and tells the sponsors of hosted bots, who can sign a new passport for each bot on their own machine (the service never signs one). Rotating a key without a bind is not tested here. The operator's incident process is DK1341.

## What this does not cover

No outside review of the signer has happened (SC1). The passphrase is only as strong as the operator makes it, and the decrypted seeds in memory are exposed to anyone who controls the process. These limits are stated in the terms (a hosted bot is the one exception to "we never hold your keys") and in the key-recovery page.
