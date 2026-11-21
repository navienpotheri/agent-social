// Register row DK1360: `asp serve token --data-sharing private` records an organisation's upfront choice in the tenant; a bad value is refused; the default records nothing (the always-on rule of DK1303).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";

async function asp(args: string[]) {
  const out: string[] = [], err: string[] = [];
  const home = mkdtempSync(join(tmpdir(), "asp-sts-home-"));
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, HOME: home, USERPROFILE: home }, cwd: home };
  const code = await main(args, io);
  return { code, text: [...out, ...err].join("\n") };
}

test("DK1360: a private tenant is recorded and said; the default records nothing; a bad value is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-sts-"));
  const file = join(dir, "tokens.json");
  const priv = await asp(["serve", "token", "--tokens", file, "--tenant", "org-private", "--data-sharing", "private"]);
  assert.equal(priv.code, 0, priv.text);
  assert.match(priv.text, /data sharing: private/);
  const open = await asp(["serve", "token", "--tokens", file, "--tenant", "org-shared"]);
  assert.equal(open.code, 0, open.text);
  assert.doesNotMatch(open.text, /data sharing/);
  const explicit = await asp(["serve", "token", "--tokens", file, "--tenant", "org-explicit", "--data-sharing", "share"]);
  assert.equal(explicit.code, 0, explicit.text);
  const tenants = JSON.parse(readFileSync(file, "utf8")) as { name: string; dataSharing?: string }[];
  assert.equal(tenants.find((t) => t.name === "org-private")!.dataSharing, "private");
  assert.equal(tenants.find((t) => t.name === "org-shared")!.dataSharing, undefined);
  assert.equal(tenants.find((t) => t.name === "org-explicit")!.dataSharing, undefined, "share is the default and records nothing");
  const bad = await asp(["serve", "token", "--tokens", file, "--tenant", "org-bad", "--data-sharing", "maybe"]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.text, /--data-sharing is share or private/);
  assert.ok(!JSON.parse(readFileSync(file, "utf8")).some((t: { name: string }) => t.name === "org-bad"));
});
