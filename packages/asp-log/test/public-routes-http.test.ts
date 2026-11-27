/**
 * The public routes served over HTTP (DK177 .ics; and every public page this branch added: a path that the service's route filter does not name is never reached, whatever the page function does). Each answers without a
 * token with the right type; the calendar file is valid iCalendar text (CRLF, folded at 75 octets, escaped, cancelled events kept). Fake keys only.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PUBLIC_PAGE_PATH, createLogServer, type EventView } from "../src/index.ts";
import { calendarIcs } from "../src/events.ts";
import { kit } from "./society-kit.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
const listen = async (s: Server) => { await new Promise<void>((r) => s.listen(0, "127.0.0.1", r)); servers.push(s); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };

const view = (over: Partial<EventView> = {}): EventView => ({ id: "sha256:" + "a".repeat(64), form: "contest", title: "Spring contest", place: "The Square", starts: "2026-12-01T10:00:00Z", ends: "2026-12-01T12:30:00Z", state: "open", entries: 4, rsvps: 2, prizes: [], parent: null, rules_sha256: "sha256:" + "b".repeat(64), ...over } as EventView);

test("DK177: the calendar file is iCalendar: CRLF lines, UTC times, escaped text, folded at 75 octets, a cancelled event kept and marked, sorted by start", () => {
  const ics = calendarIcs([
    view({ id: "sha256:" + "c".repeat(64), title: "Late; one, with a \\ and\nnewline", place: "Room 5", starts: "2026-12-05T09:00:00Z", ends: "2026-12-05T10:00:00Z", state: "cancelled" }),
    view({ title: "x".repeat(120) }),
  ], "2026-11-22T08:30:15Z");
  const lines = ics.split("\r\n");
  assert.equal(lines.at(-1), "", "the file ends in CRLF");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.at(-2), "END:VCALENDAR");
  assert.ok(!ics.replace(/\r\n/g, "").includes("\n"), "no bare line feed: an escaped newline is the two characters \\n");
  assert.ok(lines.every((l) => Buffer.byteLength(l) <= 75), "no line over 75 octets");
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("SUMMARY:" + "x".repeat(120)), "a folded line unfolds to the whole text");
  assert.ok(unfolded.includes("SUMMARY:Late\\; one\\, with a \\\\ and\\nnewline"), "semicolon, comma, backslash and newline are escaped");
  assert.ok(unfolded.includes("DTSTART:20261201T100000Z") && unfolded.includes("DTEND:20261201T123000Z"), "UTC, without separators");
  assert.ok(unfolded.includes("DTSTAMP:20261122T083015Z"));
  assert.ok(unfolded.includes("STATUS:CANCELLED") && unfolded.includes("STATUS:CONFIRMED"));
  assert.ok(unfolded.indexOf("x".repeat(120)) < unfolded.indexOf("Late"), "the earlier event comes first, whatever the order given");
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.ok(unfolded.includes("UID:" + "c".repeat(64) + "@events.asp.local"));
  assert.ok(unfolded.includes("DESCRIPTION:contest\\; cancelled\\; 4 entries"));
  assert.equal(calendarIcs([], "2026-11-22T00:00:00Z"), "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Agent Social//Events//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nEND:VCALENDAR\r\n", "an empty calendar is a valid file");
  assert.equal(calendarIcs([view()], "2026-11-22T00:00:00Z"), calendarIcs([view()], "2026-11-22T00:00:00Z"), "the same view and time give the same bytes");
});

test("every public page of this branch is reached through the service's route filter, without a token, with the right type", async () => {
  const k = await kit();
  const person = await k.person("pub-person", 10);
  const handle = { append: async () => ({ id: "x", seq: 1 }), log: k.log } as never;
  const url = await listen(createLogServer({ handle, tenants: [], noAuth: true }));
  const json = ["/courts/jurors", "/courts/report?month=2026-11", "/registry/report?month=2026-11", `/registry/principals/${encodeURIComponent(person.did)}`, "/academy/report?month=2026-11", "/institutions/academy/report?month=2026-11", "/institutions/market/report?month=2026-11", "/events/calendar"];
  for (const p of json) {
    const r = await fetch(url + p);
    assert.equal(r.status, 200, `${p} answered ${r.status}`);
    assert.match(r.headers.get("content-type") ?? "", /application\/json/, p);
    assert.equal(((await r.json()) as { ok: boolean }).ok, true, p);
  }
  const ics = await fetch(url + "/events/calendar.ics");
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get("content-type") ?? "", /text\/calendar/);
  assert.equal(ics.headers.get("x-content-type-options"), "nosniff");
  assert.match(await ics.text(), /^BEGIN:VCALENDAR\r\n/);
  for (const p of ["/society/inspectorate", "/society/elections"]) {
    const html = await fetch(url + p, { headers: { accept: "text/html" } });
    assert.equal(html.status, 200, p);
    assert.match(html.headers.get("content-type") ?? "", /text\/html/, p);
    assert.equal((await fetch(url + p)).status, 200, `${p} as JSON`);
  }
  assert.equal((await fetch(url + "/institutions/nowhere/report?month=2026-11")).status, 404);
  assert.equal((await fetch(url + "/courts/report?month=bad")).status, 400);
});

test("every path literal of public-pages.ts passes the service's route filter, so no page function is unreachable; the pages named by the audit answer over HTTP", async () => {
  const source = readFileSync(fileURLToPath(new URL("../src/public-pages.ts", import.meta.url)), "utf8");
  const paths = [...source.matchAll(/path === "(\/[^"]*)"/g)].map((m) => m[1]!);
  assert.ok(paths.length > 30, `found ${paths.length} path literals`);
  const unreachable = paths.filter((p) => !PUBLIC_PAGE_PATH.test(p));
  assert.deepEqual(unreachable, [], "these pages exist in public-pages.ts but the route filter in server.ts does not hand them to it");
  assert.ok(PUBLIC_PAGE_PATH.test("/registry/principals/did:web:x"), "a prefix route is named too");
  assert.ok(!PUBLIC_PAGE_PATH.test("/operator/secret") && !PUBLIC_PAGE_PATH.test("/society/farming"), "a path that is not public is not named");
  const k = await kit();
  const url = await listen(createLogServer({ handle: { append: async () => ({ id: "x", seq: 1 }), log: k.log } as never, tenants: [], noAuth: true }));
  for (const p of ["/bank/reserve", "/insurer/claims", "/insurer/reserve", "/society/emergency", "/society/house-agents"]) assert.equal((await fetch(url + p)).status, 200, `${p} over HTTP`);
});
