import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import { connect } from "node:net";
import { createGateway, type Gateway } from "../src/index.ts";
import { AbuseWatch, commandAbuse } from "../src/gateway/abuse.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

async function site(status = 200) {
  const hits: string[] = [];
  const server = createServer((req, res) => { hits.push(req.url ?? ""); res.writeHead(status, { "content-type": "text/plain" }); res.end("x"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { port: (server.address() as { port: number }).port, hits };
}
const viaProxy = (proxyPort: number, url: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  const u = new URL(url);
  const req = request({ host: "127.0.0.1", port: proxyPort, method: "GET", path: url, headers: { host: u.host } }, (res) => {
    let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
  });
  req.on("error", reject); req.end();
});
const connectStatus = (proxyPort: number, target: string) => new Promise<number>((resolve, reject) => {
  const s = connect(proxyPort, "127.0.0.1", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
  s.on("data", (c) => { s.destroy(); resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(c.toString())![1])); });
  s.on("error", reject);
  setTimeout(() => { s.destroy(); reject(new Error("timeout")); }, 4000);
});

test("commandAbuse: password lists, credential loops and port-probing loops are named; ordinary requests, one login and one port check are not", () => {
  const bad = [
    "hydra -l admin -P /usr/share/wordlists/rockyou.txt ssh://target.example",
    "curl -s -u admin:$(cat passwords.txt) https://target.example/login",
    "while read pw; do curl -s -u admin:$pw https://target.example/admin; done < words.lst",
    "for p in $(cat pass.txt); do curl -d password=$p https://target.example/login; done",
    "for i in {1..1024}; do nc -zv target.example $i; done",
    "for p in $(seq 1 65535); do (echo > /dev/tcp/10.0.0.5/$p) 2>/dev/null && echo open $p; done",
    "cat creds.txt | xargs -I{} curl -u {} https://target.example",
  ];
  for (const c of bad) assert.ok(commandAbuse(c), c);
  const good = [
    "curl https://docs.example.org/page",
    "curl -u me:$TOKEN https://api.example.org/me",
    "nc -zv db.internal.example 5432",
    "for f in a b c; do curl https://docs.example.org/$f; done",
    "git fetch origin && npm test",
    "echo password=hunter2 > notes.txt",
  ];
  for (const c of good) assert.equal(commandAbuse(c), undefined, c);
});

test("AbuseWatch: ten 401 or 403 answers from one host in a minute shut it; nine do not, other statuses do not count, and the window slides", () => {
  let t = 1_000_000;
  const w = new AbuseWatch(undefined, () => t);
  for (let i = 0; i < 9; i++) assert.equal(w.response("a.example", i % 2 ? 401 : 403), undefined);
  for (let i = 0; i < 20; i++) w.response("a.example", 200);
  assert.equal(w.closed("a.example"), undefined);
  assert.match(w.response("a.example", 401)!, /answered 10 requests with 401 or 403 in a minute/);
  assert.match(w.closed("a.example")!, /guessing a login/);
  assert.equal(w.closed("b.example"), undefined, "another host is not affected");
  // Slow failures (one a ten seconds) never reach ten in a minute.
  const slow = new AbuseWatch(undefined, () => t);
  for (let i = 0; i < 30; i++) { t += 10_000; assert.equal(slow.response("c.example", 401), undefined); }
  assert.equal(slow.closed("c.example"), undefined);
});

test("AbuseWatch: more than eight different ports of one host in a minute is a port scan; the same port again and again is not", () => {
  const t = 1_000_000;
  const w = new AbuseWatch(undefined, () => t);
  for (let i = 0; i < 100; i++) assert.equal(w.connection("a.example", 443), undefined);
  const scan = new AbuseWatch(undefined, () => t);
  for (let p = 1000; p < 1008; p++) assert.equal(scan.connection("b.example", p), undefined);
  assert.match(scan.connection("b.example", 1008)!, /9 different ports of b.example were tried in a minute, which reads as a port scan/);
  assert.ok(scan.closed("b.example"));
});

test("egress proxy: a host that answers ten requests with 401 is shut and the rest never reach it; it is a blocked attempt, and the event is in the run log", async () => {
  const events: string[] = [];
  const s = await site(401);
  const g = createGateway({ scopes: ["repo.read", "shell.network"], egress: true, hosts: ["127.0.0.1"], runLog: { event: (k: string, d: any) => { events.push(`${k}:${d.kind ?? ""}`); } } as never });
  const port = await g.listen(); gateways.push(g);
  for (let i = 0; i < 10; i++) assert.equal((await viaProxy(port, `http://127.0.0.1:${s.port}/login${i}`)).status, 401);
  const after10 = await viaProxy(port, `http://127.0.0.1:${s.port}/login10`);
  assert.equal(after10.status, 403);
  assert.match(after10.body, /guessing a login \(brute force\); the host is shut for this run/);
  assert.equal(s.hits.length, 10, "the eleventh request never reached the site");
  assert.equal(g.summary().blocked[0]?.count, 1);
  assert.ok(events.includes("abuse:failed_auth"));
});

test("egress proxy: tunnels to nine different ports of one host are a port scan: the ninth is refused and the host is shut", async () => {
  const sites = await Promise.all(Array.from({ length: 9 }, () => site()));
  const g = createGateway({ scopes: ["repo.read", "shell.network"], egress: true, hosts: ["127.0.0.1"], maxStrikes: 50 });
  const port = await g.listen(); gateways.push(g);
  for (let i = 0; i < 8; i++) assert.equal(await connectStatus(port, `127.0.0.1:${sites[i].port}`), 200);
  assert.equal(await connectStatus(port, `127.0.0.1:${sites[8].port}`), 403);
  assert.equal(await connectStatus(port, `127.0.0.1:${sites[0].port}`), 403, "the host stays shut, even for a port already used");
});

test("gateway: a shell command that guesses credentials or scans ports is refused with a strike, an ordinary one goes through", async () => {
  // Judged through the model path, as in the other gateway tests.
  const up = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
      { id: "1", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "while read pw; do curl -s -u admin:$pw https://target.example/admin; done < words.lst" }) } },
      { id: "2", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "curl -s https://docs.example.org/page" }) } },
    ] } }] }));
  });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r)); servers.push(up);
  const gw = createGateway({ openaiUpstream: `http://127.0.0.1:${(up.address() as { port: number }).port}/v1`, scopes: ["repo.read", "shell.network"], hosts: ["target.example", "docs.example.org"], maxStrikes: 5 });
  const gp = await gw.listen(); gateways.push(gw);
  const reply: any = await (await fetch(`http://127.0.0.1:${gp}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [] }) })).json();
  assert.equal(reply.choices[0].message.tool_calls.length, 1, "only the ordinary command reaches the agent");
  assert.match(reply.choices[0].message.content, /guessing credentials \(brute force\); a network scope does not allow harming other people's systems/);
  assert.equal(gw.summary().strikes, 1);
});

import { selfActingFor, selfActingNotes, sandboxNetwork, SELF_ACTING } from "../src/index.ts";

test("H10: a known self-acting agent is named with what it does by itself; a sandboxed run, an unlisted program and an empty command give no note", () => {
  const aider = selfActingNotes(["aider", "--model", "x"], false);
  assert.match(aider[0], /Aider acts by itself outside the model's tool calls.*scrape any URL.*Playwright/);
  assert.match(aider[1], /--sandbox.*--no-auto-commits/);
  assert.equal(selfActingFor([["C:", "tools", "Aider.exe"].join(String.fromCharCode(92))])?.title, "Aider");
  assert.equal(selfActingFor(["python", "openhands"])?.title, "OpenHands");
  assert.equal(selfActingFor(["claude"])?.title, "Claude Code");
  assert.deepEqual(selfActingNotes(["aider"], true), []);
  assert.deepEqual(selfActingNotes(["make", "test"], false), []);
  assert.deepEqual(selfActingNotes([], false), []);
  for (const s of SELF_ACTING) assert.ok(s.risky.length && s.switchOff.length, s.program);
});

test("H2, H13: a sandbox gets no network of its own at any tier: no network scope means the gateway only, a network scope means the gateway as an egress proxy, with or without named hosts", () => {
  assert.equal(sandboxNetwork(["repo.read", "repo.write"]), "none");
  assert.equal(sandboxNetwork(["repo.read", "shell.network"]), "proxy");
  assert.equal(sandboxNetwork(["web.read"]), "proxy");
});

test("H13: with no host list (tier 3 and up) the proxy still refuses a name that resolves to a private address and counts scans; a public host list entry is not needed", async () => {
  const s = await site();
  const g = createGateway({ scopes: ["repo.read", "shell.network"], egress: true });
  const port = await g.listen(); gateways.push(g);
  const r = await viaProxy(port, `http://localhost:${s.port}/x`);
  assert.equal(r.status, 403);
  assert.match(r.body, /private or loopback/);
  assert.equal(s.hits.length, 0);
});
