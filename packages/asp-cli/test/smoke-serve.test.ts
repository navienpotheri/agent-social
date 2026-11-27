// A running `asp serve` answers every public page a launch needs, with no token (register row DK293; scripts/smoke-serve.mjs).
// This test found that /society/indicators, /charters, /support/status and /operator/acts were built and tested as functions but answered 401 over HTTP.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error a plain .mjs script, no types
import { ROUTES, smoke, startLocal } from "../../../scripts/smoke-serve.mjs";

test("DK293: a service started with the production flags answers 200 on every public page, without a token", async () => {
  const s = await startLocal();
  try {
    const rows = await smoke(s.url);
    const bad = rows.filter((r: { ok: boolean }) => !r.ok).map((r: { path: string; status: number }) => `${r.path} ${r.status}`);
    assert.deepEqual(bad, [], `these pages did not answer 200: ${bad.join(", ")}`);
    assert.equal(rows.length, ROUTES.length);
    const q = await fetch(`${s.url}/operator/acts?limit=5`);
    assert.equal(q.status, 200, "a query string does not hide a public page");
    const unknown = await fetch(`${s.url}/society/secret`);
    assert.notEqual(unknown.status, 200, "an unlisted path is not made public by the pattern");
  } finally { s.stop(); }
});
