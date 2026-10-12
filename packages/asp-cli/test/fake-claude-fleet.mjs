// Stands in for `claude` in orchestrator tests. Behaves like a node that learns something specific
// to its assigned task: it reads the task from -p, and writes a task-named memory file plus a
// MEMORY.md line for it, so different nodes' consolidated memory can be checked for real merging.
// It also always writes a fixed-name file `shared.md` containing the task text, so two nodes running
// different tasks collide on the same path with different content (a conflict for orchestrate to
// keep side by side), while two nodes running the SAME task collide with identical content (a dedup).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const settings = JSON.parse(readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
const mem = settings.autoMemoryDirectory;
const task = args[args.indexOf("-p") + 1] ?? "unknown";

const failMatch = process.env.FAKE_FLEET_FAIL_MATCH;
if (failMatch && task.includes(failMatch)) process.exit(Number(process.env.FAKE_FLEET_FAIL_EXIT ?? 1));

if (process.env.FAKE_FLEET_LEARN !== "0") {
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task";
  writeFileSync(`${mem}/${slug}.md`, `---\nname: ${slug}\n---\nLearned from: ${task}\n`);
  appendFileSync(`${mem}/MEMORY.md`, `- [${slug}](${slug}.md) — lesson for "${task}"\n`);
  writeFileSync(`${mem}/shared.md`, `Shared note: ${task}\n`);
}
process.exit(0);
