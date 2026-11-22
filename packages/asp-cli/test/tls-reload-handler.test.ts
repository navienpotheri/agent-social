// Row O15 (mutation check, launch-bar-2, 2026-11-22): the SIGHUP handler is registered on SIGHUP, the function that is returned removes that same handler (so that a stopped server does not keep a handler
// that reloads a certificate into a closed server), and the two sentences say what happened in their own words. The older test passed a stand-in whose `off` did nothing and matched only part of the wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reloadTlsOnSighup } from "../src/tls-reload.ts";

test("the handler is registered for SIGHUP and the returned function removes that same handler", () => {
  const calls: { op: string; event: string; fn: unknown }[] = [];
  const proc = { on: (event: string, fn: () => void) => { calls.push({ op: "on", event, fn }); }, off: (event: string, fn: () => void) => { calls.push({ op: "off", event, fn }); } } as never;
  const off = reloadTlsOnSighup({ setSecureContext() { /* accepts */ } } as never, { cert: "/no/such/cert", key: "/no/such/key" }, () => {}, proc);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0]!.op, calls[0]!.event], ["on", "SIGHUP"]);
  off();
  assert.equal(calls.length, 2);
  assert.deepEqual([calls[1]!.op, calls[1]!.event], ["off", "SIGHUP"]);
  assert.equal(calls[1]!.fn, calls[0]!.fn, "the same function is removed");
});

test("a failed reload says that the certificate was not reloaded and that the old one stays; the success line says that new connections use it", () => {
  const said: string[] = [];
  let handler: () => void = () => {};
  const proc = { on: (_e: string, fn: () => void) => { handler = fn; }, off() { /* not needed */ } } as never;
  reloadTlsOnSighup({ setSecureContext() { /* accepts */ } } as never, { cert: "/no/such/cert", key: "/no/such/key" }, (l) => said.push(l), proc);
  handler();
  assert.match(said.at(-1)!, /^  tls      the certificate was NOT reloaded and the old one stays in use/);
});

test("a successful reload says that the certificate was read again and that new connections use it", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "tls-handler-"));
  writeFileSync(join(dir, "c.pem"), "cert"); writeFileSync(join(dir, "k.pem"), "key");
  const said: string[] = [];
  let handler: () => void = () => {};
  const proc = { on: (_e: string, fn: () => void) => { handler = fn; }, off() { /* not needed */ } } as never;
  reloadTlsOnSighup({ setSecureContext() { /* accepts any pair */ } } as never, { cert: join(dir, "c.pem"), key: join(dir, "k.pem") }, (l) => said.push(l), proc);
  handler();
  assert.equal(said.at(-1), "  tls      the certificate was read again; new connections use it");
});
