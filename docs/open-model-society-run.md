# Running the society on an open-weights model (a runbook for the owner)

Status: **written 2026-11-25 from what the repository does today and from the lead's notes about the model and the servers; none of the server flags below has been run by me.** Check every flag against the version you install: servers change their flags between releases. No key, account or token is ever given to the person or agent who builds this repository; you rent the machine yourself, and the only secret on the pod is whatever you type there.

What this is for: the same cohort that ran on a hosted model (rows ENG96, ENG83, ENG97), run on an open-weights model that you serve yourself, so that (1) the behaviour can be compared with the hosted run, and (2) afterwards the recorded prompts can be replayed through the same model to read its internal activations (the replay harness, `evals/activations/replay.py`, is **not built yet**; the recording of prompts that it needs is built).

## 0. What you need

- One rented GPU with at least 32 GB of memory for Inkling-2-Mini (the model card recommends 32 GB or more; its checkpoint is about 20 GB in a mixed NVFP4 and MXFP8 format, which some GPUs may not read directly: see step 7; the draft model card measured on one H200), or one 80 GB GPU for a larger model such as `openai/gpt-oss-120b`. An 80 GB H100 has recently cost roughly 2 to 4 US dollars an hour at specialist clouds; **prices move, look at the page when you rent.** The first hour is a test; a one-hour 15-agent run needs about the same again.
- An SSH key pair on your own machine. The server on the pod is reached through an SSH tunnel (`ssh -L 30000:localhost:30000 <pod>`), so no port is opened to the internet and no key to a model service is needed: the cohort tool only needs the name of *some* environment variable holding *some* text.
- This repository on your machine, with `npm install` done.

## 1. Rent and prepare the pod

Rent one GPU pod with a recent CUDA image and 100 GB of disk (the weights are about 20 GB; leave room for the run folder). Note the SSH command the provider gives you. Everything below that starts with `pod$` runs on the pod, everything with `local>` on your machine.

## 2. Serve the model (SGLang first, then with the draft model)

The model: `thinkingmachines/Inkling-2-Mini` (Apache 2.0, released 2026-11-20, a multimodal mixture-of-experts model, 26.4B parameters of which 3.4B are active; the middle 12 of its 24 layers run three times with shared weights, 48 layer applications per token; 8 of 128 experts per token; a single checkpoint of about 20 GB in mixed NVFP4 and MXFP8; 32 GB or more of GPU memory recommended; built for agents and tool use). SGLang and vLLM both serve the Anthropic Messages API at `/v1/messages`, so nothing in this repository needs a new provider: the cohort's Anthropic provider is pointed at your server. **The commands below are copied from the model cards read on 2026-11-25** (the cards' own text; the Messages API at /v1/messages is from the servers' documentation, not from the cards).

**Plain SGLang, with pip (the model card's command):**

```
pod$ pip install sglang
pod$ python3 -m sglang.launch_server --model-path "thinkingmachines/Inkling-2-Mini" --host 0.0.0.0 --port 30000
```

**Plain SGLang, with the model card's Docker image** (`lmsysorg/sglang:latest`; the draft model's card names the image `lmsysorg/sglang:inkling-2-mini` for the speculative run, which is the safer choice for both):

```
pod$ docker run --gpus all --shm-size 32g -p 30000:30000 -v ~/.cache/huggingface:/root/.cache/huggingface --ipc=host \
       lmsysorg/sglang:inkling-2-mini \
       python3 -m sglang.launch_server --model-path "thinkingmachines/Inkling-2-Mini" --host 0.0.0.0 --port 30000
```

(The card's example passes `--env "HF_TOKEN=<secret>"`; the weights are public, so no token should be needed; if the download asks for one, that is your own Hugging Face account on the pod, never sent anywhere else.) **vLLM as the alternative** (the model card's command): `pip install vllm` then `vllm serve "thinkingmachines/Inkling-2-Mini"` (port 8000; use `--provider-url http://localhost:8000` and tunnel port 8000).

**What the cards do NOT say, and the smoke test decides:** neither card names a **tool-call parser** flag, and the commands above do not set one. The cohort needs the server to return tool calls as `tool_use` blocks. If the smoke test in step 4 says `NO TOOL CALL`, look in the SGLang or vLLM documentation for the parser that goes with this model (SGLang `--tool-call-parser <name>`; vLLM `--enable-auto-tool-choice --tool-call-parser <name>`) and restart; if none exists for it, use the fallback `Qwen/Qwen3-8B` (dense, Apache 2.0, thinking off) or `openai/gpt-oss-20b`.

