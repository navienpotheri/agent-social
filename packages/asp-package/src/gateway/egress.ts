/**
 * The egress proxy (gap H13): an HTTP forward proxy in the gateway, so that an agent in a sandbox with no network of its own can still reach the hosts its Mandate
 * names, and only those, at the rate its Mandate allows. A sandbox whose Mandate names hosts used to get the host's whole network (only the model's tool calls were
 * limited); now its only way out is the gateway, which answers a CONNECT (HTTPS) or an absolute-URI request (HTTP) by checking the host, the rate and the address
 * the name resolves to, and then relaying the bytes. A tool that ignores the proxy settings has no route at all, so it fails closed.
 *
 * It sees the host and port of a tunnel, not what goes through it: an HTTPS connection counts as one request however many it carries, and a path-level rule is
 * out of reach (the check on the command text, gateway/requests.ts, still counts what a command asks for).
 */
import { lookup } from "node:dns/promises";
import { isIP, connect, type Socket } from "node:net";
import { request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

export interface EgressVerdict { ok: boolean; reason?: string; /** The address to connect to (already checked). */ address?: string }
/** Decides one connection or request to host:port. `address` is what the name resolved to. */
export type EgressCheck = (host: string, port: number, addresses: string[]) => EgressVerdict | Promise<EgressVerdict>;

/** Loopback, private, link-local (including the cloud metadata address), carrier-grade NAT and unspecified addresses, IPv4 and IPv6. */
export function privateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(v) === 6) return v === "::" || v === "::1" || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("ff");
  return false;
}

async function resolve(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  const all = await lookup(host, { all: true });
  return all.map((a) => a.address);
}

const HOP = new Set(["proxy-connection", "proxy-authorization", "connection", "keep-alive", "te", "trailer", "upgrade", "transfer-encoding"]);

/** Makes `server` answer proxy requests: CONNECT tunnels and absolute-URI HTTP requests. `isProxy` says whether a plain request is a proxy request; `forward` answers it. */
export function attachEgress(server: Server, check: EgressCheck): { isProxy: (req: IncomingMessage) => boolean; forward: (req: IncomingMessage, res: ServerResponse) => Promise<void> } {
  const refuse = (reason: string) => `ASP egress: ${reason}`;
  const verdict = async (host: string, port: number): Promise<EgressVerdict> => {
    let addresses: string[];
    try { addresses = await resolve(host); } catch { return { ok: false, reason: refuse(`the host ${host} could not be resolved`) }; }
    if (!addresses.length) return { ok: false, reason: refuse(`the host ${host} has no address`) };
    const v = await check(host, port, addresses);
    return v.ok ? { ok: true, address: v.address ?? addresses[0] } : { ok: false, reason: v.reason?.startsWith("ASP egress") ? v.reason : refuse(v.reason ?? "refused") };
  };

  server.on("connect", async (req: IncomingMessage, client: Duplex, head: Buffer) => {
    const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(req.url ?? "");
    if (!m) { client.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
    const host = m[1].replace(/^\[|\]$/g, "").toLowerCase(), port = Number(m[2]);
    const v = await verdict(host, port);
    if (!v.ok) { client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(v.reason!)}\r\n\r\n${v.reason}`); return; }
    const upstream: Socket = connect(port, v.address!, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    const close = () => { upstream.destroy(); client.destroy(); };
    upstream.on("error", () => { if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); close(); });
    client.on("error", close); client.on("close", close);
  });

  const isProxy = (req: IncomingMessage) => /^https?:\/\//i.test(req.url ?? "");
  const forward = async (req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try { url = new URL(req.url!); } catch { res.writeHead(400); res.end(); return; }
    if (url.protocol !== "http:") { res.writeHead(400); res.end(refuse("only http:// is forwarded; HTTPS goes through CONNECT")); return; }
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase(), port = Number(url.port || 80);
    const v = await verdict(host, port);
    if (!v.ok) { res.writeHead(403, { "content-type": "text/plain" }); res.end(v.reason); return; }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HOP.has(k)));
    const up = httpRequest({ host: v.address, port, method: req.method, path: url.pathname + url.search, headers: { ...headers, host: url.host } }, (r) => {
      res.writeHead(r.statusCode ?? 502, Object.fromEntries(Object.entries(r.headers).filter(([k]) => !HOP.has(k))) as Record<string, string>);
      r.pipe(res);
    });
    up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  };
  return { isProxy, forward };
}
