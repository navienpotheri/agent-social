// A stand-in for a Claude Code session that keeps working until the gateway stops answering it.
const base = process.env.ANTHROPIC_BASE_URL;
for (let i = 0; i < 400; i++) {
  const r = await fetch(base + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "keep going" }] }) }).catch(() => undefined);
  if (!r || !r.ok) { process.stdout.write(`the model stopped answering (${r?.status ?? "no answer"})\n`); process.exit(3); }
  await r.text();
  await new Promise((res) => setTimeout(res, 150));
}
