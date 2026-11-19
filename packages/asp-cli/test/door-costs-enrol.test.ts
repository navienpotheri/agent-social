// Row DK853, over a live service: the enrol reply and the front door state the same costs the forum and the starter grant enforce. Fake keys only; credits are mock accounting entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNet } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STARTER_UPFRONT, hashToken } from "@agent-social/asp-log";
import { FORUM_COSTS, FORUM_FORM, FORUM_RATE } from "@agent-social/asp-package";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

test("DK853: the enrol reply and /society/llms.txt state the forum cost, the rate and the starter grant from the enforced constants", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-costs-"));
  const tokens = join(dir, "tokens.json");
  writeFileSync(tokens, JSON.stringify([{ name: "ops", role: "admin", tokenSha256: hashToken("tok-ops") }]));
  const port = await freePort();
  const server = spawn(process.execPath, [cli, "serve", "--db", `local:${join(dir, "log")}`, "--tokens", tokens, "--port", String(port), "--signup", "--signup-terms-url", "https://example.org/terms", "--did-domain", `127.0.0.1:${port}`, "--hosted-keys", join(dir, "hosted.keys"), "--http-enrol", "--forum", join(dir, "forum"), "--rate-limit", "0", "--write-limit", "0", "--address-limit", "0"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ASP_HOSTED_PASSPHRASE: "a long enough test passphrase" } });
  try {
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => { buf += d; if (/listening on/.test(buf)) resolve(); });
      server.on("close", () => reject(new Error(`the service exited: ${buf}`)));
      setTimeout(() => reject(new Error(`no start line: ${buf}`)), 30_000);
    });
    const base = `http://127.0.0.1:${port}`;
    const r = await fetch(`${base}/signup/http`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle: "costs-agent", model: "a browsing model", accept_terms: true, terms_version: "2026-10" }) });
    assert.equal(r.status, 201);
    const j = (await r.json()) as { costs: Array<{ kind: string; what: string; amount?: number }> };
    const text = j.costs.map((l) => l.what).join("\n");
    assert.ok(text.includes(`costs ${FORUM_COSTS.longPost} credits`), "the long post cost");
    assert.ok(text.includes(`over ${FORUM_FORM.shortPostChars} characters`));
    assert.ok(text.includes(`at most ${FORUM_RATE.perMinute} acts a minute`));
    assert.ok(text.includes(`${STARTER_UPFRONT} at once`));
    assert.deepEqual(new Set(j.costs.map((l) => l.kind)), new Set(["free", "credits", "bond"]));
    const door = await (await fetch(`${base}/society/llms.txt`)).text();
    assert.ok(door.includes(`costs ${FORUM_COSTS.longPost} credits`), "the door states the same cost");
    assert.ok(door.includes("Puts your bond at risk"));
  } finally { server.kill(); }
});
