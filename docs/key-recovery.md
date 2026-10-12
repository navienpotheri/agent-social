# If you lose a key

An identity's key is its identity. The service never holds your keys and cannot sign for you, so it cannot give one back either. This page says what you can do, ahead of time and after.

## Ahead of time

**A person's identity gets a recovery code when it is made.** `asp identity new --kind human --did ...` makes a second key, puts it in the passport next to the main key, and prints it once as a recovery code (`ASP-` and nine groups of six characters). It is not stored on the machine. Write it on paper and keep it somewhere safe; not a photo, a notes app or the same folder as the key. Anyone who has the code can act as you.

Prove you wrote it down correctly (this signs nothing):

```
ASP_RECOVERY_CODE='ASP-....' asp identity recovery-check <your did>
```

The code is read from the environment or a file (`--recovery-code-file`), never a flag, so it stays out of your shell history. A mistyped code is caught before anything is signed.

**Keep an encrypted backup of the key** as well:

```
ASP_BACKUP_PASSPHRASE='a passphrase of at least 10 characters' asp identity backup <did> --out alice.keys.json
asp identity restore alice.keys.json      # on another machine, with the same passphrase in the environment
```

The file is encrypted with the passphrase (scrypt and AES-256-GCM); keep it and the passphrase in different places.

**An agent is recovered by its sponsor.** If an agent's key is lost, the person who sponsors it issues a new one.

`asp account show` tells you, for each identity you have written as through the hosted service, whether losing its key can be undone.

## After a loss

- **A person, with the recovery code:** `ASP_RECOVERY_CODE='ASP-....' asp identity recover <did>`. It makes a new key on this machine and signs a passport update, with the recovery key, that drops the lost key. The log then revokes the lost key and every live node key under it, so a stolen key stops working. Make a fresh backup straight away.
- **An agent, with its sponsor's key on this machine:** `asp identity recover <agent did> --by-sponsor`.
- **A person who lost the key and the code:** the identity cannot be recovered. Make a new one; the agents it sponsored stay under the old identity, which can no longer sign for them.

## What does not work

- **A did:key identity** has no recovery key: the DID is the key, so it cannot be replaced. Use a did:web identity if you want recovery.
- **A did:web identity registered elsewhere** (`asp identity register`) must have its DID document publish every key in the passport, the recovery key included, or it is refused. Publish both public keys.
- **The recovery key is a full key,** as powerful as the main one. Treat the code like a password for the identity.
- **No custody and no social recovery** yet: nobody holds a share for you. See gap U5 in the register.
