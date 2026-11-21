/**
 * Launch plans for two runtimes that are pointed at the gateway as an OpenAI-compatible host: OpenClaw (`openclaw agent --local`) and Hermes Agent (`hermes chat --oneshot`). The plan is data (the files to write
 * into a private home for the run, the environment and the command), so it is tested without either tool installed; `asp run openclaw|hermes` executes it (packages/asp-cli/src/gateway-agent-runtime.mjs).
 * The tool is given a placeholder key: the real provider key stays with the gateway, which judges every call before the agent sees it. The tool's own configuration in the person's home is never touched: a home of
 * the run is used. Written from each project's published documentation (OpenClaw: models.providers.<id> with baseUrl and api; Hermes: model.provider custom with base_url, HERMES_HOME). Neither tool has been run
 * live through `asp run` (evidence: stand-in), so a flag that a release renames is found by the live run, not before it.
 */
import { join } from "node:path";

export interface GatewayAgentPlan {
  /** Files to write before the run: path (inside the run's home) and content. */
  files: { path: string; content: string }[];
  env: Record<string, string>;
  /** The program (a name on the PATH, or ASP_OPENCLAW_BIN / ASP_HERMES_BIN) and its arguments. */
  command: { bin: string; args: string[] };
}
export interface GatewayAgentInput { gatewayUrl: string; model: string; prompt: string; project: string; runHome: string }

/** The key the tool is given in place of the person's: it only has to be present. */
export const GATEWAY_PLACEHOLDER_KEY = "asp-gateway-placeholder";
const v1 = (u: string) => `${u.replace(/\/$/, "")}/v1`;

export function openclawPlan(i: GatewayAgentInput): GatewayAgentPlan {
  const stateDir = join(i.runHome, "openclaw");
  const provider = "asp-gateway";
  const config = {
    models: { mode: "replace", providers: { [provider]: { baseUrl: v1(i.gatewayUrl), apiKey: GATEWAY_PLACEHOLDER_KEY, api: "openai-completions", models: [{ id: i.model, name: i.model, reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 32000 }] } } },
    agents: { defaults: { model: `${provider}/${i.model}`, workspace: i.project } },
  };
  return {
    files: [{ path: join(stateDir, "openclaw.json"), content: JSON.stringify(config, null, 2) + "\n" }],
    env: { HOME: i.runHome, USERPROFILE: i.runHome, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: join(stateDir, "openclaw.json"), CUSTOM_API_KEY: GATEWAY_PLACEHOLDER_KEY },
    command: { bin: "openclaw", args: ["agent", "--local", "--model", `${provider}/${i.model}`, "--timeout", "600", "--message", i.prompt] },
  };
}

export function hermesPlan(i: GatewayAgentInput): GatewayAgentPlan {
  const home = join(i.runHome, "hermes");
  const yaml = ["model:", "  provider: custom", `  default: ${JSON.stringify(i.model)}`, `  base_url: ${JSON.stringify(v1(i.gatewayUrl))}`, "terminal:", "  backend: local", ""].join("\n");
  return {
    files: [{ path: join(home, "config.yaml"), content: yaml }],
    env: { HERMES_HOME: home, OPENAI_BASE_URL: v1(i.gatewayUrl), OPENAI_API_KEY: GATEWAY_PLACEHOLDER_KEY, TERMINAL_ENV: "local" },
    command: { bin: "hermes", args: ["chat", "--oneshot", "-Q", "--provider", "custom", "--base-url", v1(i.gatewayUrl), "--api-key", GATEWAY_PLACEHOLDER_KEY, "--model", i.model, "--toolsets", "terminal,file", "-q", i.prompt] },
  };
}

export const gatewayAgentPlan = (runtime: string, i: GatewayAgentInput): GatewayAgentPlan | undefined => runtime === "openclaw" ? openclawPlan(i) : runtime === "hermes" ? hermesPlan(i) : undefined;
