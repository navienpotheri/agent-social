// Row US1 (mutation check, launch-bar-2, 2026-11-22): a paused gateway that is not resumed within its limit refuses the held call with a status of 503 and the words "paused for longer than the limit", for an
// OpenAI-style and an Anthropic-style caller, never reaches the provider, and says so in the body so that the person is told to run `asp resume`. The older tests only resumed in time, so the limit and the
// refusal were never exercised. Fake provider; a temporary pause file.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGateway, type Gateway } from "../src/index.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

test("a paused gateway refuses the held call after its limit, in the caller's own error shape, and the provider is not reached", async () => {
  let reached = 0;
  const up = createServer(async (req, res) => { for await (const _ of req) { /* drain */ } reached++; res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r));
  servers.push(up);
  const base = `http://127.0.0.1:${(up.address() as { port: number }).port}`;
  const pauseFile = join(mkdtempSync(join(tmpdir(), "pause-")), "paused");
  writeFileSync(pauseFile, "paused");
  const g = createGateway({ openaiUpstream: `${base}/v1`, anthropicUpstream: base, scopes: ["repo.read"], pauseFile, maxPauseMs: 400 });
  const port = await g.listen();
  gateways.push(g);
  const url = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const t0 = Date.now();
  const openai = await post("/v1/chat/completions", { model: "m", messages: [{ role: "user", content: "hi" }] });
  const held = Date.now() - t0;
  assert.equal(openai.status, 503);
  const ob = await openai.json() as { error: { type: string; message: string } };
  assert.equal(ob.error.type, "asp_paused");
  assert.match(ob.error.message, /paused for longer than the limit.*asp resume/);
  assert.ok(held >= 350 && held < 5000, `the call was held for about the limit, not refused at once and not for ever (${held} ms)`);

  const anthropic = await post("/v1/messages", { model: "m", max_tokens: 5, messages: [{ role: "user", content: "hi" }] });
  assert.equal(anthropic.status, 503);
  const ab = await anthropic.json() as { type: string; error: { type: string; message: string } };
  assert.equal(ab.type, "error");
  assert.match(ab.error.message, /asp resume/);
  assert.equal(reached, 0, "the provider was not called while paused");
});
