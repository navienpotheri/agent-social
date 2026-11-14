/**
 * The weights digest of a model on a local runtime (register row DK96): the gateway asks an Ollama-style runtime behind an OpenAI-compatible route for the model's digest once per run and records it in the
 * Action's metrics as `sha256:...`; a runtime without the route leaves it out, and a remote provider is never asked. A changed digest opens the probation (packages/asp-log/test/action.test.ts, D4). Fake runtime only.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createGateway, type Gateway } from "../src/index.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

const chatReply = { id: "c1", object: "chat.completion", created: 1, model: "llama3:8b", usage: { prompt_tokens: 3, completion_tokens: 2 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hi" } }] };

/** A fake local runtime: chat completions, and /api/tags and /api/show when `digest` says so. */
async function runtime(opts: { tags?: () => unknown; show?: () => unknown }) {
  const asked: string[] = [];
  const server = createServer((req, res) => {
    asked.push(`${req.method} ${req.url}`);
    const send = (code: number, v: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    req.resume();
    req.on("end", () => {
      if (req.url === "/v1/chat/completions") return send(200, chatReply);
      if (req.url === "/api/tags" && opts.tags) return send(200, opts.tags());
      if (req.url === "/api/show" && opts.show) return send(200, opts.show());
      send(404, { error: "no such route" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, asked };
}
async function ask(upstream: string) {
  const g = createGateway({ openaiUpstream: `${upstream}/v1`, scopes: ["repo.read"], localDigest: true });
  const port = await g.listen(); gateways.push(g);
  const url = `http://127.0.0.1:${port}/v1/chat/completions`;
  const call = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "llama3:8b", messages: [] }) });
  return { g, call };
}
const settle = () => new Promise((r) => setTimeout(r, 150));
type Models = { name: string; provider?: string; digest?: string }[];

test("a local runtime's digest from /api/tags is in the Action's metrics as sha256:..., asked once for many calls", async () => {
  const rt = await runtime({ tags: () => ({ models: [{ name: "llama3:8b", model: "llama3:8b", digest: "a1b2c3d4e5f6" }] }) });
  const { g, call } = await ask(rt.url);
  await call(); await settle(); await call(); await call();
  const models = g.drain().metrics.models as Models;
  assert.equal(models.length, 1);
  assert.equal(models[0].digest, "sha256:a1b2c3d4e5f6");
  assert.equal(rt.asked.filter((a) => a === "GET /api/tags").length, 1, "asked once per run");
});

test("the digest is taken from /api/show when the model list does not carry it, and a changed digest on the next run is a different digest", async () => {
  let digest = "sha256:0001";
  const rt = await runtime({ tags: () => ({ models: [] }), show: () => ({ digest }) });
  const a = await ask(rt.url); await a.call(); await settle();
  assert.equal((a.g.drain().metrics.models as Models)[0].digest, "sha256:0001");
  digest = "sha256:0002"; // the same name now points to other weights
  const b = await ask(rt.url); await b.call(); await settle();
  assert.equal((b.g.drain().metrics.models as Models)[0].digest, "sha256:0002", "the next run records the new digest; the log opens a probation on the difference (D4)");
});

test("a loopback upstream on another port is not asked unless localDigest is set (a fake provider on a test port is left alone)", async () => {
  const rt = await runtime({ tags: () => ({ models: [{ name: "llama3:8b", digest: "abcd" }] }) });
  const g = createGateway({ openaiUpstream: `${rt.url}/v1`, scopes: ["repo.read"] });
  const port = await g.listen(); gateways.push(g);
  await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "llama3:8b", messages: [] }) });
  await settle();
  assert.deepEqual(rt.asked, ["POST /v1/chat/completions"]);
  assert.equal((g.drain().metrics.models as Models)[0].digest, undefined);
});

test("a runtime with no digest route leaves the digest out and nothing is refused", async () => {
  const rt = await runtime({});
  const { g, call } = await ask(rt.url);
  assert.equal((await call()).status, 200);
  await settle();
  assert.equal((g.drain().metrics.models as Models)[0].digest, undefined);
});
