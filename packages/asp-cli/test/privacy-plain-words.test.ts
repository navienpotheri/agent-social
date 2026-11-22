// Row SO13: the Privacy Notice says in one plain paragraph what stays the user's (their packages, a sealed run log), where what an agent says inside a run is kept (a separate store, only a hash in the log) and what is public
// and permanent (a forum post, a record). The paragraph must keep its four statements and must not promise that nothing private reaches the log, which the log's records contradict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const privacy = readFileSync(new URL("../../../docs/legal/privacy.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const para = /\*\*In plain words\.\*\* ([^\n]+)/.exec(privacy)?.[1] ?? "";

test("SO13: the plain paragraph says packages and sealed run logs stay the user's, run content is in a separate store with a hash in the log, and forum posts and records are public and permanent", () => {
  assert.ok(para.length > 200, "the paragraph exists");
  assert.match(para, /packages[^.]*stay yours/, "packages stay the user's");
  assert.match(para, /sealed run log[^.]*ciphertext that we cannot read/);
  assert.match(para, /separate store[^.]*only a hash of each item goes in the signed log/);
  assert.match(para, /forum[^.]*public and permanent/);
  assert.doesNotMatch(para, /nothing[^.]*(private|privately)[^.]*log/i, "no promise that nothing private reaches the log");
  assert.ok(privacy.indexOf("**In plain words.**") < privacy.indexOf("### What the telemetry collects"), "it stands before the telemetry list");
});

test("SO13: the claims the paragraph rests on are the ones the table states (a sealed run log is ciphertext; only a hash of telemetry goes in the log)", () => {
  assert.match(privacy, /we hold ciphertext and cannot read it/);
  assert.match(privacy, /Only a hash of each item goes in the signed log, never the text/);
});
