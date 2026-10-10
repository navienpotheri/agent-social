// Stands in for the OpenHands launch in tests: receives the generated launch.sh path, records it,
// and writes a memory note into the run's memory dir (next to launch.sh), like an agent following
// its memory instructions.
import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const script = process.argv[2];
if (process.env.FAKE_OH_ARGS) writeFileSync(process.env.FAKE_OH_ARGS, JSON.stringify(process.argv.slice(2)));
if (process.env.FAKE_OH_HIDDEN_FAILURE) {
  // Mimics OpenHands' real behavior: a fatal error reported only on the JSONL stream, exit code 0.
  console.log(JSON.stringify({ kind: "MessageEvent", source: "user" }));
  console.log(JSON.stringify({ kind: "ConversationErrorEvent", code: "AuthenticationError", detail: process.env.FAKE_OH_HIDDEN_FAILURE }));
  process.exit(0);
}
if (process.env.FAKE_OH_ACTIONS) {
  // Real headless --json shape: one ActionEvent per tool call, with tool_name and an action payload.
  for (const a of JSON.parse(process.env.FAKE_OH_ACTIONS)) {
    console.log(JSON.stringify({ kind: "ActionEvent", source: "agent", tool_name: a.tool_name, action: a.action ?? {} }));
  }
}
if (process.env.FAKE_OH_ENV) {
  writeFileSync(process.env.FAKE_OH_ENV, JSON.stringify({ model: process.env.LLM_MODEL, base: process.env.LLM_BASE_URL, key: process.env.LLM_API_KEY }));
}
if (process.env.FAKE_OH_LEARN !== "0") {
  const mem = join(dirname(script), "memory", "auto");
  writeFileSync(join(mem, "openhands-wsl.md"), "---\nname: openhands-wsl\n---\nRun tests inside WSL, not PowerShell.\n");
  appendFileSync(join(mem, "MEMORY.md"), "- [OpenHands WSL](openhands-wsl.md) — tests run in WSL\n");
}
process.exit(Number(process.env.FAKE_OH_EXIT ?? 0));
