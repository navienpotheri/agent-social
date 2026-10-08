// A fake Antigravity CLI (agy) for tests: prints the real `-p --output-format stream-json` events (shape checked on agy 1.3.1).
// FAKE_AGY_STEPS = JSON [{tool, parameters, blocked?, ran?}]: one tool step each (ACTIVE, then DONE).
//   blocked: the pre-call hook denied it (ACTIVE, then ERROR with the hook's message, as the real agy does).
//   ran: the call ran, so the post-call hook records it in <run dir>/executed-calls.ndjson (the run dir is the parent of the cwd).
// FAKE_AGY_STATUS = the final result status (default SUCCESS). FAKE_AGY_ARGS = a file to dump argv and cwd into.
import { appendFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
if (process.env.FAKE_AGY_ARGS) writeFileSync(process.env.FAKE_AGY_ARGS, JSON.stringify({ args, cwd: process.cwd() }));
const out = (o) => console.log(JSON.stringify(o));
const conversation_id = "fake-conversation";
out({ event: "init", conversation_id, init: { cwd: process.cwd(), tools: ["run_command", "view_file"], permission_mode: "request-review" } });
out({ event: "step_update", step_update: { conversation_id, step_index: 0, state: "DONE", step_type: "user_input" } });
let step = 1;
for (const s of JSON.parse(process.env.FAKE_AGY_STEPS ?? "[]")) {
  const index = step++;
  const base = { conversation_id, step_index: index, step_type: "tool", tool_name: s.tool, tool_info: { name: s.tool, parameters: s.parameters ?? {} } };
  out({ event: "step_update", step_update: { ...base, state: "ACTIVE" } });
  if (s.blocked) {
    out({ event: "step_update", step_update: { ...base, state: "ERROR", tool_info: { ...base.tool_info, error: { type: "TOOL_ERROR", message: "tool call denied by pre-tool hook: ASP Mandate: the scope is not granted by this job's Mandate, so this call was blocked before it ran" } } } });
  } else {
    out({ event: "step_update", step_update: { ...base, state: "DONE", tool_info: { ...base.tool_info, output: "ok" } } });
    if (s.ran) appendFileSync(dirname(process.cwd()) + "/executed-calls.ndjson", JSON.stringify({ at: new Date().toISOString(), id: `step-${index}`, tool: s.tool, failed: false }) + "\n");
  }
}
out({ event: "step_update", step_update: { conversation_id, step_index: step, step_type: "agent_response", state: "DONE", text_delta: "done" } });
const status = process.env.FAKE_AGY_STATUS ?? "SUCCESS";
out({ event: "result", result: { conversation_id, status, response: "done", ...(status === "ERROR" ? { error: "model quota exceeded" } : {}), num_turns: 1 } });
process.exit(0);
