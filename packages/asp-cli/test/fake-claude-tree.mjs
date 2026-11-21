// A stand-in agent that starts a child which starts a grandchild, as a real agent does when it runs a shell command that runs a program: each writes its process id to a file named by
// TREE_DIR, then all of them wait. For testing that `asp stop --all` ends the whole tree and leaves nothing behind.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.TREE_DIR;
if (process.argv[2] === "grandchild") { writeFileSync(join(dir, "grandchild.pid"), String(process.pid)); setInterval(() => {}, 1000); }
else if (process.argv[2] === "child") {
  writeFileSync(join(dir, "child.pid"), String(process.pid));
  spawn(process.execPath, [process.argv[1], "grandchild"], { stdio: "ignore", env: process.env });
  setInterval(() => {}, 1000);
} else {
  writeFileSync(join(dir, "agent.pid"), String(process.pid));
  spawn(process.execPath, [process.argv[1], "child"], { stdio: "ignore", env: process.env });
  console.log("tree started");
  setInterval(() => {}, 1000);
}
