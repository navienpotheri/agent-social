import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import { connect } from "node:net";
import { createGateway, type Gateway } from "../src/index.ts";
import { privateAddress } from "../src/gateway/egress.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

async function site() {
  const hits: string[] = [];
  const server = createServer((req, res) => { hits.push(req.url ?? ""); res.writeHead(200, { "content-type": "text/plain" }); res.end("hello from the site"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { port: (server.address() as { port: number }).port, hits };
}
async function gw(extra: Record<string, unknown>) {
  const g = createGateway({ scopes: ["repo.read", "shell.network"], egress: true, ...extra });
  const port = await g.listen();
  gateways.push(g);
  return { g, port };
}
/** Asks the gateway, used as an HTTP proxy, for an http:// URL. */
const viaProxy = (proxyPort: number, url: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  const u = new URL(url);
  const req = request({ host: "127.0.0.1", port: proxyPort, method: "GET", path: url, headers: { host: u.host } }, (res) => {
    let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
  });
  req.on("error", reject); req.end();
});
/** A CONNECT to host:port through the gateway; resolves with the status line and, when the tunnel opened, what the site answered to a plain GET sent through it. */
const connectVia = (proxyPort: number, target: string) => new Promise<{ status: number; tunnelled?: string }>((resolve, reject) => {
  const s = connect(proxyPort, "127.0.0.1", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
  let buf = ""; let opened = false;
  s.on("data", (c) => {
    buf += c.toString();
    if (!opened && buf.includes("\r\n\r\n")) {
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(buf)![1]);
      if (status !== 200) { s.destroy(); return resolve({ status }); }
      opened = true; buf = buf.slice(buf.indexOf("\r\n\r\n") + 4); s.write(`GET /through-tunnel HTTP/1.1\r\nHost: ${target}\r\nConnection: close\r\n\r\n`);
    } else if (opened && buf.includes("hello from the site")) { s.destroy(); resolve({ status: 200, tunnelled: buf }); }
  });
  s.on("error", reject);
  setTimeout(() => { s.destroy(); reject(new Error("timeout")); }, 4000);
});

test("privateAddress: loopback, private, link-local (the cloud metadata address), carrier-grade NAT and unique-local addresses are private; public ones are not", () => {
  for (const a of ["127.0.0.1", "10.1.2.3", "192.168.0.9", "172.16.0.1", "172.31.255.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) assert.equal(privateAddress(a), true, a);
  for (const a of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) assert.equal(privateAddress(a), false, a);
});

test("egress proxy: a listed host is reached over HTTP and through a CONNECT tunnel; the request counts toward the rate limit, which refuses with no strike", async () => {
  const s = await site();
  const { g, port } = await gw({ hosts: ["127.0.0.1"], rate: { per_host_per_minute: 3 } });
  const first = await viaProxy(port, `http://127.0.0.1:${s.port}/a`);
  assert.deepEqual([first.status, first.body], [200, "hello from the site"]);
  const tunnel = await connectVia(port, `127.0.0.1:${s.port}`);
  assert.equal(tunnel.status, 200);
  assert.match(tunnel.tunnelled!, /hello from the site/);
  assert.ok(s.hits.includes("/through-tunnel"));
  assert.equal((await viaProxy(port, `http://127.0.0.1:${s.port}/b`)).status, 200);
  const over = await viaProxy(port, `http://127.0.0.1:${s.port}/c`);
  assert.equal(over.status, 403);
  assert.match(over.body, /ASP egress: .*allows 3 a minute to any one host/);
  assert.equal(s.hits.length, 3, "the refused request never reached the site");
  const sum = g.summary();
  assert.equal(sum.strikes, 0, "a rate limit is not a strike");
  assert.equal(g.drain().metrics.rate_limited, 1);
});

test("egress proxy: a host the Mandate does not name is refused as a blocked attempt, and enough of them stop the run", async () => {
  const s = await site();
  const { g, port } = await gw({ hosts: ["docs.example.org"], maxStrikes: 2 });
  const r = await viaProxy(port, `http://127.0.0.1:${s.port}/x`);
  assert.equal(r.status, 403);
  assert.match(r.body, /the host 127\.0\.0\.1 is not one this job's Mandate allows/);
  assert.equal((await connectVia(port, `127.0.0.1:${s.port}`)).status, 403);
  assert.equal(s.hits.length, 0);
  assert.deepEqual(g.summary().blocked, [{ scope: "shell.network", count: 2 }]);
  assert.match(g.summary().stopped ?? "", /read as probing/);
});

test("egress proxy: a name that resolves to a private address is refused unless the Mandate lists that address (SSRF), and no network scope means no egress", async () => {
  const s = await site();
  // No host list (tier 3 and up): the loopback site is still not reachable by name.
  const open = await gw({});
  const viaName = await viaProxy(open.port, `http://localhost:${s.port}/x`);
  assert.equal(viaName.status, 403);
  assert.match(viaName.body, /resolves to a private or loopback address/);
  assert.equal(s.hits.length, 0);
  const none = await gw({ scopes: ["repo.read"], hosts: ["127.0.0.1"] });
  const r = await viaProxy(none.port, `http://127.0.0.1:${s.port}/x`);
  assert.equal(r.status, 403);
  assert.match(r.body, /grants no network scope/);
});

test("egress proxy off: an absolute-URI request is not treated as a proxy request", async () => {
  const g = createGateway({ scopes: ["repo.read", "shell.network"] });
  const port = await g.listen();
  gateways.push(g);
  const s = await site();
  const r = await viaProxy(port, `http://127.0.0.1:${s.port}/x`);
  assert.notEqual(r.body, "hello from the site");
  assert.equal(s.hits.length, 0);
});
