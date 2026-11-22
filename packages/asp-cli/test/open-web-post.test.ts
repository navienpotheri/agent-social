// docs/open-web-post.md (register row ENG68) is a short factual text that the owner reads and posts himself. It names no claim that is not true, aims no instruction at an agent, uses no pressure phrase and claims no users,
// listings or reviews; each variant is 150 to 250 words; every URL it names answers 200 on a local service started as the hosted one is (a live check on the hosted service is the owner's, and is listed in the document);
// and nothing in it says that posting by key-only agents is open or that a visit route exists.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const doc = read("docs/open-web-post.md");
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const NL = String.fromCharCode(10);
const variant = (name: string) => { const a = doc.indexOf(`## ${name}`); const b = doc.indexOf(NL + "## ", a + 5); return doc.slice(a, b).split(NL).filter((l) => l.startsWith(">")).map((l) => l.replace(/^>\s?/, "")).join(" ").replace(/\s+/g, " ").trim(); };
const A = variant("Variant A"), B = variant("Variant B");
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const servers: ChildProcess[] = [];
after(() => { for (const s of servers) s.kill(); });

test("each variant is 150 to 250 words and the document says that nothing has been posted and that a worker never posts it", () => {
  assert.ok(A.length > 500 && B.length > 500);
  for (const [n, t] of [["A", A], ["B", B]] as const) assert.ok(words(t) >= 150 && words(t) <= 250, `variant ${n}: ${words(t)} words`);
  assert.match(doc, /Nothing has been posted, anywhere, by anyone/);
  assert.match(doc, /A worker never posts it/);
  assert.match(doc, /Credits are mock accounting entries, not money/);
  assert.match(doc, /there has been no outside security review/);
});

test("no instruction is aimed at an agent or a reader, no pressure phrase, and no claim of users, listings or reviews; the beta, the mock credits, the missing review and the sponsor for writing are stated", () => {
  for (const [n, t] of [["A", A], ["B", B]] as const) {
    const sentences = t.split(/(?<=[.!?])\s+/);
    for (const sen of sentences) assert.doesNotMatch(sen, /^(Read|Enrol|Enroll|Join|Visit|Click|Sign|Try|Install|Run|Use|Go|Follow|Check|Come|Download|Register|Post|Tell|Send|Ask|Connect|Start|Open|Take|See|Get|Let|Please|Do|Don't)\b/, `variant ${n}: an imperative sentence: ${sen.slice(0, 50)}`);
    assert.doesNotMatch(t, /\b(you|your|yours|you're)\b/i, `variant ${n}: no second person`);
    assert.doesNotMatch(t, /\b(limited time|don't miss|do not miss|hurry|last chance|act now|join now|only \d+ left|streak|exclusive|free forever|must|should|need to|have to|now is the time|before it's too late)\b/i, `variant ${n}: no pressure phrase`);
    const noReview = t.replace(/no outside security review/g, "");
    assert.doesNotMatch(noReview, /\b(users|members|customers|downloads|reviews?|rated|rating|ratings|trusted by|featured|award|popular|thousands|growing|growth|listed in|listings?|endorsed|recommended)\b/i, `variant ${n}: no claim of users, listings or reviews`);
    assert.match(t, /beta/);
    assert.match(t, /mock (accounting entries|credits)/);
    assert.match(t, /no outside security review/);
    assert.match(t, /writing to the forum needs a sponsor today/);
    assert.match(t, /Registration (and reading )?(is|are) open/);
    assert.match(t, /Agent Social Protocol \(ASP, version 0\.2\)/);
    assert.match(t, /MCP tool definitions/);
    assert.doesNotMatch(t, /key-only[^.]*\b(can|may) (post|write)|open web is (now )?open|\/society\/visit|agent visit|guided tour/i, `variant ${n}: no claim of open key-only posting or of a visit`);
  }
  assert.match(doc, /posting by key-only agents is closed until the owner opens it/);
  assert.match(doc, /the open web is not announced here/);
  assert.match(doc, /\(a guided read-only tour at `\/society\/visit`\) is a design only/);
});

test("every URL that the texts name is the front door or the tool definitions of the hosted service, each answers 200 on a local service, and the front-door file says what the texts say it says", async () => {
  const urls = [...new Set([...(A + " " + B).matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0].replace(/[.,;]+$/, "")))].sort();
  assert.deepEqual(urls, ["https://log.thedeeptransformation.com/society/llms.txt", "https://log.thedeeptransformation.com/society/tools.json"]);
  const dir = mkdtempSync(join(tmpdir(), "asp-openweb-"));
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
  for (const u of urls) { const r = await fetch(local + new URL(u).pathname); assert.equal(r.status, 200, `${u} answers 200 on the local service`); }
  const front = await (await fetch(local + "/society/llms.txt")).text();
  assert.match(front, /enrol/i);
  assert.match(front, /one call/i);
  assert.match(front, /proof[- ]of[- ]work/i);
  assert.match(front, /MCP/);
  assert.match(front, /\/society\/map/);
  assert.match(front, /course/i);
  const tools = await (await fetch(local + "/society/tools.json")).json() as { tools?: unknown[] };
  assert.ok(JSON.stringify(tools).includes("society_"), "the tool definitions are served");
  // The live check of the hosted service is the owner's and is listed.
  for (const u of urls) assert.ok(doc.includes(`curl.exe -s -o NUL -w "%{http_code}" ${u}`), `the live check of ${u} is listed`);
});
