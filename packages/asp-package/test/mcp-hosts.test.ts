// H14 (spec-delta S340): an MCP tool that names a destination in its arguments is host-checked against the Mandate's network hosts and counted against the per-host and total rate, in the gateway's judge and in
// both runtimes' pre-call hooks, which agree with it. Fake hosts only (example.* names).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostsOf, judge, mcpUrls } from "../src/gateway/judge.ts";
// @ts-expect-error: plain .mjs without type declarations
import { hostRefusal as claudeHost, mcpUrls as claudeUrls, rateRefusal as claudeRate } from "../src/adapters/claude-code-mandate-hook.mjs";
// @ts-expect-error: plain .mjs without type declarations
import { hostRefusal as agyHost, mcpUrls as agyUrls, rateRefusal as agyRate } from "../src/adapters/antigravity-mandate-hook.mjs";
import { RateLimiter } from "../src/gateway/rate.ts";

const HOSTS = ["api.example.com", "*.docs.example.org"];
const call = (name: string, args: Record<string, unknown>) => ({ name, args });
const scopes = ["mcp.fetch.get", "mcp.fetch.run", "mcp.search.query", "mcp.db.query"];

test("H14: an MCP tool that names a destination is refused when the host is not one the Mandate allows, and allowed when it is", () => {
  const ok = judge(call("mcp__fetch__get", { url: "https://api.example.com/v1/items" }), scopes, [], () => false, HOSTS);
  assert.equal(ok.allow, true);
  assert.equal(judge(call("mcp__fetch__get", { url: "https://x.docs.example.org/a" }), scopes, [], () => false, HOSTS).allow, true, "a subdomain wildcard");
  const bad = judge(call("mcp__fetch__get", { url: "https://evil.example.net/steal" }), scopes, [], () => false, HOSTS);
  assert.equal(bad.allow, false);
  assert.match(bad.reason!, /the host evil\.example\.net is not one this job's Mandate allows/);
  // The destination can be in another key, nested, or a bare host.
  for (const args of [{ endpoint: "https://evil.example.net" }, { request: { target: { base_url: "http://evil.example.net/x" } } }, { host: "evil.example.net" }, { options: ["--x"], opts: { link: "ftp://evil.example.net/f" } }]) {
    const v = judge(call("mcp__fetch__run", args as Record<string, unknown>), scopes, [], () => false, HOSTS);
    assert.equal(v.allow, false, JSON.stringify(args));
    assert.match(v.reason!, /evil\.example\.net/);
  }
  // A URL that is allowed in one key does not hide one that is not in another.
  assert.equal(judge(call("mcp__fetch__get", { url: "https://api.example.com/a", callback: "https://evil.example.net/hook" }), scopes, [], () => false, HOSTS).allow, false);
});

test("H14: what is not claimed: with no hosts in the Mandate nothing changes, and a tool that names no destination is not host-checked", () => {
  assert.equal(judge(call("mcp__fetch__get", { url: "https://evil.example.net/x" }), scopes, [], () => false, undefined).allow, true, "no network.hosts, no host limit (as for web tools)");
  assert.equal(judge(call("mcp__db__query", { sql: "select 1" }), scopes, [], () => false, HOSTS).allow, true, "no destination in the arguments: the per-server rate still counts it");
  assert.equal(judge(call("mcp__fetch__get", { url: "https://evil.example.net/x" }), ["mcp.search.query"], [], () => false, HOSTS).allow, false, "and a scope the Mandate does not grant is refused as before");
});

test("H14: the hosts of an MCP call are read for the rate too: per host and in total, and the hooks' copies agree with the gateway on what they read and refuse", () => {
  assert.deepEqual(hostsOf(call("mcp__fetch__get", { url: "https://API.example.com/x", other: { endpoint: "https://b.example.org" } }), "mcp.fetch.get").sort(), ["api.example.com", "b.example.org"]);
  const args = { url: "https://api.example.com/x", nested: { host: "b.example.org" }, n: 3 };
  assert.deepEqual(claudeUrls(args), mcpUrls(args));
  assert.deepEqual(agyUrls(args), mcpUrls(args));
  for (const refusal of [claudeHost, agyHost]) {
    assert.equal(refusal("mcp.fetch.get", undefined, ["https://api.example.com/x"], HOSTS), undefined);
    assert.match(refusal("mcp.fetch.get", undefined, ["https://evil.example.net/x"], HOSTS)!, /the host evil\.example\.net is not one this job's Mandate allows/);
    assert.equal(refusal("mcp.fetch.get", undefined, [], HOSTS), undefined, "no destination, no host check");
  }
  // The rate: 3 calls a minute to one host, from the gateway's limiter and from each hook's ledger.
  const lim = new RateLimiter(() => 1000);
  const take = () => lim.take({ perHost: { "mcp:fetch": 1, "api.example.com": 1 }, unknown: 0, total: 1 }, { per_host_per_minute: 3 });
  assert.equal(take().ok && take().ok && take().ok, true);
  assert.equal(take().ok, false, "the fourth call to the host in a minute is refused");
  const dir = mkdtempSync(join(tmpdir(), "asp-h14-"));
  for (const [name, rate] of [["claude", claudeRate], ["agy", agyRate]] as const) {
    const ledger = join(dir, `${name}.ndjson`);
    const verdicts = [1, 2, 3, 4].map(() => rate("mcp.fetch.get", undefined, ["https://api.example.com/x"], { per_host_per_minute: 3 }, ledger, 5000));
    assert.deepEqual(verdicts.map((v) => v === undefined), [true, true, true, false], `${name} hook`);
    assert.match(verdicts[3]!, /api\.example\.com/);
  }
});
