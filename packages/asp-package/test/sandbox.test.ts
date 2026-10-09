import { test } from "node:test";
import assert from "node:assert/strict";
import { bwrapArgs, policyNeedsNetwork, sandboxAvailable, type SandboxPolicy } from "../src/index.ts";

const base: SandboxPolicy = {
  projectDir: "/work/proj", projectWritable: false, network: false, memoryDir: "/work/mem", socketDir: "/work/sock", relayPort: 18080,
  env: { OPENAI_BASE_URL: "http://127.0.0.1:18080/v1", OPENAI_API_KEY: "asp-gateway" }, home: "/home/agent",
};
const has = (a: string[], ...seq: string[]) => a.some((_, i) => seq.every((s, j) => a[i + j] === s));

test("a sandbox with no network scope has no network, a hidden home, a read-only project and a cleared environment", () => {
  const a = bwrapArgs(base, ["python3", "agent.py", "--flag"], { PATH: "/usr/bin", ASP_OR_KEY: "secret-provider-key", LANG: "C" });
  assert.ok(a.includes("--unshare-net"));
  assert.ok(a.includes("--clearenv") && a.includes("--die-with-parent"));
  assert.ok(has(a, "--ro-bind", "/", "/"));
  assert.ok(has(a, "--tmpfs", "/home/agent"), "the home folder is hidden");
  assert.ok(has(a, "--ro-bind", "/work/proj", "/work/proj"), "the project is read-only without repo.write");
  assert.ok(has(a, "--bind", "/work/mem", "/work/mem"), "the agent's memory is writable");
  assert.ok(has(a, "--bind", "/work/sock", "/tmp/asp"));
  assert.ok(has(a, "--setenv", "OPENAI_API_KEY", "asp-gateway") && has(a, "--setenv", "PATH", "/usr/bin"));
  assert.ok(!a.includes("secret-provider-key") && !a.includes("ASP_OR_KEY"), "operator secrets never reach the agent");
  const i = a.indexOf("--");
  assert.deepEqual(a.slice(i + 1, i + 3), ["sh", "-c"]);
  assert.match(a[i + 3], /python3 \/tmp\/asp\/relay\.py 18080 \/tmp\/asp\/gw\.sock/);
  assert.deepEqual(a.slice(i + 4), ["sh", "python3", "agent.py", "--flag"], "the agent's command follows, with arguments intact");
});

test("repo.write makes the project writable, a network scope keeps the network and drops the relay, extra binds are honoured", () => {
  const w = bwrapArgs({ ...base, projectWritable: true, network: true, extraBinds: [{ path: "/opt/tools" }, { path: "/work/cache", writable: true }] }, ["agent"], {});
  assert.ok(!w.includes("--unshare-net"));
  assert.ok(has(w, "--bind", "/work/proj", "/work/proj"));
  assert.ok(has(w, "--ro-bind", "/opt/tools", "/opt/tools") && has(w, "--bind", "/work/cache", "/work/cache"));
  assert.ok(!w.join(" ").includes("relay.py"));
  assert.equal(policyNeedsNetwork(["repo.read"]), false);
  assert.equal(policyNeedsNetwork(["repo.read", "web.read"]), true);
  assert.equal(policyNeedsNetwork(["shell.network"]), true);
});

test("the sandbox says plainly when it cannot run here", () => {
  const a = sandboxAvailable();
  if (process.platform !== "linux") { assert.equal(a.ok, false); assert.match(a.reason!, /needs Linux/); }
  else assert.equal(typeof a.ok, "boolean");
});
