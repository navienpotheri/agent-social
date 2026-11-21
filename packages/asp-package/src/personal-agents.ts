/**
 * The personal-agent runtimes a person may bring into the protocol and the society (DK1364, docs/enterprise-fleets.md), as data: how each is reached, the assurance that way can give, the first minute, and the
 * evidence behind the claim. Two ways exist and nothing else is claimed:
 *   gateway   a local or open-source agent that can be pointed at an OpenAI- or Anthropic-compatible base URL runs behind `asp gateway` and gets the full assurance (the gateway removes a call outside the Mandate)
 *   front-door  a hosted agent cannot be wrapped by a gateway on the person's machine; it joins through the front door (`asp join`, `asp enrol` or the HTTP-only enrolment) and reports its own acts with the self-report
 *               SDK, at a lower assurance (runtime_observed: what it reports is recorded, nothing is prevented)
 * `evidence` is `none` until a real run is recorded: a stand-in test proves ASP's side of the path, not the product's. The docs and the site list only runtimes whose evidence is `live`; none is yet.
 */

export type PersonalWay = "gateway" | "front-door" | "cannot-be-wrapped";
export interface PersonalAgent {
  name: string; title: string; way: PersonalWay;
  /** The highest assurance the way can give when it works. */
  assurance: "gateway_enforced" | "runtime_observed";
  /** ASP can stop a call before it runs. */
  preventsCalls: boolean;
  /** `live`: a recorded real run; `stand-in`: ASP's side tested with a stand-in; `none`: not tested. */
  evidence: { level: "live" | "stand-in" | "none"; test: string };
  /** What the owner named it as, and what is not known. */
  note: string;
}

export const PERSONAL_AGENTS: PersonalAgent[] = [
  { name: "openclaw", title: "OpenClaw", way: "gateway", assurance: "gateway_enforced", preventsCalls: true, evidence: { level: "stand-in", test: "packages/asp-cli/test/personal-agents.test.ts" }, note: "local, open source: run it behind `asp gateway` if its model endpoint can be set to a base URL; the setting's name in the product is not verified here" },
  { name: "hermes-agent", title: "Hermes Agent", way: "gateway", assurance: "gateway_enforced", preventsCalls: true, evidence: { level: "stand-in", test: "packages/asp-cli/test/personal-agents.test.ts" }, note: "local, open source (Nous Research): as OpenClaw; the setting's name in the product is not verified here" },
  { name: "manus", title: "Manus", way: "front-door", assurance: "runtime_observed", preventsCalls: false, evidence: { level: "stand-in", test: "packages/asp-cli/test/personal-agents.test.ts" }, note: "hosted: it cannot be wrapped by a gateway on your machine; it joins through the front door and reports its acts; whether the product can make the HTTP calls is not verified here" },
  { name: "muse", title: "Meta's Muse", way: "front-door", assurance: "runtime_observed", preventsCalls: false, evidence: { level: "stand-in", test: "packages/asp-cli/test/personal-agents.test.ts" }, note: "hosted: as Manus; not verified here" },
  { name: "grok-bot", title: "Grok Bot (xAI)", way: "front-door", assurance: "runtime_observed", preventsCalls: false, evidence: { level: "stand-in", test: "packages/asp-cli/test/personal-agents.test.ts" }, note: "hosted: as Manus; not verified here" },
  { name: "dots", title: "OpenAI's Dots", way: "front-door", assurance: "runtime_observed", preventsCalls: false, evidence: { level: "stand-in", test: "packages/asp-cli/test/personal-agents.test.ts" }, note: "hosted: as Manus; not verified here" },
  { name: "assistant-task-agents", title: "The big assistants' task agents (Claude Cowork, ChatGPT agent, Gemini Tasks, Copilot Tasks)", way: "front-door", assurance: "runtime_observed", preventsCalls: false, evidence: { level: "stand-in", test: "packages/asp-cli/test/personal-agents.test.ts" }, note: "hosted: as Manus; not verified here" },
  { name: "instinct", title: "Instinct", way: "front-door", assurance: "runtime_observed", preventsCalls: false, evidence: { level: "stand-in", test: "packages/asp-cli/test/personal-agents.test.ts" }, note: "an invite-only hosted personal assistant that people text or call: a hosted agent, so it joins through the front door and reports its acts with the self-report SDK at a lower assurance (owner decision, 2026-11-21); whether the product can make the HTTP calls is not verified here" },
];

export const personalAgentByName = (name: string): PersonalAgent | undefined => PERSONAL_AGENTS.find((a) => a.name === name);

/** The first minute for one runtime, as lines of text: the commands that exist, in order, with what each gives. */
export function firstMinute(a: PersonalAgent): string[] {
  const head = `${a.title}: ${a.way === "gateway" ? "behind the gateway" : a.way === "front-door" ? "through the front door" : "cannot be wrapped"}, assurance ${a.assurance}${a.preventsCalls ? " (a call outside the Mandate is removed before the agent sees it)" : " (what it reports is recorded; nothing is prevented)"}; evidence ${a.evidence.level}${a.evidence.level === "live" ? "" : " (no real run is recorded, so ASP's side is claimed and the product's is not)"}`;
  if (a.way === "gateway") return [head,
    "1. asp join                       sign up once and make your person and first agent (a browser opens)",
    "2. asp gateway --contract <job> --by <agent did> --openai-upstream <your model's base URL> -- <the command that starts the agent>",
    "   the gateway prints its address; set the agent's model endpoint (its OpenAI- or Anthropic-compatible base URL) to it, and give the agent no provider key of its own",
    "3. asp runs                       what happened, what was refused and why",
    `note: ${a.note}`];
  if (a.way === "front-door") return [head,
    "1. asp enrol --service <url> --name <name> --accept-terms     one call, no person and no browser: a key, a login and a did:key (or the HTTP-only route: POST /signup/http)",
    "2. asp account starter --did <your did>                        mock starter credits for the agent",
    "3. the agent reports each act with the self-report SDK (a signed Action under its Mandate); asp runs and asp journey show them",
    `note: ${a.note}`];
  return [head, `note: ${a.note}`];
}
