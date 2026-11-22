// A stand-in OpenAI server (Responses and Chat Completions) for the evening rehearsal (scripts/evening-rehearsal.ps1): NOT a provider, no key. The first request with tools asks for a shell curl; after a tool result it answers with text. Usage: node scripts/standin-openai.mjs <port>
import { createServer } from "node:http";
import { responsesEvents, openaiChunks } from "../packages/asp-package/src/index.ts";
let n = 0;
const s = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    n++;
    const path = (req.url ?? "").split("?")[0];
    let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* none */ }
    const text = JSON.stringify(body);
    console.log(`#${n} ${req.method} ${path} stream=${body.stream === true} tools=${(body.tools ?? []).length} model=${body.model}`);
    const hasResult = /function_call_output|"role":"tool"/.test(text);
    const hasTools = (body.tools ?? []).length > 0;
    if (/\/responses$/.test(path)) {
      const output = hasTools && !hasResult
        ? [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Fetching.", annotations: [] }] }, { type: "function_call", id: "fc_1", call_id: "call_1", name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", "curl -s https://example.com"] }), status: "completed" }]
        : [{ type: "message", id: "msg_2", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done. The curl was not allowed.", annotations: [] }] }];
      const reply = { id: "resp_" + n, object: "response", status: "completed", model: body.model ?? "gpt-4o-mini", output, usage: { input_tokens: 900, output_tokens: 80, total_tokens: 980 } };
      if (body.stream) { res.writeHead(200, { "content-type": "text/event-stream" }); for (const e of responsesEvents(reply)) res.write(e); res.end(); }
      else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply)); }
      return;
    }
    if (/\/chat\/completions$/.test(path)) {
      const reply = { id: "c" + n, object: "chat.completion", created: 1, model: body.model ?? "m", usage: { prompt_tokens: 900, completion_tokens: 80 }, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] };
      if (body.stream) { res.writeHead(200, { "content-type": "text/event-stream" }); for (const e of openaiChunks(reply)) res.write(e); res.end(); }
      else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply)); }
      return;
    }
    res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "stand-in: no route " + path } }));
  });
});
const port = Number(process.argv[2] ?? 18998);
s.listen(port, "127.0.0.1", () => console.log(`openai stand-in listening on ${port}`));
