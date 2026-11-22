/**
 * Register row E8 (a reader of the run log for a person): `asp runs --html-file <file>` writes the sessions of this machine as one self-contained page. Escaped, no script, no external file; counts, refusals and reasons shown;
 * an empty list says so. Synthetic sessions, fake names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRunsHtml } from "../src/runs-html.ts";

test("the page shows each session with its calls, refusals and reasons, escapes every text, and has no script or external file", () => {
  const html = renderRunsHtml({ generated: "2026-11-22T10:00:00Z", rows: [
    { sid: "s-1", at: "2026-11-22T09:00:00Z", runtime: "claude-code", agent: "did:web:example.com:agents:<coder>", purpose: "List files, then <curl>", state: "finished", calls: 2, tokens: 1234, exitCode: 0, refused: ["curl https://evil.example/x: the scope shell.network is not granted"], runLog: "C:\runs\run-log.ndjson" },
    { sid: "s-2", at: "2026-11-22T09:30:00Z", runtime: "codex", agent: "a", purpose: "x", state: "interrupted", refused: [], stopped: "stopped: dollar cap reached" },
  ] });
  assert.match(html, /<h1>What my agents did<\/h1>/);
  assert.match(html, /2 session\(s\) on this machine, 1 call\(s\) refused in all/);
  assert.ok(html.includes("the scope shell.network is not granted"));
  assert.ok(html.includes("&lt;coder&gt;") && html.includes("&lt;curl&gt;"), "escaped");
  assert.match(html, /<td class="n">2<\/td><td class="n">1<\/td><td class="n">1234<\/td>/);
  assert.match(html, /stopped: dollar cap reached/);
  assert.match(html, /<td class="n">\?<\/td>/, "a session with no end shows ? for calls");
  assert.ok(!/<script|src=|href=|http:\/\/|https:\/\/(?!evil)/.test(html.replace(/https:\/\/evil\.example\/x/g, "")), "self-contained");
});

test("with no sessions the page says so", () => {
  const html = renderRunsHtml({ generated: "t", rows: [] });
  assert.match(html, /No sessions yet/);
  assert.ok(!/<table/.test(html));
});
