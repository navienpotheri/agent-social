// A stand-in agent for the canary-gate tests: it answers OK unless the package under test has a memory file whose name starts with "lesson-",
// in which case the "memory update" has confused it and it answers CONFUSED.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const pkg = process.argv[2];
const dir = join(pkg, "memory", "auto");
const confused = existsSync(dir) && readdirSync(dir).some((f) => f.startsWith("lesson-"));
console.log(confused ? "CONFUSED" : "OK");
