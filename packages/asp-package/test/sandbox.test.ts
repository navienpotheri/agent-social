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

import { dockerPlan } from "../src/index.ts";

const dp = { id: "t1", image: "python:3.13-alpine", projectDir: "C:/work/proj", projectWritable: false, network: false, gatewayPort: 5555, relayPort: 18080, relayScriptPath: "C:/run/relay-tcp.py", env: { OPENAI_API_KEY: "asp-gateway" } };

test("the Docker backend: an internal network, a relay as the only route to the gateway, a hardened read-only agent container", () => {
  const p = dockerPlan(dp);
  assert.deepEqual(p.setup[0], ["network", "create", "--internal", "asp-net-t1"]);
  const create = p.setup[1];
  assert.ok(has(create, "--network", "asp-net-t1") && has(create, "--network-alias", "gateway"));
  assert.deepEqual(create.slice(-5), ["python", "/relay.py", "18080", "host.docker.internal", "5555"]);
  assert.deepEqual(p.setup[2], ["network", "connect", "bridge", "asp-relay-t1"], "only the relay can reach the host");
  assert.deepEqual(p.setup[3], ["start", "asp-relay-t1"]);
  assert.deepEqual(p.cleanup, [["rm", "-f", "asp-relay-t1"], ["network", "rm", "asp-net-t1"]]);
  assert.equal(p.agentBase, "http://gateway:18080");
  const a = p.agent;
  assert.ok(has(a, "--network", "asp-net-t1"), "the agent is on the internal network only");
  assert.ok(a.includes("--read-only") && has(a, "--cap-drop", "ALL") && has(a, "--security-opt", "no-new-privileges") && has(a, "--user", "65534:65534"));
  assert.ok(has(a, "-v", "C:/work/proj:/work:ro") && has(a, "-w", "/work"));
  assert.ok(has(a, "-e", "OPENAI_API_KEY=asp-gateway") && has(a, "-e", "HOME=/tmp"));
  assert.equal(a.at(-1), "python:3.13-alpine", "the agent's command is appended after the image");
});

test("the Docker backend with a network scope uses the default network and the host's address; repo.write and binds are honoured", () => {
  const p = dockerPlan({ ...dp, network: true, projectWritable: true, extraBinds: [{ path: "C:/tools", writable: false }, { path: "C:/cache", writable: true }], files: [{ host: "C:/run/mcp.json", container: "/asp/mcp.json" }] });
  assert.deepEqual(p.setup, []);
  assert.deepEqual(p.cleanup, []);
  assert.equal(p.agentBase, "http://host.docker.internal:5555");
  assert.ok(has(p.agent, "--add-host", "host.docker.internal:host-gateway") && !p.agent.includes("--internal"));
  assert.ok(has(p.agent, "-v", "C:/work/proj:/work:rw") && has(p.agent, "-v", "C:/tools:/bind/0:ro") && has(p.agent, "-v", "C:/cache:/bind/1:rw") && has(p.agent, "-v", "C:/run/mcp.json:/asp/mcp.json:ro"));
});
