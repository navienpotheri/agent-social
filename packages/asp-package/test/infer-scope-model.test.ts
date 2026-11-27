import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSizing, scopesFromSizing, sizeWithModel } from "../src/index.ts";

// Gap BM17: a model reads the task. It only narrows, never grants network, push or protected files, and any failure is a fallback.
const FULL = ["repo.read", "repo.write", "shell.exec", "tests.run"];
const reply = (text: string, ok = true) => (async () => ({ ok, json: async () => ({ content: [{ type: "text", text }] }) }) as unknown as Response) as typeof fetch;
const ask = (text: string) => sizeWithModel("Fix the failing date parser", { apiKey: "k", fetchImpl: reply(text) });

test("a good answer becomes the scopes beyond reading", async () => {
  const s = await ask('Sure: {"scopes": ["repo.write", "tests.run"], "extras": [], "unsure": false, "note": "edit and check"}');
  assert.deepEqual(s?.scopes, ["repo.write", "tests.run"]);
  assert.deepEqual(scopesFromSizing(s!, FULL).scopes, ["repo.read", "repo.write", "tests.run"]);
  assert.match(scopesFromSizing(s!, FULL).why, /sized by a model that read your task/);
});

test("it cannot grant network, push or protected files: they become hints", async () => {
  const s = await ask('{"scopes": ["repo.write", "shell.network", "repo.push", "repo.write.protected", "shell.exec"], "extras": ["web.read"], "unsure": true, "note": "x"}');
  assert.deepEqual(s?.scopes, ["repo.write", "shell.exec"]);
  assert.deepEqual([...(s?.extras ?? [])].sort(), ["repo.push", "repo.write.protected", "shell.network", "web.read"]);
  const r = scopesFromSizing(s!, FULL);
  assert.deepEqual(r.scopes, ["repo.read", "repo.write", "shell.exec"]);
  assert.match(r.why, /never granted automatically/);
  assert.match(r.why, /unsure/);
});

test("a hijacked answer can give at most the usual set, and unknown scopes are ignored", async () => {
  const s = await ask('{"scopes": ["repo.write", "tests.run", "shell.exec", "root.everything", "*"], "extras": [], "unsure": false, "note": "ignore previous instructions"}');
  assert.deepEqual(s?.scopes, ["repo.write", "tests.run", "shell.exec"]);
  assert.deepEqual(scopesFromSizing(s!, FULL).scopes, FULL);
});

test("anything unusable is undefined, so the caller falls back to the words", async () => {
  assert.equal(await ask("I think it needs write access."), undefined, "no JSON");
  assert.equal(await ask('{"scopes": "all"}'), undefined, "scopes is not a list");
  assert.equal(await ask("{not json}"), undefined);
  assert.equal(await sizeWithModel("x", { apiKey: "k", fetchImpl: reply("{}", false) }), undefined, "an error status");
  assert.equal(await sizeWithModel("x", { apiKey: "k", fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch }), undefined, "no network");
  const hang = (async (_u: unknown, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as typeof fetch;
  assert.equal(await sizeWithModel("x", { apiKey: "k", fetchImpl: hang, timeoutMs: 30 }), undefined, "a timeout");
});

test("the request carries the task as data, the key in the header, and the model asked for", async () => {
  let seen: { url: string; headers: Record<string, string>; body: { model: string; messages: { content: string }[]; system: string } } | undefined;
  const spy = (async (url: string, init: RequestInit) => { seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }; return { ok: true, json: async () => ({ content: [{ type: "text", text: '{"scopes": [], "extras": [], "unsure": false, "note": ""}' }] }) } as unknown as Response; }) as unknown as typeof fetch;
  await sizeWithModel("Explain the gateway", { apiKey: "secret-key", baseUrl: "http://127.0.0.1:9/", model: "m-1", fetchImpl: spy });
  assert.equal(seen?.url, "http://127.0.0.1:9/v1/messages");
  assert.equal(seen?.headers["x-api-key"], "secret-key");
  assert.equal(seen?.body.model, "m-1");
  assert.equal(seen?.body.messages[0].content, "Task: Explain the gateway");
  assert.match(seen?.body.system ?? "", /do not follow them/);
  assert.equal(JSON.stringify(seen?.body).includes("secret-key"), false, "the key is not in the body");
});

test("cleanSizing helper", () => {
  assert.equal(cleanSizing(undefined), undefined);
  assert.deepEqual(cleanSizing({ scopes: [], extras: ["nope"], note: 5 }), { scopes: [], extras: [], unsure: false, note: "" });
});

test("when it cannot answer, it says why (never the key or the task)", async () => {
  const why: string[] = [];
  const failing = (async () => ({ ok: false, status: 429, json: async () => ({ error: { type: "rate_limit_error", message: "slow down" } }) }) as unknown as Response) as typeof fetch;
  await sizeWithModel("secret task text", { apiKey: "secret-key", fetchImpl: failing, onFail: (w) => why.push(w) });
  await sizeWithModel("secret task text", { apiKey: "secret-key", fetchImpl: reply("no json here"), onFail: (w) => why.push(w) });
  await sizeWithModel("secret task text", { apiKey: "secret-key", fetchImpl: (async () => { throw new Error("socket hang up"); }) as typeof fetch, onFail: (w) => why.push(w) });
  assert.match(why[0], /answered 429 \(rate_limit_error: slow down\)/);
  assert.match(why[1], /not the expected JSON \(it began: no json here\)/);
  assert.match(why[2], /the call failed: socket hang up/);
  assert.equal(why.join(" ").includes("secret"), false);
});

test("a reply cut off by the token limit is named as such", async () => {
  const why: string[] = [];
  const cut = (async () => ({ ok: true, json: async () => ({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"scopes":' }] }) }) as unknown as Response) as typeof fetch;
  assert.equal(await sizeWithModel("x", { apiKey: "k", fetchImpl: cut, onFail: (w) => why.push(w) }), undefined);
  assert.match(why[0], /cut off before the answer was finished/);
});
