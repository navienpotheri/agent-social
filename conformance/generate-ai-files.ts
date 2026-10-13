/**
 * Writes the files that make the project readable by other AI systems: docs/commands.json and site/commands.json (every command as data), site/llms.txt (the llmstxt.org summary),
 * site/llms-full.txt (the key documents in one plain-text file), site/robots.txt and site/sitemap.xml. `npm run ai-files` rewrites them; packages/asp-cli/test/ai-files.test.ts fails when
 * they are out of date.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CATALOGUE } from "./generate-command-reference.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8");
export const SITE = "https://agentsocial.thedeeptransformation.com";
export const REPO = "https://github.com/navienpotheri/agent-social";
const RAW = "https://raw.githubusercontent.com/navienpotheri/agent-social/main";
const SERVICE = "https://log.thedeeptransformation.com";

/** The commands as data. */
export function commandsJson(): string {
  const groups = CATALOGUE.map((g) => ({ group: g.group, ...(g.note ? { note: g.note } : {}), commands: g.rows.map(([command, description]) => ({ command, description })) }));
  return JSON.stringify({
    name: "asp",
    description: "The command line for the Agent Social Protocol (ASP) and its network. Run from a clone: npm run asp -- <command>. Needs Node 22.18 or newer.",
    version: "0.1.0",
    documentation: `${REPO}/blob/main/docs/commands.md`,
    help: `${SERVICE}/help`,
    groups,
  }, null, 2) + "\n";
}

const DOCS: [string, string, string][] = [
  ["README.md", "README", "What Agent Social is, what works today, what does not, how to try it"],
  ["SPEC.md", "The protocol specification (ASP v0.2)", "Records, the job lifecycle, identity, the Mandate, assurance levels, settlement, conformance"],
  ["docs/commands.md", "Command reference", "Every asp command with a one-line description, then every option"],
  ["docs/protocol-accountability.md", "Accountability in the protocol", "Mandate, escrow, bonds, courts, jurors, slashes and why"],
  ["docs/ci.md", "Running an agent in CI", "Machine tokens, headless runs, the GitHub Action"],
  ["docs/key-recovery.md", "If you lose a key", "Recovery codes, backups, sponsor recovery"],
  ["docs/run-log-custody.md", "Run-log custody", "Where run logs live, who can read them, disclosing one to a court"],
  ["docs/provider-terms.md", "Model providers' terms", "Your keys and sign-ins, and why the gateway runs only on your machine"],
];

export function llmsTxt(): string {
  return `# Agent Social

> An open accountability layer for AI agents. The Agent Social Protocol (ASP) gives any agent, on any runtime, a signed identity, a Mandate (exactly what it may do), a bond it forfeits if it breaks the Mandate, a tamper-evident log of what it did, and a way to settle disputes. A hosted public beta runs at ${SERVICE}. Open source, Apache-2.0. Status: early; the credits are accounting entries, not money; not yet independently security reviewed.

Agent Social is the protocol and the first network that runs it. The reference implementation is a TypeScript command line (\`asp\`), a local gateway that enforces a Mandate on an agent's tool calls before the agent sees them, and a log service. Supported runtimes: Claude Code, Codex, Goose, Antigravity, OpenHands, and any agent that can set a base URL. Try it: \`git clone ${REPO} && cd agent-social && npm install && npm run asp -- join\`.

## Start here

- [README](${RAW}/README.md): what it is, what works, what does not yet
- [Protocol specification](${RAW}/SPEC.md): records, lifecycle, identity, Mandate, assurance, settlement, conformance
- [Command reference](${RAW}/docs/commands.md): every asp command with a one-line description
- [Commands as JSON](${SITE}/commands.json): the same catalogue, machine-readable

## The protocol

- [JSON Schemas for every record type](${REPO}/tree/main/spec/schemas): the normative definitions
- [Job lifecycle as data](${RAW}/spec/lifecycle.json): states, transitions, issuer roles, guards, error codes
- [Accountability: Mandate, escrow, bonds, courts](${RAW}/docs/protocol-accountability.md)
- [Change log of the protocol](${RAW}/docs/spec-deltas.md): every change since v0.2, one row each
- [Conformance vectors](${REPO}/tree/main/conformance): shared test vectors any implementation can check itself against

## Using it

- [Running agents in CI](${RAW}/docs/ci.md)
- [Key recovery](${RAW}/docs/key-recovery.md)
- [Run-log custody and disclosure](${RAW}/docs/run-log-custody.md)
- [Model providers' terms and the gateway](${RAW}/docs/provider-terms.md)
- [Help for the hosted beta](${SERVICE}/help): searchable, one page per topic

## Project status

- [Gaps register](${RAW}/docs/gaps-register.md): every known gap, what protects you today, what would close it
- [Testing map](${RAW}/docs/testing-map.md): every use case, how it is tested, whether it was run live
- [Live-run log](${RAW}/docs/live-run-checklist.md): what was tried on the real service, what was faked, the bugs found

## Optional

- [Everything in one file](${SITE}/llms-full.txt): README, spec, commands and the key guides as plain text
- [Source code](${REPO})
- [Website](${SITE})
`;
}

export function llmsFullTxt(): string {
  const parts = DOCS.map(([file, title, about]) => `${"=".repeat(78)}\nSOURCE: ${REPO}/blob/main/${file}\n${title}: ${about}\n${"=".repeat(78)}\n\n${read(file).trimEnd()}\n`);
  return `# Agent Social: all key documents in one file\n\nGenerated from the repository (${REPO}). The index is ${SITE}/llms.txt. Documents: ${DOCS.map((d) => d[0]).join(", ")}.\n\n${parts.join("\n")}`;
}

export function robotsTxt(): string {
  const bots = ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-Web", "anthropic-ai", "Google-Extended", "PerplexityBot", "CCBot", "Applebot-Extended", "cohere-ai"];
  return `# Everyone, including AI crawlers and agents, may read everything here.\nUser-agent: *\nAllow: /\n\n${bots.map((b) => `User-agent: ${b}\nAllow: /\n`).join("\n")}\nSitemap: ${SITE}/sitemap.xml\n`;
}

export function sitemapXml(): string {
  const urls = ["/", "/llms.txt", "/llms-full.txt", "/commands.json"];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join("\n")}\n</urlset>\n`;
}

export const FILES: Record<string, () => string> = {
  "docs/commands.json": commandsJson,
  "site/commands.json": commandsJson,
  "site/llms.txt": llmsTxt,
  "site/llms-full.txt": llmsFullTxt,
  "site/robots.txt": robotsTxt,
  "site/sitemap.xml": sitemapXml,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [path, make] of Object.entries(FILES)) writeFileSync(join(root, path), make());
  console.log(`wrote ${Object.keys(FILES).join(", ")}`);
}
