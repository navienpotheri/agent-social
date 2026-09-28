// Stands in for the `claude` CLI in tests: records its arguments, then behaves like an agent that
// learned something, writing a note into the auto memory directory its --settings file points at.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const settings = JSON.parse(readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
const mem = settings.autoMemoryDirectory;
if (process.env.FAKE_CLAUDE_ARGS) writeFileSync(process.env.FAKE_CLAUDE_ARGS, JSON.stringify(args));
// FAKE_CLAUDE_TOOL_USE: a JSON array of {name, input} — emitted as real --output-format
// stream-json tool_use blocks, so the compliance bridge (checkOutputForAction) has something real
// to parse, the same shape a real `claude -p ... --output-format stream-json` run would produce.
if (process.env.FAKE_CLAUDE_TOOL_USE) {
  const calls = JSON.parse(process.env.FAKE_CLAUDE_TOOL_USE);
  const content = calls.map((c) => ({ type: "tool_use", name: c.name, input: c.input ?? {} }));
  console.log(JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5", content, usage: { output_tokens: 10 } } }));
}
if (process.env.FAKE_CLAUDE_LEARN !== "0") {
  writeFileSync(join(mem, "refund-race.md"), "---\nname: refund-race\n---\nThe refund cache needs a per-key lock.\n");
  appendFileSync(join(mem, "MEMORY.md"), "- [Refund race](refund-race.md) — lock per key\n");
}
process.exit(Number(process.env.FAKE_CLAUDE_EXIT ?? 0));
