# Run-log custody (E16)

A **run log** is the redacted record of one governed session: what the agent was asked, what the model answered, which tools it called and what was refused. The gateway writes it on the person's machine (hash-chained; each signed Action commits to its head). It is evidence in a dispute, and until now only the person held it.

## Who holds it

| Where | Who holds it | Readable by |
|---|---|---|
| `<ASP_HOME>/runs/<run>/run-log.ndjson` | the person, on their machine (the default, and all the beta needs) | the person |
| the service, **sealed** (opt in) | the service holds ciphertext and a public header | **only** the people the log is sealed for |
| a court, **disclosed** (the person's choice, per dispute) | the jurors or operator court the person names | the people named |

The service operator **cannot read** a sealed log (it holds no key that opens it) and learns only the header: the job, the size, the log's hash, who it is sealed for and any signed disclosure.

## How it works

- `asp run <runtime> --keep-run-log` (or `asp run-log keep [<log>]` later) seals the log on the person's machine: AES-256-GCM under a random key, the key wrapped (X25519) to the person's identity keys, the signing key and the recovery key. Nothing new to back up: if the person restores their identity (recovery code or key backup) they open their sealed logs again. A run log is bound to its job and run, so a sealed file cannot be passed off as another.
- `asp run-log kept` lists them; `fetch --id <id>` downloads one; `open <file>` decrypts it and checks its hash chain and the head that was sealed; `drop --id <id>` deletes it from the service.
- **Disclosure**: `asp run-log disclose --id <id> --to <did,...> --reason "<why>" [--upload]` wraps the same key to the named people and adds a statement signed by the owner (the log's hash, who, why, when). The ciphertext is not changed. The recipient opens it with their own identity key and checks the signature (`asp run-log open`) and then the log against the Actions (`asp run-log verify <log> --contract <id>`). A copy that has been disclosed cannot be replaced by a different log.
- In the beta the court is the operator's (docs/deploy/court.md): the person discloses to the operator's court identity; an admin can fetch the sealed file with `--tenant` but still cannot open it without being named.

## Limits (open, in gap E16 and E6)

- Opt-in, per run. A person who never seals a log has only the local copy; if the machine is lost, the evidence is too. (Reminders, a default for `asp run`, and a retention schedule are not built.)
- The local file is still unencrypted at rest (E6). Sealing protects the service copy, not the local one.
- Disclosure is a decision of the owner. Nothing forces a party to disclose; a court can draw its own inference from a refusal (not built into the rules yet).
- A disclosed log can be copied by its recipient; the signature proves who disclosed it to whom, not that it will stay private.
- Quota: 64 MiB per tenant and 16 MiB per sealed log by default; headless (CI) runs do not seal because the person's key is not on the runner.
- Not live-checked on the hosted server (docs/live-run-checklist.md).
