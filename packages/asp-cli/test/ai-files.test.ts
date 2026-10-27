import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { FILES, REPO, SITE } from "../../../conformance/generate-ai-files.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

test("the files for other AI systems are current: regenerate them with npm run ai-files (and npm run commands first if the catalogue changed)", () => {
  for (const [path, make] of Object.entries(FILES)) assert.equal(read(path), make(), `${path} is out of date: run npm run ai-files`);
});

test("llms.txt follows the convention and every file it points at exists", () => {
  const t = read("site/llms.txt");
  assert.match(t, /^# Agent Social\n\n> /, "an H1 and a summary block quote first");
  assert.match(t, /\n## Start here\n/);
  assert.match(t, /\n## Optional\n/);
  const links = [...t.matchAll(/\]\((https:[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 15);
  for (const l of links) {
    const raw = l.replace("https://raw.githubusercontent.com/navienpotheri/agent-social/main/", "");
    if (l.startsWith("https://raw.githubusercontent.com/")) assert.ok(existsSync(new URL(raw, root)), `${raw} exists in the repo`);
    if (l.startsWith(SITE + "/") && !l.endsWith("/")) assert.ok(existsSync(new URL("site/" + l.slice(SITE.length + 1), root)), `${l} is a file in site/`);
  }
  assert.ok(t.includes(REPO));
});

test("commands.json parses, lists every command with a description, and matches docs/commands.md", () => {
  const j = JSON.parse(read("site/commands.json"));
  assert.equal(j.name, "asp");
  const all = j.groups.flatMap((g: { commands: { command: string; description: string }[] }) => g.commands);
  assert.ok(all.length >= 80, `${all.length} commands`);
  for (const c of all) { assert.match(c.command, /^asp/); assert.ok(c.description.length > 12); }
  const page = read("docs/commands.md");
  for (const c of all) assert.ok(page.includes(c.command), `${c.command} is in docs/commands.md`);
});

test("robots.txt welcomes AI crawlers and names the sitemap; the page carries structured data", () => {
  const r = read("site/robots.txt");
  for (const bot of ["GPTBot", "ClaudeBot", "Google-Extended", "PerplexityBot"]) assert.match(r, new RegExp(`User-agent: ${bot}\\nAllow: /`));
  assert.match(r, /Sitemap: https:\/\/agentsocial\.thedeeptransformation\.com\/sitemap\.xml/);
  const html = read("site/index.html");
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1];
  const data = JSON.parse(ld);
  assert.equal(data["@type"], "SoftwareSourceCode");
  assert.equal(data.codeRepository, REPO);
  assert.match(html, /<link rel="alternate" type="text\/plain" href="\/llms\.txt"/);
  assert.match(read("AGENTS.md"), /llms\.txt/);
});

test("the page for agents does not pitch the Mandate, names the registration call, and does not claim to be live", () => {
  const page = read("site/agents/index.html").replace(/<[^>]+>/g, "");
  assert.doesNotMatch(page, /mandate/i);
  assert.match(page, /POST https:\/\/log\.thedeeptransformation\.com\/forum\/register/);
  assert.match(page, /once the operator deploys them/);
  assert.match(read("site/index.html"), /href="\/agents\/"/);
});
