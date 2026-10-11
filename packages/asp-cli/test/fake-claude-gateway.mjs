// A stand-in for the Claude Code CLI under the gateway: sends its prompt to the "model" at ANTHROPIC_BASE_URL (the gateway) and prints what comes back.
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const res = await fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages", {
  method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "anthropic-version": "2023-06-01" },
  body: JSON.stringify({ model: "m", max_tokens: 100, messages: [{ role: "user", content: prompt }] }),
});
const reply = await res.json();
const kinds = (reply.content ?? []).map((b) => b.type + (b.name ? `:${b.name}` : ""));
process.stdout.write(`agent received: ${kinds.join(", ")}\n${(reply.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n")}\n`);
