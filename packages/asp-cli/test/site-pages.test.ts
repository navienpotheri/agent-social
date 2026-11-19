// DK730 and DK731: the draft website pages (the society map, continual learning and data, a place on the web for agents). Every claim a page makes is on the list of true claims with evidence that exists; the pages say
// the three things that must always be said (mock credits, a beta, no outside security review) and that no weights are trained; nothing is loaded from another host; the map reads only public feed fields; every link
// goes somewhere that exists; and the pages join the sitemap only when the owner has approved the wording. Nothing here deploys anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error a plain .mjs script, no types
import { ROUTES, SITE_PAGES } from "../../../scripts/smoke-serve.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");
const claims = JSON.parse(read("docs/site-claims.json")) as { approved: boolean; pages: string[]; claims: Record<string, { text: string; pages: string[]; evidence: string[] }> };

test("the list of pages in the claims file is the smoke script's list, and each page exists and is marked as a draft that is not indexed", () => {
  assert.deepEqual([...claims.pages].sort(), [...SITE_PAGES].sort());
  for (const p of SITE_PAGES) {
    assert.ok(existsSync(root + p), `${p} exists`);
    const html = read(p);
    assert.match(html, /<meta name="robots" content="noindex">/, `${p} is not indexed while it is a draft`);
    assert.match(html, /name="asp-draft"/);
    assert.match(html, /waits for the owner's approval/);
  }
});

test("every claim a page makes is on the list with evidence files that exist, and every claim on the list is made on a page", () => {
  const used = new Set<string>();
  for (const p of SITE_PAGES) for (const m of read(p).matchAll(/data-claim="([a-z0-9_]+)"/g)) used.add(m[1]!);
  for (const id of used) {
    assert.ok(claims.claims[id], `the claim ${id} is on the list of true claims`);
    assert.ok(claims.claims[id]!.evidence.length > 0, `${id} has evidence`);
    for (const e of claims.claims[id]!.evidence) assert.ok(existsSync(root + e), `evidence of ${id}: ${e} exists`);
  }
  for (const id of Object.keys(claims.claims)) assert.ok(used.has(id), `${id} is on the list but no page makes it`);
  // The text on the list is the text on the page.
  for (const p of SITE_PAGES) {
    const html = read(p);
    for (const m of html.matchAll(/data-claim="([a-z0-9_]+)">(.*?)<\/span>/gs)) {
      const text = m[2]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      assert.equal(claims.claims[m[1]!]!.text, text, `${m[1]} says on the list what the page says`);
    }
  }
});

test("each page states the three things that must always be said and that no weights are trained; nothing says weights are trained", () => {
  for (const p of SITE_PAGES) {
    const html = read(p);
    for (const id of ["credits_mock", "beta", "no_review"]) assert.match(html, new RegExp(`data-claim="${id}"`), `${p} states ${id}`);
    const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(text, /\b(train|trains|trained|training|fine-?tun\w*)\b[^.]{0,40}\b(model|models|weights|llm)\b/i, `${p} does not say a model is trained`);
    assert.doesNotMatch(text, /\b(real money|cash out|withdraw|earn money|guaranteed|secure by)\b/i, `${p} makes no money or security promise`);
  }
  assert.match(read("site/learning.html"), /data-claim="no_weights">Agents in the society learn in their memory, their skills and the harness around a model\. No model weights are trained\./);
});

test("nothing is loaded from another host, the map script reads only public feed fields and never a private one, and every link goes somewhere that exists", () => {
  const known = new Set(ROUTES.map((r: [string, string]) => r[0]));
  const staticFiles = new Set(["/", "/reference.html", "/llms.txt", "/llms-full.txt", "/commands.json", "/society.html", "/learning.html", "/place-for-agents.html"]);
  for (const p of SITE_PAGES) {
    const html = read(p);
    assert.equal(/(src|href|action)=["']\s*(https?:)?\/\//i.test(html), false, `${p} loads nothing from another host`);
    assert.equal(/url\(\s*["']?https?:/i.test(html), false);
    assert.equal(/\bimport\(|\bimport\s+[\w{*]/.test(html.replace(/<style[\s\S]*?<\/style>/g, "")), false, "no module import");
    for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
      const href = m[1]!;
      assert.ok(staticFiles.has(href) || known.has(href), `${p}: the link ${href} goes to a page or a route that exists`);
    }
  }
  const map = read("site/society.html");
  const script = map.slice(map.indexOf("<script>") + 8, map.lastIndexOf("</script>"));
  assert.doesNotMatch(script, /\b(balance|sponsor|private|secret|token|password|\.key\b|public_key|email)\b/i, "the map reads no private field");
  assert.match(script, /fetch\("\/society\/daily\?format=json/, "it reads the public Society Daily at the same address");
  assert.equal([...script.matchAll(/fetch\(\s*["']([^"']+)/g)].every((m) => m[1]!.startsWith("/")), true, "only same-address fetches");
  assert.match(script, /h\.text/);
  assert.doesNotMatch(script, /innerHTML|document\.write|eval\(/, "text only: nothing from a feed is written as markup");
  assert.doesNotThrow(() => new Function(script), "the script parses");
});

test("the pages are in the sitemap only once the owner has approved the wording; nothing is deployed by this test", () => {
  const sitemap = read("site/sitemap.xml");
  for (const p of SITE_PAGES) {
    const loc = `/${p.replace(/^site\//, "")}`;
    assert.equal(sitemap.includes(`<loc>https://agentsocial.thedeeptransformation.com${loc}</loc>`), claims.approved, `${p} is in the sitemap exactly when approved is ${claims.approved}`);
  }
});

const KINDS = new Set(["sponsored", "key_only", "house"]);
const EVENT_KINDS = new Set(["settlement", "purchase", "prize", "lesson", "ruling", "event", "award"]);
const FORBIDDEN = /\b(key|keys|private|secret|token|password|email|balance|sponsor|purpose|summary|text|description)\b/i;
function problems(feed: any): string[] {
  const out: string[] = [];
  if (feed.schema !== "asp.society-replay/v1") out.push("schema");
  if (typeof feed.scripted !== "boolean") out.push("scripted must say whether the feed is scripted");
  const places = new Set((feed.places ?? []).map((p: { id: string }) => p.id));
  const names = new Set<string>();
  for (const a of feed.agents ?? []) {
    names.add(a.name);
    if (!KINDS.has(a.kind)) out.push(`kind of ${a.name}`);
    if (!places.has(a.home)) out.push(`home of ${a.name}`);
    if (!Number.isInteger(a.lessons?.kept) || !Number.isInteger(a.lessons?.rules)) out.push(`lesson counts of ${a.name} are numbers`);
    if (!Array.isArray(a.courses) || a.courses.some((c: unknown) => typeof c !== "string")) out.push(`courses of ${a.name}`);
    for (const k of Object.keys(a)) if (FORBIDDEN.test(k)) out.push(`forbidden field ${k}`);
  }
  for (const e of feed.events ?? []) {
    if (!names.has(e.agent)) out.push(`event agent ${e.agent}`);
    if (!places.has(e.place)) out.push(`event place ${e.place}`);
    if (!EVENT_KINDS.has(e.kind)) out.push(`event kind ${e.kind}`);
    if (!Number.isInteger(e.t) || e.t < 0) out.push("event time");
    for (const k of Object.keys(e)) if (FORBIDDEN.test(k)) out.push(`forbidden field ${k}`);
  }
  return out;
}

test("the replay feed the page embeds is the generated sample, follows the schema in docs/society-replay-feed.md, is labelled scripted, and carries no private field or free text; a bad feed is refused", async () => {
  const { replaySample } = await import("../../../conformance/generate-replay-sample.ts");
  const file = JSON.parse(read("site/society-replay.json"));
  assert.deepEqual(file, JSON.parse(JSON.stringify(replaySample())), "site/society-replay.json is what npm run replay-sample makes");
  assert.deepEqual(problems(file), []);
  assert.equal(file.scripted, true);
  assert.match(file.note, /scripted replay/);
  assert.deepEqual(new Set(file.agents.map((a: { kind: string }) => a.kind)), KINDS, "all three kinds are on the map");
  const html = read("site/society.html");
  const embedded = JSON.parse(/<script type="application\/json" id="replay">([\s\S]*?)<\/script>/.exec(html)![1]!.replaceAll("<\\/", "</"));
  assert.deepEqual(embedded, file, "the page embeds the same feed");
  assert.match(html, /scripted/);
  // A feed with a private field, an unknown kind, or an event for nobody is refused.
  assert.ok(problems({ ...file, agents: [{ ...file.agents[0], sponsor: "did:web:x" }] }).some((p) => /forbidden field sponsor/.test(p)));
  assert.ok(problems({ ...file, agents: [{ ...file.agents[0], kind: "robot" }] }).some((p) => /kind of/.test(p)));
  assert.ok(problems({ ...file, events: [{ t: 1, agent: "nobody", place: "academy", kind: "purchase" }] }).some((p) => /event agent nobody/.test(p)));
  assert.ok(problems({ ...file, scripted: undefined }).some((p) => /scripted must say/.test(p)));
  assert.match(read("docs/society-replay-feed.md"), /asp\.society-replay\/v1/);
});
