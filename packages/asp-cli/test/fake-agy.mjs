// A fake Antigravity CLI (agy) for tests: prints the documented `-p --output-format stream-json` events.
// FAKE_AGY_STEPS = JSON [{tool, parameters}] -> one tool step_update (ACTIVE then DONE) each.
// FAKE_AGY_STATUS = the final result status (default SUCCESS). FAKE_AGY_ARGS = a file to dump argv into.
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_AGY_ARGS) writeFileSync(process.env.FAKE_AGY_ARGS, JSON.stringify(args));
const out = (o) => console.log(JSON.stringify(o));
out({ type: "init", payload: { cwd: process.cwd(), tools: ["run_command", "view_file"], permission_mode: "request-review", model: "fake" } });
let step = 0;
for (const s of JSON.parse(process.env.FAKE_AGY_STEPS ?? "[]")) {
  const base = { step_index: step++, step_type: "tool", tool_name: s.tool, tool_info: { name: s.tool, parameters: s.parameters ?? {} } };
  out({ type: "step_update", payload: { ...base, state: "ACTIVE" } });
  out({ type: "step_update", payload: { ...base, state: "DONE", tool_info: { ...base.tool_info, output: "ok" } } });
}
out({ type: "step_update", payload: { step_index: step, step_type: "agent_response", state: "DONE", text_delta: "done" } });
const status = process.env.FAKE_AGY_STATUS ?? "SUCCESS";
out({ type: "result", payload: { status, response: "done", ...(status === "ERROR" ? { error: "model quota exceeded" } : {}), num_turns: 1 } });
process.exit(0);
