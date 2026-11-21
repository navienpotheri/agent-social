// A stand-in for the Claude Code CLI for the live-run rehearsal: makes REHEARSAL_N requests to the model at ANTHROPIC_BASE_URL (the gateway), one after another, optionally streamed (REHEARSAL_STREAM=1) and with a
// pause between them (REHEARSAL_GAP_MS), and prints what each came back as: the HTTP status, and the kinds of content blocks it received. It never throws on a bad answer (a real agent would show the error and go on).
const n = Number(process.env.REHEARSAL_N ?? 1), gap = Number(process.env.REHEARSAL_GAP_MS ?? 0), stream = process.env.REHEARSAL_STREAM === "1";
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
for (let i = 0; i < n; i++) {
  if (i > 0 && gap) await new Promise((r) => setTimeout(r, gap));
  try {
    const res = await fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: process.env.REHEARSAL_MODEL ?? "claude-haiku-5-5", max_tokens: 256, stream, messages: [{ role: "user", content: `${prompt} (${i + 1})` }] }) });
    const text = await res.text();
    let kinds = "";
    if (stream) kinds = [...text.matchAll(/"content_block":\{"type":"(\w+)"(?:,"id":"[^"]*","name":"(\w+)")?/g)].map((m) => m[1] + (m[2] ? `:${m[2]}` : "")).join(",");
    else { try { kinds = (JSON.parse(text).content ?? []).map((b) => b.type + (b.name ? `:${b.name}` : "")).join(","); } catch { kinds = "not-json"; } }
    console.log(`request ${i + 1}: status ${res.status}; blocks ${kinds || "none"}`);
  } catch (e) { console.log(`request ${i + 1}: failed ${e.cause?.code ?? e.message}`); }
}
