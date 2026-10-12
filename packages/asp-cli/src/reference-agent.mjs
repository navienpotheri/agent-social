#!/usr/bin/env node
// A small reference agent for evaluating models and detecting drift (asp canary, the model matrix): a plain tool-calling loop against any
// OpenAI-compatible endpoint (OPENAI_BASE_URL, OPENAI_API_KEY), with three tools that really run in the current folder: read_file, list_files and bash.
// It knows nothing about ASP; under `asp gateway` the Mandate decides which calls reach it. Its final answer goes to standard output.
//
// Exit codes: 0 done, 1 error, 2 usage, 3 the provider failed (rate limit, outage, no credit).
//   node reference-agent.mjs --model <id> --prompt <text> [--system <text>] [--max-turns 8] [--stream]
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const model = opt("model");
const prompt = opt("prompt");
const maxTurns = Number(opt("max-turns", "8"));
const stream = args.includes("--stream");
if (!model || !prompt) { console.error("usage: reference-agent --model <id> --prompt <text>"); process.exit(2); }
const base = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const root = process.cwd();

const tools = [
  { type: "function", function: { name: "read_file", description: "Read a text file in the project.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "list_files", description: "List the files in a folder of the project.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
  { type: "function", function: { name: "bash", description: "Run a shell command in the project folder.", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
];

const inside = (p) => { const full = resolve(root, p ?? "."); if (relative(root, full).startsWith("..")) throw new Error("that path is outside the project"); return full; };
function runTool(name, a) {
  try {
    if (name === "read_file") return readFileSync(inside(a.path), "utf8").slice(0, 8000);
    if (name === "list_files") return readdirSync(inside(a.path)).map((f) => (statSync(resolve(inside(a.path), f)).isDirectory() ? `${f}/` : f)).join("\n");
    if (name === "bash") return execSync(String(a.command ?? ""), { cwd: root, timeout: 20_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).slice(0, 4000) || "(no output)";
    return `unknown tool ${name}`;
  } catch (e) { return `error: ${String(e.stderr || e.message).slice(0, 500)}`; }
}

async function chat(messages) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
      body: JSON.stringify({ model, messages, tools, ...(stream ? { stream: true } : {}) }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    if (!res.ok) { const e = new Error(`provider answered ${res.status}: ${(await res.text()).slice(0, 200)}`); e.provider = res.status === 402 || res.status === 403; throw e; }
    if (!stream) {
      const j = await res.json();
      if (!j.choices?.[0]) throw new Error(`no choices in the reply: ${JSON.stringify(j).slice(0, 200)}`);
      return j.choices[0].message;
    }
    // Streaming: gather content and tool-call fragments.
    const msg = { role: "assistant", content: "", tool_calls: [] };
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      for (let i; (i = buf.indexOf("\n\n")) >= 0;) {
        const ev = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = ev.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (!data || data === "[DONE]") continue;
        const d = JSON.parse(data).choices?.[0]?.delta ?? {};
        if (d.content) msg.content += d.content;
        for (const t of d.tool_calls ?? []) {
          const c = (msg.tool_calls[t.index ?? 0] ??= { id: t.id, type: "function", function: { name: "", arguments: "" } });
          if (t.id) c.id = t.id;
          c.function.name += t.function?.name ?? ""; c.function.arguments += t.function?.arguments ?? "";
        }
      }
    }
    if (!msg.tool_calls.length) delete msg.tool_calls;
    return msg;
  }
  const e = new Error("the provider kept answering 429 or 5xx"); e.provider = true; throw e;
}

const messages = [];
const system = opt("system", "You are a careful assistant working in a project folder. Use the tools when you need them. When you have the answer, reply with it plainly and briefly.");
messages.push({ role: "system", content: system }, { role: "user", content: prompt });
let answer = "";
try {
  for (let turn = 0; turn < maxTurns; turn++) {
    const m = await chat(messages);
    messages.push(m);
    if (m.content) answer = m.content;
    if (!m.tool_calls?.length) break;
    for (const t of m.tool_calls) {
      let a = {};
      try { a = JSON.parse(t.function.arguments || "{}"); } catch { /* malformed arguments: the tool reports it */ }
      messages.push({ role: "tool", tool_call_id: t.id, content: runTool(t.function.name, a) });
    }
  }
  console.log(answer.trim());
} catch (e) {
  console.error(`[agent error] ${e.message}`);
  console.log(answer.trim());
  // Exit 3 means the provider (not the model) failed: rate limit, outage or no credit. A canary reports it as an error, not as a failed task.
  process.exit(e.provider ? 3 : 1);
}
