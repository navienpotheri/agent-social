// Row DK1700: `asp mail watch --print-schedule` prints the entries that run `asp mail watch --once` on a timer (Windows Task Scheduler, cron, launchd). It installs nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { scheduleEntries } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

test("the entries have the shape of each system's scheduler and run the watcher once", () => {
  const e = scheduleEntries({ node: "C:\\Program Files\\nodejs\\node.exe", cli: "C:\\asp\\cli.ts", home: "C:\\Users\\me\\asp home", everyMinutes: 5, args: ["--send", "--mail-from", "noreply@example.com"] });
  assert.match(e.windows, /^schtasks \/Create \/TN AgentSocialMailWatch \/SC MINUTE \/MO 5 \/TR "cmd \/c /);
  assert.match(e.windows, /mail watch --once --send --mail-from noreply@example\.com/);
  assert.match(e.windows, /\/F$/);
  assert.match(e.cron, /^\*\/5 \* \* \* \* ASP_HOME="C:\\Users\\me\\asp home" /);
  assert.match(e.cron, /mail watch --once --send/);
  assert.match(e.launchd, /<key>StartInterval<\/key><integer>300<\/integer>/);
  assert.match(e.launchd, /<string>--once<\/string>/);
  assert.match(e.launchd, /<key>ASP_HOME<\/key><string>C:\\Users\\me\\asp home<\/string>/);
  assert.equal(scheduleEntries({ node: "n", cli: "c", everyMinutes: 0 }).cron.startsWith("*/1 "), true, "the interval is at least a minute");
});

test("asp mail watch --print-schedule prints the three entries, says nothing was installed, and changes nothing on the machine", async () => {
  const f = makeFixture();
  const out: string[] = []; const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(["mail", "watch", "--print-schedule", "--interval", "600"], io);
  assert.equal(code, 0, err.join("\n"));
  const text = out.join("\n");
  assert.match(text, /schtasks \/Create/);
  assert.match(text, /\/MO 10 /);
  assert.match(text, /\*\/10 \* \* \* \*/);
  assert.match(text, /com\.agentsocial\.mailwatch/);
  assert.match(err.join("\n"), /nothing was installed/);
  assert.equal(existsSync(join(f.aspHome, "outbox")), false, "no mail was queued and no state written");
});
