import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";

async function asp(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome, ...env }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const fakeOpenHands = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_OPENHANDS_BIN: process.execPath,
  ASP_OPENHANDS_SCRIPT: fileURLToPath(new URL("./fake-openhands.mjs", import.meta.url)), ...extra,
});
const fakeCodex = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_TOKEN: "t", API_BASE: "x", ASP_CODEX_BIN: process.execPath,
  ASP_CODEX_SCRIPT: fileURLToPath(new URL("./fake-codex.mjs", import.meta.url)), ...extra,
});

async function setup(f: Fixture, scopes?: string[]) {
  await asp(f, ["identity", "new", "--kind", "human", "--did", ALICE]);
  await asp(f, ["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Fix the flaky test"]);
  const pkg = join(f.root, "coder.aspkg");
  const pack = await asp(f, ["pack", "--runtime", "claude-code", "--agent", CODER, "--project", f.project, "--user-home", f.home, "--out", pkg]);
  assert.equal(pack.code, 0, pack.err);
  if (!scopes) return { pkg };

  await asp(f, ["identity", "new", "--kind", "human", "--did", BANK]);
  await asp(f, ["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await asp(f, ["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = await asp(f, ["market", "intent", "--by", ALICE, "--purpose", "Fix it", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"]);
  const intentId = /^intent (\S+)/.exec(intent.out)![1];
  const offer = await asp(f, ["market", "offer", "--by", CODER, "--intent", intentId, "--price", "1000", "--plan", "fix", "--eta", "2026-11-01T00:00:00Z"]);
  const offerId = /^offer (\S+)/.exec(offer.out)![1];
  const contract = await asp(f, ["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intentId, "--offer", offerId]);
  const contractId = /^contract (\S+):/.exec(contract.out)![1];
  await asp(f, ["market", "bond", "--contract", contractId, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  const mandate = await asp(f, ["market", "mandate", "--contract", contractId, "--principal", ALICE, "--performer", CODER, ...scopes.flatMap((s) => ["--scopes", s])]);
  assert.equal(mandate.code, 0, mandate.err);
  return { pkg, contractId };
}

test("OpenHands runs an open-weight model from a local endpoint: model, base URL and a placeholder key reach the runtime", async () => {
  const f = makeFixture();
  const { pkg } = await setup(f);
  const seen = join(tmpdir(), `oh-env-${Date.now()}.json`);
  const res = await asp(f, ["run", pkg, "--backend", "openhands", "--project", f.project, "--prompt", "go",
    "--model", "ollama/llama3.3", "--endpoint", "http://localhost:11434"], fakeOpenHands({ FAKE_OH_ENV: seen }));
  assert.equal(res.code, 0, res.err);
  assert.deepEqual(JSON.parse(readFileSync(seen, "utf8")), { model: "ollama/llama3.3", base: "http://localhost:11434", key: "local" });
  assert.match(res.err, /model served from http:\/\/localhost:11434/);
});

test("--api-key-env passes a hosted endpoint's key through, and a missing variable is named", async () => {
  const f = makeFixture();
  const { pkg } = await setup(f);
  const seen = join(tmpdir(), `oh-env-${Date.now()}-k.json`);
  const ok = await asp(f, ["run", pkg, "--backend", "openhands", "--project", f.project, "--prompt", "go",
    "--model", "openai/qwen3", "--endpoint", "https://models.example/v1", "--api-key-env", "MODELS_KEY"], fakeOpenHands({ FAKE_OH_ENV: seen, MODELS_KEY: "sk-test" }));
  assert.equal(ok.code, 0, ok.err);
  assert.equal(JSON.parse(readFileSync(seen, "utf8")).key, "sk-test");

  const missing = await asp(f, ["run", pkg, "--backend", "openhands", "--project", f.project, "--prompt", "go",
    "--model", "openai/qwen3", "--endpoint", "https://models.example/v1", "--api-key-env", "MODELS_KEY"], fakeOpenHands());
  assert.equal(missing.code, 1);
  assert.match(missing.err, /missing secrets: MODELS_KEY/);
});

test("--endpoint without --model is flagged, not silently ignored", async () => {
  const f = makeFixture();
  const { pkg } = await setup(f);
  const res = await asp(f, ["run", pkg, "--backend", "openhands", "--project", f.project, "--prompt", "go", "--endpoint", "http://localhost:11434", "--dry-run"], fakeOpenHands());
  assert.match(res.err, /--endpoint has no effect without --model/);
});

test("Codex gets a custom provider pointing at the endpoint", async () => {
  const f = makeFixture();
  const { pkg } = await setup(f);
  const argsFile = join(tmpdir(), `codex-args-${Date.now()}.json`);
  const res = await asp(f, ["run", pkg, "--backend", "codex", "--project", f.project, "--prompt", "go",
    "--model", "qwen3-coder", "--endpoint", "http://localhost:8000/v1", "--api-key-env", "VLLM_KEY"], fakeCodex({ FAKE_CODEX_ARGS: argsFile, VLLM_KEY: "k" }));
  assert.equal(res.code, 0, res.err);
  const args: string[] = JSON.parse(readFileSync(argsFile, "utf8"));
  assert.ok(args.includes("model_provider=\"asp_open\""));
  assert.ok(args.includes("model_providers.asp_open.base_url=\"http://localhost:8000/v1\""));
  assert.ok(args.includes("model_providers.asp_open.env_key=\"VLLM_KEY\""));
  assert.equal(args[args.indexOf("-m") + 1], "qwen3-coder");
});

test("the kill switch works on OpenHands: an out-of-scope terminal action stops the run and settles with full fault", async () => {
  const f = makeFixture();
  const { pkg, contractId } = await setup(f, ["repo.read"]);
  const run = await asp(f, ["run", pkg, "--backend", "openhands", "--project", f.project, "--prompt", "go", "--contract", contractId!],
    fakeOpenHands({ FAKE_OH_ACTIONS: JSON.stringify([{ tool_name: "terminal", action: { command: "rm -rf /tmp/whatever" } }]) }));
  assert.equal(run.code, 1);
  assert.match(run.err, /KILL SWITCH\s+shell\.exec/);
  assert.match(run.err, /kill-switch settlement: bond fully slashed/);
  assert.match((await asp(f, ["credits", "balance", ALICE])).out, /: 1200 credits/);
});

test("OpenHands tool calls inside the Mandate are reported with a fingerprint, not killed", async () => {
  const f = makeFixture();
  const { pkg, contractId } = await setup(f, ["repo.read"]);
  const run = await asp(f, ["run", pkg, "--backend", "openhands", "--project", f.project, "--prompt", "go", "--contract", contractId!],
    fakeOpenHands({ FAKE_OH_ACTIONS: JSON.stringify([{ tool_name: "file_editor", action: { command: "view", path: "/x" } }]) }));
  assert.equal(run.code, 0, run.err);
  assert.match(run.err, /reported scopes: repo\.read/);
  assert.doesNotMatch(run.err, /KILL SWITCH/);
});
