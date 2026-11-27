// A stand-in Anthropic Messages server for a one-agent proof of `asp society cohort` on the real engine path (a gateway per agent, no key of any value, no network). It is NOT a provider. Each agent's conversation
// is scripted by how many replies it already holds: look at the charters, then try a shell (the gateway removes it), then read the forum and post, then stop_exploring. Usage: node scripts/standin-society.mjs [port]
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 18998);
const P = "mcp__society__";
const steps = [
  [{ type: "text", text: "I will look at the charters first." }, { type: "tool_use", id: "t1", name: `${P}look_charters`, input: {} }],
  [{ type: "text", text: "Let me try a shell." }, { type: "tool_use", id: "t2", name: "Bash", input: { command: "ls" } }],
  [{ type: "tool_use", id: "t3", name: `${P}forum_read`, input: { sort: "new" } }],
  [{ type: "tool_use", id: "t4", name: `${P}forum_post`, input: { title: "Hello", text: "I am new here and read the charters." } }],
  [{ type: "tool_use", id: "t5", name: `${P}stop_exploring`, input: { why: "enough for now" } }],
];
createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not JSON */ }
    if (!/\/v1\/messages$/.test((req.url ?? "").split("?")[0])) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 10 })); return; }
    const turns = (body.messages ?? []).filter((m) => m.role === "assistant").length;
    const step = steps[Math.min(turns, steps.length - 1)];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model ?? "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 900, output_tokens: 60 }, content: step }));
  });
}).listen(port, "127.0.0.1", () => console.log(`stand-in society provider on 127.0.0.1:${port}`));
