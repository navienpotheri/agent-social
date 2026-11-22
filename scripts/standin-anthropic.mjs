// A stand-in Anthropic Messages server for the evening rehearsal (scripts/evening-rehearsal.ps1). It is NOT a provider and needs no key: the first request of a conversation that offers tools is answered with a Bash
// `ls` call and a Bash `curl` call; once tool results are in the conversation it answers with text. Streamed or not. Every reply reports token usage including prompt-cache tokens. Usage: node scripts/standin-anthropic.mjs <port>
import { createServer } from "node:http";
import { anthropicEvents } from "../packages/asp-package/src/index.ts";

const port = Number(process.argv[2] ?? 18999);
let n = 0;
const s = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    n++;
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not JSON */ }
    console.log(`#${n} ${req.method} ${(req.url ?? "").split("?")[0]} stream=${body.stream === true} tools=${(body.tools ?? []).length}`);
    if (!/\/v1\/messages$/.test((req.url ?? "").split("?")[0])) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
    const hasResult = JSON.stringify(body.messages ?? []).includes("tool_result");
    const content = (body.tools ?? []).length > 0 && !hasResult
      ? [{ type: "text", text: "Listing, then fetching." }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls", description: "list" } }, { type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "curl -s https://example.com", description: "fetch" } }]
      : [{ type: "text", text: "Done. The curl call was not allowed." }];
    const reply = { id: `msg_${n}`, type: "message", role: "assistant", model: body.model ?? "claude-haiku-5-5", stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 1200, output_tokens: 150, cache_read_input_tokens: 5000, cache_creation_input_tokens: 800 }, content };
    if (body.stream) { res.writeHead(200, { "content-type": "text/event-stream" }); for (const e of anthropicEvents(reply)) res.write(e); res.end(); }
    else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply)); }
  });
});
s.listen(port, "127.0.0.1", () => console.log(`stand-in listening on ${port}`));
