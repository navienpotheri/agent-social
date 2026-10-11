// A stand-in for an OpenAI-style coding agent (Codex, Goose) under the gateway: sends its task (the last argument) to the model at ASP_GATEWAY_URL and prints what comes back.
const prompt = process.argv.at(-1);
const res = await fetch(process.env.ASP_GATEWAY_URL + "/v1/chat/completions", {
  method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + (process.env.OPENAI_API_KEY ?? "") },
  body: JSON.stringify({ model: "m", messages: [{ role: "user", content: prompt }] }),
});
const reply = await res.json();
const msg = reply.choices?.[0]?.message ?? {};
process.stdout.write(`agent key: ${process.env.OPENAI_API_KEY ?? "none"}; argv: ${process.argv.slice(2, 4).join(" ")}\nagent received tool calls: ${(msg.tool_calls ?? []).map((c) => c.function.name).join(", ") || "none"}\n${msg.content ?? ""}\n`);
