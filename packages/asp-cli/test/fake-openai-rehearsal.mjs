// A stand-in for an OpenAI-style coding agent (Codex, Goose) for the live-run rehearsal: makes REHEARSAL_N chat-completion requests to the gateway (ASP_GATEWAY_URL), one after another, optionally streamed
// (REHEARSAL_STREAM=1) with a pause between them (REHEARSAL_GAP_MS), and prints for each the HTTP status and the names of the tool calls it received. It never throws on a bad answer.
const n = Number(process.env.REHEARSAL_N ?? 1), gap = Number(process.env.REHEARSAL_GAP_MS ?? 0), stream = process.env.REHEARSAL_STREAM === "1";
const prompt = process.argv.at(-1);
for (let i = 0; i < n; i++) {
  if (i > 0 && gap) await new Promise((r) => setTimeout(r, gap));
  try {
    const res = await fetch(process.env.ASP_GATEWAY_URL + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + (process.env.OPENAI_API_KEY ?? "") }, body: JSON.stringify({ model: process.env.REHEARSAL_MODEL ?? "gpt-4o-mini", stream, messages: [{ role: "user", content: `${prompt} (${i + 1})` }] }) });
    const text = await res.text();
    let tools = "";
    if (stream) tools = [...text.matchAll(/"function":\{"name":"(\w+)"/g)].map((m) => m[1]).join(",");
    else { try { tools = (JSON.parse(text).choices?.[0]?.message?.tool_calls ?? []).map((c) => c.function?.name).join(","); } catch { tools = "not-json"; } }
    console.log(`request ${i + 1}: status ${res.status}; tools ${tools || "none"}`);
  } catch (e) { console.log(`request ${i + 1}: failed ${e.cause?.code ?? e.message}`); }
}
