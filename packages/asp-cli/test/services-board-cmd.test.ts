// DK661 (S970; owner decision SB1): `asp services post|bid|list` go through the log, and /society/services shows the open services over HTTP with no free text and no token. Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Signer } from "@agent-social/asp-core";
import { credit, kit, type Party } from "../../asp-log/test/society-kit.ts";
import { servicesRoutes } from "../../asp-package/src/services-pages.ts";
import { servicesCmd, ServicesUsage } from "../src/services-cmd.ts";

test("post, bid and list go through the log; the public page lists only open services, with the kind and price and no free text", async () => {
  const k = await kit();
  await k.withPrices();
  const s1 = await k.person("sv-sponsor-1", 100);
  const s2 = await k.person("sv-sponsor-2", 100);
  const buyer = await k.agent("sv-buyer", s1, { funds: 200 });
  const teacher = await k.agent("sv-teacher", s2, { funds: 20 });
  const sibling = await k.agent("sv-sibling", s1, { funds: 20 });
  const mandate = await k.openMandate(buyer, [{ institution: "market", cap: credit(30), period: "month" }]);
  const parties = new Map<string, Party>([[buyer.did, buyer], [teacher.did, teacher], [sibling.did, sibling]]);
  const lines: string[] = [];
  const handle = { log: k.log, append: (r: never) => k.log.append(r) } as never;
  const run = (sub: string, flags: Record<string, unknown>) => servicesCmd(sub, { log: handle, io: { out: (l) => lines.push(l) }, now: () => new Date(Date.parse("2026-11-02T00:00:00Z") + lines.length * 1000).toISOString(), signerFor: (d) => parties.get(d) as Signer, flags: flags as never });

  assert.equal(await run("list", {}), 0);
  assert.match(lines.at(-1)!, /no open services/);
  await assert.rejects(() => run("post", { by: buyer.did, service: "sell_credits", price: "10", deposit: "x" }), ServicesUsage);
  await assert.rejects(() => run("post", { by: buyer.did, service: "teaching", price: "101", deposit: "x" }), ServicesUsage);
  const deposit = await k.buy(buyer, "market.posting.deposit", 2, { mandate });
  assert.equal(await run("post", { by: buyer.did, service: "teaching", price: "40", deposit }), 0);
  const posting = /service posting (\S+):/.exec(lines.at(-1)!)![1];

  await assert.rejects(() => run("bid", { by: sibling.did, posting }), /same owner/, "one owner's own agent is refused by the log");
  assert.equal(await run("bid", { by: teacher.did, posting }), 0);
  assert.match(lines.at(-1)!, /bid \S+ by .*sv-teacher/);

  assert.equal(await run("list", { json: true }), 0);
  const listed = JSON.parse(lines.at(-1)!);
  assert.deepEqual(listed.map((r: { service: string; price: number }) => [r.service, r.price]), [["teaching", 40]]);

  const route = servicesRoutes({ log: () => k.log as never });
  const server = createServer(async (req, res) => { if (!(await route(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/society/services`;
    const j = await (await fetch(base, { headers: { accept: "application/json" } })).json() as { services: { posting: string; service: string; price: number; poster: string }[]; kinds: Record<string, string> };
    assert.deepEqual(j.services.map((s) => [s.service, s.price, s.poster]), [["teaching", 40, buyer.did]]);
    assert.doesNotMatch(JSON.stringify(j.services), /Teach me|purpose|description/i, "no free text from the intent");
    assert.ok(Object.keys(j.kinds).includes("study_partner"));
    const html = await (await fetch(base)).text();
    assert.match(html, /Teaching: an agent teaches another/);
    assert.match(html, /40 credits/);
    assert.match(html, /not money/);
    assert.equal((await fetch(base, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}x`)).status, 404);
  } finally { server.close(); }
  assert.equal((await k.log.creditAudit()).verdict, "balanced");
});
