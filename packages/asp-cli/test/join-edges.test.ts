import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp } from "node:http";
import { createServer as createNet } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const freePort = () => new Promise<number>((resolve) => { const s = createNet(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

async function runJoin(home: string, args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: home, ASP_JOIN_POLL_MS: "100", ...env }, cwd: home } as Io;
  const code = await main(["join", "--no-open", "--yes", ...args], io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

// UC-04: asp join where things go wrong. The browser step is the one place a person leaves the terminal, so it has to survive a dropped connection, a missing browser and a long wait.
test("asp join: the service is down, there is no browser, the connection drops while you sign up, and the wait runs out: each says what happened and what to do", async () => {
  const f = makeFixture();
  const home = f.aspHome;

  // The service is down: a plain message, nothing saved.
  const dead = await freePort();
  const down = await runJoin(home, ["--service", `http://127.0.0.1:${dead}`]);
  assert.equal(down.code, 1);
  assert.match(down.err, /cannot reach the service at http:\/\/127\.0\.0\.1:\d+ \(nothing is answering there/, down.err);
  assert.ok(!existsSync(join(home, "config.json")), "nothing saved");

  // A stand-in for the service's sign-up: open, and the pickup has nothing for a while.
  let pickups = 0, failFirst = 2, giveToken = false;
  const svc = createHttp(async (req, res) => {
    for await (const _ of req) { /* not inspected */ }
    res.setHeader("content-type", "application/json");
    if (req.url === "/signup") return res.end(JSON.stringify({ ok: true, open: true }));
    if (req.url === "/join/pickup") {
      pickups++;
      if (pickups <= failFirst) { req.socket.destroy(); return; } // the wifi drops while the person is in the browser
      if (!giveToken) { res.writeHead(202); return res.end("{}"); }
      return res.end(JSON.stringify({ tenant: "joiner", token: "tok-x" }));
    }
    res.writeHead(404); res.end("{}");
  });
  await new Promise<void>((r) => svc.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(svc.address() as { port: number }).port}`;
  try {
    // The wait runs out: said plainly, with what to do, and nothing saved. (A wait this short is for the test.)
    const slow = await runJoin(home, ["--service", base], { ASP_JOIN_TIMEOUT_MS: "2000" });
    assert.equal(slow.code, 1);
    assert.match(slow.err, /gave up waiting for the sign-up after \d+ minutes?\. Run asp join again\./, slow.err);
    assert.match(slow.err, /that account exists but this terminal never received its login, so pick a different name/, slow.err);
    assert.ok(!existsSync(join(home, "config.json")), "nothing saved");
    // No browser (SSH, a container): the address is printed with how to use it from another device, and the connection dropping twice while waiting does not end the join.
    assert.match(slow.out, /open that address on any other device\. This terminal picks up the result by itself/);
    assert.match(slow.out, /cannot reach the service right now; still waiting/, "the dropped connection is said once and the wait goes on\n" + slow.out);
    assert.ok(pickups > failFirst, "it kept asking after the connection dropped");
    // And it is picked up once the sign-up is finished: the join goes on past the browser step (the stand-in has no accounts, so it stops there, with a clear reason).
    pickups = 0; failFirst = 1; giveToken = true;
    const through = await runJoin(home, ["--service", base], { ASP_JOIN_TIMEOUT_MS: "5000" });
    assert.match(through.out, /Signed up as joiner/, through.out);
  } finally { svc.close(); }
});
