// Row O15: a renewed certificate is read again without a restart (SIGHUP). A pair that is not valid is refused and the old certificate stays. Uses openssl for two self-signed certificates; skipped
// where it is not installed.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:https";
import { connect } from "node:tls";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reloadTls, reloadTlsOnSighup } from "../src/tls-reload.ts";

const opensslOk = (() => { try { execFileSync("openssl", ["version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

function pair(cn: string) {
  const dir = mkdtempSync(join(tmpdir(), "asp-tlsr-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "2", "-subj", `/CN=${cn}`], { stdio: "ignore" });
  return { cert: join(dir, "cert.pem"), key: join(dir, "key.pem") };
}
const subjectSeen = (port: number) => new Promise<string>((resolve, reject) => {
  const s = connect({ host: "127.0.0.1", port, rejectUnauthorized: false }, () => { const c = s.getPeerCertificate(); s.end(); resolve(String(c.subject?.CN)); });
  s.on("error", reject);
});

test("SIGHUP reloads the certificate files; an invalid pair is refused and the old certificate stays", { skip: !opensslOk && "openssl is not installed" }, async () => {
  const a = pair("before.example"), b = pair("after.example");
  const live = { cert: join(mkdtempSync(join(tmpdir(), "asp-tlsr-live-")), "cert.pem"), key: "" };
  live.key = live.cert.replace("cert.pem", "key.pem");
  writeFileSync(live.cert, readFileSync(a.cert)); writeFileSync(live.key, readFileSync(a.key));
  const server = createServer({ cert: readFileSync(live.cert), key: readFileSync(live.key) }, (_q, r) => r.end("ok"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const port = (server.address() as { port: number }).port;
  assert.equal(await subjectSeen(port), "before.example");

  const said: string[] = [];
  const handlers: Record<string, () => void> = {};
  const off = reloadTlsOnSighup(server, live, (l) => said.push(l), { on: (e: string, f: () => void) => { handlers[e] = f; }, off: () => {} } as never);

  // The files are renewed on disk; the signal makes the server read them.
  writeFileSync(live.cert, readFileSync(b.cert)); writeFileSync(live.key, readFileSync(b.key));
  handlers.SIGHUP!();
  assert.match(said.at(-1)!, /certificate was read again/);
  assert.equal(await subjectSeen(port), "after.example");

  // A certificate with another pair's key is not a valid pair: refused, the previous certificate stays.
  writeFileSync(live.cert, readFileSync(a.cert));
  handlers.SIGHUP!();
  assert.match(said.at(-1)!, /NOT reloaded and the old one stays in use/);
  assert.equal(await subjectSeen(port), "after.example");
  assert.throws(() => reloadTls(server, live));
  off();
});
