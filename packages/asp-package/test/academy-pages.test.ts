import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { academyRoutes } from "../src/academy-pages.ts";
import { Kit, registrar, hashOf } from "../../asp-log/test/academy-kit.ts";

// UC-322, register rows DK25 and DK26 (academy.md 7): a certificate verifies publicly, on a real log, and says so when it expires or is revoked; the leaderboard and the catalogue are read from signed records.
async function serve<T>(k: Kit, fn: (url: string) => Promise<T>): Promise<T> {
  const route = academyRoutes({ log: () => k.log as never });
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { return await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}`); } finally { server.close(); }
}
const json = async (url: string) => ({ status: (await fetch(url)).status, body: await (await fetch(url, { headers: { accept: "application/json" } })).json() as any });

test("a certificate verifies without a token: valid, then revoked with the reason; an unknown id is a 404", async () => {
  const k = new Kit();
  const a = await k.agent("holder");
  const id = await k.certify(a, "foundations", 1);
  await serve(k, async (url) => {
    const ok = await json(`${url}/academy/certificates/${encodeURIComponent(id)}`);
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.status, ok.body.holder, ok.body.skill, ok.body.level, ok.body.signed_by], ["valid", a.did, "foundations", 1, registrar.did]);
    const html = await (await fetch(`${url}/academy/certificates/${encodeURIComponent(id)}`)).text();
    assert.match(html, /<b>VALID<\/b>/);
    assert.match(html, /no outside security review/);
    assert.equal((await fetch(`${url}/academy/certificates/${encodeURIComponent(hashOf("4"))}`)).status, 404);
    await k.log.append(k.revoke(id, "cheating", registrar, "the run log did not match"));
    const gone = await json(`${url}/academy/certificates/${encodeURIComponent(id)}`);
    assert.deepEqual([gone.body.status, gone.body.revocation.reason], ["revoked", "cheating"]);
    assert.equal((await fetch(`${url}/academy/other`)).status, 404, "other paths are not the Academy's");
  });
});

test("an expired certificate reads as expired", async () => {
  const k = new Kit();
  const a = await k.agent("holder");
  const id = await k.certify(a, "foundations", 1);
  const at = new Date(Date.parse(k.now()) + 200 * 86_400_000).toISOString();
  assert.equal((await k.log.certificateStatus(id, at))?.status, "expired");
  assert.equal((await k.log.certificateStatus(id, k.now()))?.status, "valid");
});

test("the leaderboard and the catalogue are read from the log", async () => {
  const k = new Kit();
  const [r1, r2, r3] = [await k.agent("r1"), await k.agent("r2"), await k.agent("r3")];
  await k.priceList();
  const course = k.mk("course", r1, { course: "f1", title: "Working inside a Mandate", skill: "foundations", level: 1, lessons: [hashOf("a")], exercises: hashOf("e"), exercise_count: 2, price_service: "academy.course.foundations", author_share_permille: 550, reviews: [hashOf("b"), hashOf("c")], reviewers: [r2.did, r3.did] }, null, { cosigners: [registrar] });
  await k.put(course);
  await serve(k, async (url) => {
    const c = await json(`${url}/academy/courses`);
    assert.deepEqual(c.body.courses.map((x: any) => [x.title, x.reviewers, x.learners]), [["Working inside a Mandate", 2, 0]]);
    const b = await json(`${url}/academy/board/refactoring`);
    assert.deepEqual(b.body.seasons, []);
    assert.match(await (await fetch(`${url}/academy/board/refactoring`)).text(), /No results yet/);
  });
});
