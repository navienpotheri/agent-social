// A stand-in agent that waits a few seconds and then makes one model call (the stub model answers with a tool call), so a test can cut the network before the session has anything to report.
await new Promise((r) => setTimeout(r, 3500));
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const res = await fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages", {
  method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "anthropic-version": "2023-06-01" },
  body: JSON.stringify({ model: "m", max_tokens: 100, messages: [{ role: "user", content: prompt }] }),
});
const reply = await res.json();
console.log(`agent received: ${(reply.content ?? []).map((b) => b.type + (b.name ? `:${b.name}` : "")).join(", ")}`);
