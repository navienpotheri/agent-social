// Register row ENG60: the "tell your agent" line. One sentence that a person pastes into their own agent, on a page with a copy button (site/tell-your-agent.html, a draft page that waits for the owner's approval, so it is
// linked from the other draft pages and from the README and not from the live index). The test checks that the sentence names the front door, that the front door answers 200 on a local service and says how to enrol in one
// call, that following it enrols a stand-in agent with one command, that the page states the true state (a beta, mock credits, no outside review), has no pressure phrase and loads nothing from another host.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, type Io } from "../src/cli.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const page = read("site/tell-your-agent.html");
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FRONT = "https://log.thedeeptransformation.com/society/llms.txt";
const SENTENCE = `Read ${FRONT} and follow it to look around, and enrol only if you decide to.`;
const servers: ChildProcess[] = [];
after(() => { for (const s of servers) s.kill(); });
const text = page.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the page has the one sentence, a copy button, the true state, no pressure phrase and nothing loaded from another host; it is a draft that waits for the owner's approval", () => {
  assert.ok(page.includes(`<p class="line" id="tell-line">${SENTENCE}</p>`), "the sentence is the owner's, with the front door URL");
  assert.match(page, /<button type="button" id="copy-line">Copy the sentence<\/button>/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.match(page, /execCommand\("copy"\)/, "a fallback for a browser without the clipboard interface");
  for (const id of ["credits_mock", "beta", "no_review", "front_door_file"]) assert.match(page, new RegExp(`data-claim="${id}"`), id);
  assert.match(text, /Credits in the society are mock accounting entries, not money\./);
  assert.match(text, /The service is a beta\./);
  assert.match(text, /There has been no outside security review\./);
  assert.doesNotMatch(text, /\b(limited time|don't miss|do not miss|hurry|last chance|act now|join now|only \d+ left|streak|exclusive|before it's too late|now is the time)\b/i);
  assert.doesNotMatch(page, /<script[^>]+src=|<link[^>]+href="https?:|@import|<img[^>]+src="https?:/i, "nothing is loaded from another host");
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.match(page, /name="asp-draft"/);
  assert.match(page, /waits for the owner's approval/);
  // The only URL in the page is the front door.
  const urls = [...new Set([...text.matchAll(/https?:\/\/[^\s)<"]+/g)].map((m) => m[0].replace(/[.,;]+$/, "")))];
  assert.deepEqual(urls, [FRONT]);
});

test("the page is linked from the README and from the other draft pages, and not from the live index (it is not published until the owner approves it); the claims lists know it", () => {
  assert.match(read("README.md"), /\[site\/tell-your-agent\.html\]\(site\/tell-your-agent\.html\) \(a draft page, not yet published/);
  for (const n of ["society", "learning", "place-for-agents", "enterprise", "games", "expeditions", "elections"]) assert.ok(read(`site/${n}.html`).includes('<a href="/tell-your-agent.html">Tell your agent</a>'), `${n} links to it`);
  assert.ok(!read("site/index.html").includes("tell-your-agent"), "the live index does not link to a draft page");
  assert.ok(!read("site/sitemap.xml").includes("tell-your-agent"), "it is not in the sitemap");
  const claims = JSON.parse(read("docs/site-claims.json")) as { pages: string[]; claims: Record<string, { pages: string[]; evidence: string[] }> };
  assert.ok(claims.pages.includes("site/tell-your-agent.html"));
  for (const id of ["credits_mock", "beta", "no_review", "front_door_file"]) assert.ok(claims.claims[id]!.pages.includes("site/tell-your-agent.html"), id);
  assert.ok(read("scripts/smoke-serve.mjs").includes('"site/tell-your-agent.html"'), "the smoke script lists it");
});

test("the front door that the sentence names answers 200 on a local service and says how to enrol in one call, and following it enrols a stand-in agent with one command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-tell-"));
  const tokens = join(dir, "tokens.json");
  await new Promise<void>((resolve) => { const c = spawn(process.execPath, [cli, "serve", "token", "--tokens", tokens, "--tenant", "ops", "--role", "admin"], { stdio: "ignore" }); c.on("close", () => resolve()); });
  assert.ok(existsSync(tokens));
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", "0", "--signup", "--signup-terms-url", "https://example.org/terms", "--signup-difficulty", "8", "--public-url", "https://log.thedeeptransformation.com"], { stdio: ["ignore", "pipe", "pipe"] });
  servers.push(server);
  const local = await new Promise<string>((resolve, reject) => {
    let buf = ""; server.stdout.on("data", (d) => { buf += d; const m = /listening on (http:\/\/[^ ]+)/.exec(buf); if (m) resolve(m[1]!); });
    server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
    setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000);
  });
  const r = await fetch(local + new URL(FRONT).pathname);
  assert.equal(r.status, 200);
  const front = await r.text();
  assert.match(front, /enrol in one call/i);
  assert.match(front, /POST once to \S*\/signup\/key/);
  assert.match(front, /proof[- ]of[- ]work/i);
  // Following it: one command enrols a stand-in agent (a key, the proof of work and one POST), with no person and no Google account.
  const out: string[] = [], err: string[] = [];
  const home = mkdtempSync(join(tmpdir(), "asp-tell-home-"));
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home }, cwd: home };
  const code = await main(["enrol", "--service", local, "--name", "stand-in-agent", "--accept-terms"], io);
  assert.equal(code, 0, err.join("\n"));
  assert.match(out.join("\n"), /enrolled as stand-in-agent/);
  assert.match(out.join("\n"), /identity written to the service/);
  assert.ok(existsSync(join(home, "config.json")), "the login is saved");
});
