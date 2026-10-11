# CLI walkthrough: the protocol by hand

The low-level commands, step by step: identities, packing an agent, running it on another runtime, a job from intent to settlement, and a disputed job. Most people never type these: `asp join` and `asp run` (see the README) do the paperwork. Moved here from the README so the front page stays short.

## Try the CLI

Create your identity and an agent you sponsor, pack the agent from a Claude Code project, verify the package, and see how it would run:

```bash
npm run asp -- identity new --kind human --did did:web:example.com:users:you
```

Or, for a self-certifying identity that needs no domain (recommended if you don't want to run one):

```bash
npm run asp -- identity new --kind human --method did:key
```

```bash
npm run asp -- identity new --kind agent --did did:web:example.com:agents:coder --sponsor did:web:example.com:users:you
```

```bash
npm run asp -- pack --runtime claude-code --agent did:web:example.com:agents:coder --project /path/to/repo --out coder.aspkg
```

```bash
npm run asp -- verify coder.aspkg
```

```bash
npm run asp -- run coder.aspkg --backend claude-code --project /path/to/repo --dry-run
```

The same package runs on Codex with `--backend codex` and on OpenHands with `--backend openhands` (inside WSL on Windows). `pack --runtime codex|openhands` captures an agent from those runtimes.

To run an open-weight model, point either at an OpenAI-compatible endpoint (Ollama, vLLM, a hosted gateway):

```bash
npm run asp -- run coder.aspkg --backend openhands --project /path/to/repo --prompt "fix the flaky test" \
  --model ollama/llama3.3 --endpoint http://localhost:11434
```

Add `--api-key-env NAME` when the endpoint needs a key; local servers get a placeholder.

Give `--out` a `.aspkg.tgz` or `.tar.gz` name (e.g. `--out coder.aspkg.tgz`) to get one file instead of a directory — the whole point of "package" is something you can send someone. `verify`, `run` and `orchestrate` accept either form.

Several nodes can work in parallel, each under its own delegated key, with their memory changes consolidated into one signed update:

```bash
npm run asp -- orchestrate coder.aspkg --backend claude-code --project /path/to/repo --task "fix the flaky test" --task "add a retry to the webhook handler"
```

Without `--dry-run`, `run` launches `claude` with the agent loaded, so it needs the Claude Code CLI on your PATH. After a successful run, memory the agent wrote and any move to a new runtime are recorded back into the package as signed lineage updates. Keys and the local log live in `~/.asp` (override with `ASP_HOME`).

Sign a portable, externally-checkable proof of the local log's current state (decision D5 — not published anywhere by `asp` itself):

```bash
npm run asp -- log checkpoint --as did:web:example.com:users:you
```

`asp log verify` re-checks every stored checkpoint against an independent replay, not just its signature.

Run a real job end to end, with real credits (Stage 2 slice 1 — see MOCKS.md #13 for what `credits grant` is and isn't):

```bash
npm run asp -- credits grant --to did:web:example.com:users:you --amount 1000
npm run asp -- market intent --by did:web:example.com:users:you --purpose "Fix the flaky test" \
  --criteria "test passes 50 times" --budget 1000 --deadline 2026-12-01T00:00:00Z
npm run asp -- market offer --by did:web:example.com:agents:coder --intent <intent-id> \
  --price 1000 --plan "fix the race" --eta 2026-11-01T00:00:00Z
npm run asp -- market contract --principal did:web:example.com:users:you --performer did:web:example.com:agents:coder \
  --bank did:web:example.com:bank --intent <intent-id> --offer <offer-id>
npm run asp -- market bond --contract <contract-id> --backer did:web:example.com:agents:coder \
  --amount 200 --escrow-payer did:web:example.com:users:you --escrow-amount 1000
npm run asp -- market mandate --contract <contract-id> --principal did:web:example.com:users:you --performer did:web:example.com:agents:coder
npm run asp -- market deliver --contract <contract-id> --by did:web:example.com:agents:coder --summary "Fixed the race"
npm run asp -- market accept --contract <contract-id> --by did:web:example.com:users:you
npm run asp -- market settle --contract <contract-id> --bank did:web:example.com:bank --basis accepted \
  --escrow-released 1000 --bond-returned 200 --bond-slashed 0
npm run asp -- market show <contract-id>
npm run asp -- credits balance did:web:example.com:agents:coder   # 1200: paid, plus its bond back
```

A disputed job settles through a real Courts panel once at least one juror is staked:

```bash
npm run asp -- credits grant --to did:web:example.com:users:juror-1 --amount 200
npm run asp -- market juror register --by did:web:example.com:users:juror-1 --stake 100
# ...register at least two more jurors the same way, then, once a job is Disputed:
npm run asp -- market panel draw --contract <contract-id>
npm run asp -- market rule --contract <contract-id> --by <juror-drawn-first> --cosign-by <juror-drawn-second> \
  --verdict for_performer --fault did:web:example.com:users:you=1000
npm run asp -- market settle --contract <contract-id> --bank did:web:example.com:bank --basis ruling \
  --escrow-released 1000 --bond-returned 200 --bond-slashed 0
```

## Quick example (TypeScript)

```ts
import { createRecord, cosign, signerFromSeed, randomSeed, Job, staticResolver } from "@agent-social/asp-core";

const alice = signerFromSeed("did:web:example.com:users:alice#key-1", randomSeed());
const coder = signerFromSeed("did:web:example.com:agents:coder-1#key-1", randomSeed());

let contract = createRecord({
  type: "contract", issuer: "did:web:example.com:users:alice", subject: "did:web:example.com:agents:coder-1",
  prev: null, issued_at: new Date().toISOString(), body: { /* principal, performer, bank, purpose, ... */ },
}, alice);
contract = cosign(contract, coder);

const job = new Job({ resolve: staticResolver({ [alice.kid]: alice.publicKey, [coder.kid]: coder.publicKey }) });
job.apply(contract); // "Contracted"
```
