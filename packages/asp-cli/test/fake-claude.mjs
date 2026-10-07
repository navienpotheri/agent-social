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
  const content = calls.map((c, i) => ({ type: "tool_use", id: `toolu_${i}`, name: c.name, input: c.input ?? {} }));
  console.log(JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5", content, usage: { output_tokens: 10 } } }));
  // Optional per-call outcome, as the answering tool_result: "blocked" is what the pre-call Mandate
  // hook's refusal looks like to the runtime; "ok" means the call ran.
  const results = calls.map((c, i) => c.result && ({
    type: "tool_result", tool_use_id: `toolu_${i}`, is_error: c.result === "blocked",
    content: c.result === "blocked"
      ? "PreToolUse:Bash hook error: [node asp-mandate.mjs]: ASP Mandate: the scope is not granted by this job's Mandate, so this call was blocked before it ran"
      : "ok",
  })).filter(Boolean);
  if (results.length) console.log(JSON.stringify({ type: "user", message: { role: "user", content: results } }));
}
if (process.env.FAKE_CLAUDE_LEARN !== "0") {
  writeFileSync(join(mem, "refund-race.md"), "---\nname: refund-race\n---\nThe refund cache needs a per-key lock.\n");
  appendFileSync(join(mem, "MEMORY.md"), "- [Refund race](refund-race.md) — lock per key\n");
}
process.exit(Number(process.env.FAKE_CLAUDE_EXIT ?? 0));
