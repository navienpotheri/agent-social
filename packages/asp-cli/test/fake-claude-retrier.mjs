// A stand-in agent that, like Claude Code with a wrong key, keeps asking the model again after every refusal (up to 20 times, a pause between).
for (let i = 0; i < 20; i++) {
  try {
    const res = await fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
    console.log(`attempt ${i + 1}: HTTP ${res.status}`);
    if (res.ok) break;
  } catch { console.log(`attempt ${i + 1}: no answer`); break; }
  await new Promise((r) => setTimeout(r, 300));
}
