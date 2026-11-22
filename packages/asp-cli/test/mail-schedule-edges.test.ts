// Row DK1700 (mutation check, launch-bar-2, 2026-11-22): the printed schedule entries cap the interval at 59 minutes, drop a fraction of a minute, send the cron job's output to a log file, and escape
// the characters that would break the macOS property list. The older test checked the shape and the lower bound only. Fake paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleEntries } from "@agent-social/asp-package";

const base = { node: "/usr/bin/node", cli: "/opt/asp/cli.ts" };

test("the interval is whole minutes, at least 1 and at most 59, in every entry", () => {
  assert.ok(scheduleEntries({ ...base, everyMinutes: 100 }).cron.startsWith("*/59 "), "capped at 59 in cron");
  assert.match(scheduleEntries({ ...base, everyMinutes: 100 }).windows, /\/MO 59 /, "capped at 59 in the Task Scheduler");
  assert.ok(scheduleEntries({ ...base, everyMinutes: 5.9 }).cron.startsWith("*/5 "), "a fraction of a minute is dropped");
  assert.match(scheduleEntries({ ...base, everyMinutes: 59 }).windows, /\/MO 59 /, "59 is allowed");
  assert.match(scheduleEntries({ ...base, everyMinutes: 0.4 }).windows, /\/MO 1 /, "less than a minute is a minute");
});

test("the cron entry sends the output to a log file in the home folder and runs the watcher once", () => {
  const cron = scheduleEntries({ ...base, everyMinutes: 5 }).cron;
  assert.ok(cron.endsWith(' >> "$HOME/.asp-mail-watch.log" 2>&1'), cron);
  assert.ok(cron.includes("mail watch --once"));
});

test("the property list escapes ampersands and angle brackets in the arguments", () => {
  const plist = scheduleEntries({ ...base, everyMinutes: 5, args: ["--mail-from", "A & B <noreply@example.org>"] }).launchd;
  assert.ok(plist.includes("A &amp; B &lt;noreply@example.org&gt;"), "escaped");
  assert.ok(!plist.includes("A & B"), "no raw ampersand");
});
