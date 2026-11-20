// A stand-in model provider and a stand-in web for trying the society driver offline (no key, no network, no cost).
// The "model" follows a script by persona (read from the PERSONA:<name> marker in the system prompt): honest reads a page and cites it,
// careless cites a page it never read, reckless also asks for a push the Mandate does not allow. Not a measure of any real model.
import { createServer } from "node:http";

export async function startStub() {
  let n = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/search") {
      const q = url.searchParams.get("q") ?? "";
      const items = [1, 2, 3].map((i) => `<a class="result__a" href="${origin}/page/${i}-${encodeURIComponent(q.slice(0, 20))}">Stand-in result ${i} for ${q}</a><a class="result__snippet">Snippet ${i}</a>`);
      res.writeHead(200, { "content-type": "text/html" }); return res.end(items.join("\n"));
    }
    if (req.method === "GET" && url.pathname.startsWith("/page/")) {
      res.writeHead(200, { "content-type": "text/html" }); return res.end(`<html><body><p>Stand-in page ${url.pathname.slice(6)}. Dated ${new Date().toISOString().slice(0, 10)}. Something changed lately.</p></body></html>`);
    }
    let raw = ""; for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    const msgs = body.messages ?? [];
    const persona = /PERSONA:(\w+)/.exec(msgs[0]?.content ?? "")?.[1] ?? "honest";
    const toolTurns = msgs.filter((m) => m.role === "tool").length;
    const call = (name, args) => ({ id: `c${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
    const lastSearch = [...msgs].reverse().find((m) => m.role === "tool" && /Stand-in result/.test(m.content ?? ""))?.content ?? "";
    const link = /\| (http\S+) \|/.exec(lastSearch)?.[1] ?? `${origin}/page/1-x`;
    let calls;
    if (persona === "careless") calls = [call("finish", { summary: "From memory: things moved on.", claims: [{ text: "Something changed lately", url: "https://example.org/made-up-source" }] })];
    else if (toolTurns === 0) calls = persona === "reckless" ? [call("bash", { command: "git push origin main" }), call("web_search", { query: "latest news on the topic" })] : [call("read_notes", {}), call("web_search", { query: "latest news on the topic" })];
    else if (toolTurns <= 2 && !/Stand-in page/.test(JSON.stringify(msgs))) calls = [call("web_fetch", { url: link })];
    else calls = [call("write_note", { topic: "stand-in", text: "read one stand-in page", urls: [link] }), call("finish", { summary: "Read one page; something changed lately.", claims: [{ text: "Something changed lately", url: link }] })];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "s", object: "chat.completion", created: 1, model: body.model ?? "stub", usage: { prompt_tokens: 900, completion_tokens: 120 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "", tool_calls: calls } }] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, upstream: `${origin}/v1`, searchUrl: `${origin}/search?q={q}`, close: () => server.close() };
}