**Optional speed-up, after the plain run works: the DFlash 2 draft model** `incoai/Inkling-2-Mini-DFlash2` (0.5B; not a standalone model: it drafts tokens for the target to verify, so the target's sampling distribution is preserved and behaviour is unchanged; only speed changes). From its card, on one H200 with FlashAttention 4, block size 8, the official sampling defaults and 4,096 new tokens: about 2.0 to 2.8 times faster than plain decoding at one request at a time, 1.4 to 1.8 times at eight at a time, and 1.5 to 1.9 times at thirty-two. Run it inside the official image `lmsysorg/sglang:inkling-2-mini`:

```
pod$ hf download incoai/Inkling-2-Mini-DFlash2 sglang_inkling_dflash2.py --local-dir ./inkling-dflash2
pod$ python ./inkling-dflash2/sglang_inkling_dflash2.py
pod$ python -m sglang.launch_server --model-path thinkingmachines/Inkling-2-Mini \
       --speculative-algorithm DFLASH --speculative-draft-model-path incoai/Inkling-2-Mini-DFlash2 \
       --speculative-num-draft-tokens 8 --attention-backend fa4 --speculative-draft-attention-backend fa4
```

(The second line applies the card's compatibility patch; add `--host 0.0.0.0 --port 30000` as above. `fa4` is FlashAttention 4 and may need a newer GPU generation: if the server refuses it, run the plain server.) Use the plain server for the first test and the behaviour run, and the draft only for a second run; say in the report which produced which numbers.

## 3. The tunnel

```
local> ssh -N -L 30000:localhost:30000 <the ssh command the provider gave you>
```

Leave that window open. The server is now at `http://localhost:30000` on your machine and nowhere else.

## 4. Test the endpoint in 20 seconds

```
local> $env:POD_KEY = "any text"
local> npm run asp -- society cohort smoke-endpoint --provider-url http://localhost:30000 --model thinkingmachines/Inkling-2-Mini --api-key-env POD_KEY
```

It sends one request that should come back as a tool call, then sends the tool's result back, and prints: reachable, tool_use returned and parsed, usage present, latency of each call, the first 200 characters of text and a verdict. **Do not start a long run until the verdict says OK.** `NO TOOL CALL` means the server's tool-call parser is not on or the model answered in text: fix the server flag or change the model. `no usage` means the server does not report token counts: the cohort's token and dollar caps would read zero, so stop.

## 5. Run the cohort (same seed and switches as the hosted run, so the two compare)

Use the same command line as the hosted run you want to compare with, changing only the model, the provider address and the prices. For the 10-agent, one-hour shape:

```
local> npm run asp -- society cohort --local --agents 10 --kinds sponsored:5,key-only:5 --minutes 60 --model thinkingmachines/Inkling-2-Mini --provider anthropic --provider-url http://localhost:30000 --api-key-env POD_KEY --price-in 0 --price-out 0 --budget-usd 1.5 --total-usd 14 --seed 20261125 --reply-tokens 4000 --record-prompts --orientation --markers --library --lessons --assess --agenda --games --hard-jobs --repo-jobs --battery --injection-screen label
```

Notes. `--price-in 0 --price-out 0` makes the money caps inert (the run is bounded by minutes, turns and the token cap instead; `--token-cap` and `--max-turns` have defaults, see `asp help all`). `--reply-tokens 4000` gives a reasoning model room to think; the default is 1024. `--record-prompts` writes every model call to `<run>/agents/<id>/turns.jsonl` for the activation replay; it grows by about the size of the history sent at each turn, so expect tens to hundreds of megabytes for ten agents over an hour: check the size of the run folder after a short test. Add `--desert --groups --stats --day-cycle --roles` if the hosted run had them. A model that thinks a lot will do far fewer turns in the hour than a hosted model; that is a finding, not a fault. The cohort writes `report.md`, `trace.jsonl`, `writebacks.txt` and the per-agent folders into the output folder.

## 6. Shut the pod down

When the run has finished: copy what you need (step 8), then **stop and delete the pod** in the provider's console. A running pod costs money whether or not anything is happening.

## 7. If the weights will not load for the replay (NVFP4 and MXFP8)

The replay reads activations with Hugging Face `transformers` on the same weights. The checkpoint is stored in a mixed 4-bit and 8-bit float format that some GPUs read natively (the newest generation) and others do not. The replay's `--selftest` (to be built) loads the model on the pod, lists the modules, runs one forward pass and reports whether the weights loaded. If they do not, the options are a GPU that supports the format, a dequantised load, or running the replay on `Qwen/Qwen3-8B` with its own behaviour run instead (a dense model: simpler, but a different model than the one behaving in the society).

## 8. Activations (after the run) — not built yet

The plan, from the lead's notes: the behaviour run uses the fast server; afterwards the recorded prompts are fed through the same model with Hugging Face transformers, one forward pass per recorded turn, with hooks on the residual stream of chosen layers; the vector at the last prompt token is stored as float16 shards with an index keyed by agent and turn, and each turn is joined to what the trace says happened (a collision, a retry, a refused scope, a lesson published, a sitting passed, a card read, the access-experiment arm). The model repeats its middle twelve layers three times with shared weights, so every hooked module in that block fires three times per forward pass and each activation must be tagged with the layer and the loop pass; the router's top-k expert ids at the last prompt token are recorded too. The numbers stay on disk and never enter the log. No claim of what an activation means is made before a probe trained on some agents is tested on held-out agents against a shuffled-label control.

To copy the run folder to the pod and the activations back, use `scp` or `rsync` over the same SSH connection; copy `agents/*/turns.jsonl` and `trace.jsonl`, nothing else, and never copy a key.

## 9. What to report afterwards

The model and server versions and flags (plain or with the draft), the pod's GPU and its hourly price and the hours used, the smoke-test output, how many turns each agent took in the hour compared with the hosted run, the closure reader's table (`asp society cohort closure <run folder>`), and any refusal or parse problem the server's parser caused. Rows ENG96, ENG83 and ENG97 take their evidence from this.
