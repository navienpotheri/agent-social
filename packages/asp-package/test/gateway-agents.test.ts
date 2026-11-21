// Rows UC-1880 and UC-1881: the launch plans of OpenClaw and Hermes Agent under the gateway (stand-ins; neither tool is run live yet). The plan is data, so it is checked without the tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewayAgentPlan, openclawPlan, hermesPlan, GATEWAY_PLACEHOLDER_KEY } from "../src/index.ts";

const input = { gatewayUrl: "http://127.0.0.1:4711/", model: "some/model", prompt: "Fix the bug", project: "/work/p", runHome: "/tmp/run-home" };
const norm = (p: string) => p.replace(/\\/g, "/");

test("OpenClaw: a private home, the gateway as the only provider, a placeholder key, one local turn", () => {
  const p = openclawPlan(input);
  assert.equal(p.files.length, 1);
  assert.ok(norm(p.files[0].path).startsWith("/tmp/run-home/"), "inside the run's home, never the person's own");
  const cfg = JSON.parse(p.files[0].content);
  assert.equal(cfg.models.mode, "replace", "the person's own providers are not merged in");
  const prov = cfg.models.providers["asp-gateway"];
  assert.equal(prov.baseUrl, "http://127.0.0.1:4711/v1");
  assert.equal(prov.api, "openai-completions");
  assert.equal(prov.apiKey, GATEWAY_PLACEHOLDER_KEY);
  assert.equal(cfg.agents.defaults.model, "asp-gateway/some/model");
  assert.deepEqual(Object.keys(cfg.models.providers), ["asp-gateway"]);
  assert.deepEqual(p.command.args.slice(0, 2), ["agent", "--local"]);
  assert.equal(p.command.args.at(-1), "Fix the bug");
  assert.ok(norm(p.env.HOME) === "/tmp/run-home" && norm(p.env.OPENCLAW_CONFIG_PATH).startsWith("/tmp/run-home/"));
});

test("Hermes Agent: a private HERMES_HOME, a custom endpoint at the gateway, a placeholder key, one quiet turn", () => {
  const p = hermesPlan(input);
  assert.ok(norm(p.files[0].path).startsWith("/tmp/run-home/hermes/"));
  assert.match(p.files[0].content, /provider: custom/);
  assert.match(p.files[0].content, /base_url: "http:\/\/127\.0\.0\.1:4711\/v1"/);
  assert.equal(p.env.OPENAI_BASE_URL, "http://127.0.0.1:4711/v1");
  assert.equal(p.env.OPENAI_API_KEY, GATEWAY_PLACEHOLDER_KEY);
  assert.ok(norm(p.env.HERMES_HOME).startsWith("/tmp/run-home/"));
  assert.deepEqual(p.command.args.slice(0, 3), ["chat", "--oneshot", "-Q"]);
  assert.equal(p.command.args.at(-2), "-q");
  assert.equal(p.command.args.at(-1), "Fix the bug");
});

test("no plan carries a real key, and an unknown runtime has no plan", () => {
  for (const p of [openclawPlan({ ...input, prompt: "x" }), hermesPlan({ ...input, prompt: "x" })]) {
    const all = JSON.stringify(p);
    assert.ok(!/sk-[A-Za-z0-9]{10}/.test(all));
    assert.ok(all.includes(GATEWAY_PLACEHOLDER_KEY));
  }
  assert.equal(gatewayAgentPlan("goose", input), undefined);
  assert.ok(gatewayAgentPlan("openclaw", input) && gatewayAgentPlan("hermes", input));
});
