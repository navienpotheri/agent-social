// Stands in for the `claude` CLI in tests: records its arguments, then behaves like an agent that
// learned something, writing a note into the auto memory directory its --settings file points at.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const settings = JSON.parse(readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
const mem = settings.autoMemoryDirectory;
// What Claude Code does after a call: its post-call hook events fire only for a call that actually ran
// (PostToolUse) or failed (PostToolUseFailure), never for one a hook blocked or its own permissions refused.
const pluginArg = args.indexOf("--plugin-dir") >= 0 ? args[args.indexOf("--plugin-dir") + 1] : undefined;
const hookScript = pluginArg && join(pluginArg, "scripts", "asp-mandate.mjs");
const postEvent = (event, name, id) => {
  if (hookScript && existsSync(hookScript)) {
    spawnSync(process.execPath, [hookScript], { input: JSON.stringify({ hook_event_name: event, tool_name: name, tool_use_id: id, session_id: "s" }), encoding: "utf8" });
  }
};
const REFUSED = "Permission to use Bash has been denied. For security, Claude Code may only run commands in its allowed set.";
if (process.env.FAKE_CLAUDE_ARGS) writeFileSync(process.env.FAKE_CLAUDE_ARGS, JSON.stringify(args));
// FAKE_CLAUDE_TOOL_USE: a JSON array of {name, input} — emitted as real --output-format
// stream-json tool_use blocks, so the compliance bridge (checkOutputForAction) has something real
// to parse, the same shape a real `claude -p ... --output-format stream-json` run would produce.
if (process.env.FAKE_CLAUDE_TOOL_USE) {
  const calls = JSON.parse(process.env.FAKE_CLAUDE_TOOL_USE);
  const content = calls.map((c, i) => ({ type: "tool_use", id: `toolu_${i}`, name: c.name, input: c.input ?? {} }));
  console.log(JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5", content, usage: { output_tokens: 10 } } }));
  // Optional per-call outcome, as the answering tool_result: "blocked" is what the pre-call Mandate hook's
  // refusal looks like to the runtime; "ok" means the call ran; "failed" ran and failed; "refused" is the
  // runtime's own permissions saying no (no post-call event, like the real thing).
  const results = calls.map((c, i) => {
    if (!c.result) return undefined;
    const id = `toolu_${i}`;
    if (c.result === "ok") postEvent("PostToolUse", c.name, id);
    if (c.result === "failed") postEvent("PostToolUseFailure", c.name, id);
    return {
      type: "tool_result", tool_use_id: id, is_error: c.result !== "ok",
      content: c.result === "blocked"
        ? "PreToolUse:Bash hook error: [node asp-mandate.mjs]: ASP Mandate: the scope is not granted by this job's Mandate, so this call was blocked before it ran"
        : c.result === "refused" ? REFUSED : c.result === "failed" ? "command failed: exit 1" : "ok",
    };
  }).filter(Boolean);
  if (results.length) console.log(JSON.stringify({ type: "user", message: { role: "user", content: results } }));
}
// FAKE_CLAUDE_HOOK_CALLS: a JSON array of {name, input}. Each call is made the way Claude Code makes it:
// a tool_use line, then the plugin's PreToolUse hook is actually run (the real asp-mandate.mjs, with the
// hook's JSON on stdin), then a tool_result: "ok" if the hook exits 0, otherwise the hook's refusal.
if (process.env.FAKE_CLAUDE_HOOK_CALLS) {
  const script = hookScript;
  JSON.parse(process.env.FAKE_CLAUDE_HOOK_CALLS).forEach((c, i) => {
    const id = `toolu_h${i}`;
    console.log(JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5", content: [{ type: "tool_use", id, name: c.name, input: c.input ?? {} }], usage: { output_tokens: 10 } } }));
    const hook = spawnSync(process.execPath, [script], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: c.name, tool_input: c.input ?? {}, tool_use_id: id, session_id: "s" }), encoding: "utf8" });
    // runtimeRefuses: the hook allowed it, but the runtime's own permissions refuse it afterwards.
    const ran = hook.status === 0 && !c.runtimeRefuses;
    if (ran) postEvent("PostToolUse", c.name, id);
    const content = hook.status !== 0 ? `PreToolUse:${c.name} hook error: [node asp-mandate.mjs]: ${hook.stderr}` : c.runtimeRefuses ? REFUSED : "ok";
    console.log(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: !ran, content }] } }));
  });
}
if (process.env.FAKE_CLAUDE_LEARN !== "0") {
  writeFileSync(join(mem, "refund-race.md"), "---\nname: refund-race\n---\nThe refund cache needs a per-key lock.\n");
  appendFileSync(join(mem, "MEMORY.md"), "- [Refund race](refund-race.md) — lock per key\n");
}
// FAKE_CLAUDE_HOLD_FILE = a path: the run says it is going (<path>.started), then waits until the test creates the file (up to 30 s), like a long job.
if (process.env.FAKE_CLAUDE_HOLD_FILE) {
  writeFileSync(process.env.FAKE_CLAUDE_HOLD_FILE + ".started", "going");
  for (let i = 0; i < 600 && !existsSync(process.env.FAKE_CLAUDE_HOLD_FILE); i++) await new Promise((r) => setTimeout(r, 50));
}
// FAKE_CLAUDE_OTHER_RUN = a package memory/auto directory: another run writes back there while this one is still going.
if (process.env.FAKE_CLAUDE_OTHER_RUN) {
  const other = process.env.FAKE_CLAUDE_OTHER_RUN;
  writeFileSync(join(other, "from-the-other-run.md"), "---\nname: other\n---\nThe other run learned to run migrations first.\n");
  appendFileSync(join(other, "MEMORY.md"), "- [Other run](from-the-other-run.md) - migrations first\n");
}
// FAKE_CLAUDE_LEARN_FILES = n: this run learns n extra topic files (to push memory over its budget).
for (let i = 0; i < Number(process.env.FAKE_CLAUDE_LEARN_FILES ?? 0); i++) {
  const name = "lesson-" + String(i).padStart(2, "0") + ".md";
  writeFileSync(join(mem, name), "---\nname: lesson-" + i + "\n---\nLesson number " + i + ".\n");
  appendFileSync(join(mem, "MEMORY.md"), "- [Lesson " + i + "](" + name + ") - lesson " + i + "\n");
}
process.exit(Number(process.env.FAKE_CLAUDE_EXIT ?? 0));
