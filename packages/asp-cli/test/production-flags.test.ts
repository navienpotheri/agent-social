// Rows O2 and T12 (spec-delta S1455; owner decision of 2026-11-21): the production start line. The deployed service starts with Google sign-up as the only way in (--signup-require-google), the limits file shared by its
// processes (--limits-state), 600 reads and 120 writes a minute for a tenant, and refuses to be set up without Google unless the operator says it is a test server; tenants signed up before the starting limit was raised are
// raised by one command. Fake keys; the script is read, not run (it needs root on the server: docs/live-check-cli.md runs it there).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Limits } from "@agent-social/asp-log";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const script = readFileSync(new URL("../../../docs/deploy/setup-server.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const execStart = /ExecStart=([\s\S]*?)\nRestart=/.exec(script)![1].replace(/\\\n\s*/g, " ");

test("the deployed start line carries the production flags: the limits, the shared limits file and Google as the only sign-up", () => {
  for (const flag of ["--rate-limit 600", "--write-limit 120", "--address-limit 1200", "--max-in-flight 16", "--limits-state $DATA/limits-state.json", "--signup ", "--trust-proxy", "--public-url https://$DOMAIN", "$GOOGLE_FLAGS"]) assert.ok(execStart.includes(flag), `the start line has ${flag}`);
  assert.match(script, /GOOGLE_FLAGS="--google-client-id \$GOOGLE_CLIENT_ID --google-redirect-uri https:\/\/\$DOMAIN\/auth\/callback --signup-require-google"/);
});

test("the setup script refuses a production start line without Google unless ALLOW_NO_GOOGLE=1 says it is a test server, and says what to do", () => {
  const guard = /if \[ -z "\$GOOGLE_FLAGS" \] && \[ "\$\{ALLOW_NO_GOOGLE:-\}" != "1" \]; then([\s\S]*?)\nfi\n/.exec(script);
  assert.ok(guard, "the guard is in the script");
  assert.match(guard![1], /ERROR: Google sign-up is not configured/);
  assert.match(guard![1], /exit 1/);
  assert.match(guard![1], /ALLOW_NO_GOOGLE=1 for a test server/);
  assert.ok(script.indexOf("ALLOW_NO_GOOGLE") < script.indexOf("cat > /etc/systemd/system/asp-log.service"), "the check comes before the service is written");
});

test("the numbers the line gives are the ones the service enforces: 600 reads and 120 writes a minute held over a minute, and an old tenant is held to its own 120", () => {
  let t = 1_000_000;
  const mk = () => new Limits({ tenantPerMinute: 600, appendPerMinute: 120, addressPerMinute: 1200, maxInFlight: 16, failedAuthMax: 10, now: () => t });
  // Hammer for 60 simulated seconds, 20 attempts a second, and count what is let through.
  const sustained = (check: (l: Limits) => { ok: boolean }) => { const l = mk(); let ok = 0; for (let s = 0; s < 60; s++) { for (let k = 0; k < 20; k++) if (check(l).ok) ok++; t += 1000; } return ok; };
  const reads = sustained((l) => l.checkTenant("t"));
  assert.ok(reads >= 600 && reads <= 800, `600 reads a minute (the burst on top): got ${reads}`);
  const writes = sustained((l) => l.checkWrite("t"));
  assert.ok(writes >= 120 && writes <= 180, `120 writes a minute (the burst on top): got ${writes}`);
  const old = sustained((l) => l.checkTenant("old", 120));
  assert.ok(old >= 120 && old <= 180, `a tenant with its own 120 is held to it: got ${old}`);
  assert.ok(reads > 3 * old, "raising an old tenant to 600 lets it through about five times as much");
});

async function asp(aspHome: string, cwd: string, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: aspHome }, cwd };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

test("asp serve raise-limits raises tenants signed up under the old 120 to the chosen number, never lowers, and leaves admins and tenants with no limit of their own alone", async () => {
  const f = makeFixture();
  const file = join(f.root, "tokens.json");
  const t = (name: string, extra: Record<string, unknown>) => ({ name, role: "tenant", tokenSha256: "0".repeat(64), ...extra });
  writeFileSync(file, JSON.stringify([
    { name: "ops", role: "admin", tokenSha256: "1".repeat(64), rateLimitPerMinute: 120 },
    t("old-one", { rateLimitPerMinute: 120 }), t("old-two", { rateLimitPerMinute: 120 }), t("fast", { rateLimitPerMinute: 900 }), t("default", {}),
  ]));
  const r = await asp(f.aspHome, f.root, ["serve", "raise-limits", "--tokens", file, "--rate-limit", "600"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^2 tenant\(s\) raised to 600 requests a minute/);
  const after = JSON.parse(readFileSync(file, "utf8")) as { name: string; rateLimitPerMinute?: number }[];
  const by = Object.fromEntries(after.map((x) => [x.name, x.rateLimitPerMinute]));
  assert.deepEqual(by, { ops: 120, "old-one": 600, "old-two": 600, fast: 900, default: undefined });
  const again = await asp(f.aspHome, f.root, ["serve", "raise-limits", "--tokens", file, "--rate-limit", "600"]);
  assert.match(again.out, /^0 tenant\(s\) raised/);
  for (const bad of [[], ["--rate-limit", "0"], ["--rate-limit", "fast"]]) {
    const x = await asp(f.aspHome, f.root, ["serve", "raise-limits", "--tokens", file, ...bad]);
    assert.notEqual(x.code, 0);
    assert.match(x.err, /asp serve raise-limits --tokens <file> --rate-limit/);
  }
});

test("the setup script runs the monitor and serves the status page from static files, so the page stays up while the service is down (DK1341)", () => {
  const unit = /cat > \/etc\/systemd\/system\/asp-monitor\.service <<UNIT([\s\S]*?)\nUNIT\n/.exec(script);
  assert.ok(unit, "the monitor has a unit");
  const exec = /ExecStart=([\s\S]*?)\nRestart=/.exec(unit![1])![1].replace(/\\\n\s*/g, " ");
  for (const flag of ["monitor run", "--service https://$DOMAIN", "--every 60", "--after 2", "--status-out /var/www/asp/status.json", "--status-html-out /var/www/asp/status.html", "--incidents /var/www/asp/incidents.json", "--backup-dir /var/backups/asp", "--alert-mail $MAIL_OPERATOR"]) assert.ok(exec.includes(flag), `the monitor line has ${flag}`);
  assert.match(unit![1], /Restart=always/);
  assert.match(script, /handle \/status \{\n\t\troot \* \/var\/www\/asp\n\t\trewrite \* \/status\.html/);
  assert.match(script, /handle \/status\.json \{/);
  assert.match(script, /systemctl is-active asp-log asp-monitor postgresql caddy/);
  assert.ok(script.indexOf("asp-monitor.service") < script.indexOf('echo "==> checks"'), "the monitor is started before the final checks");
});
