/**
 * Register row DK1379 (invoice documents): a usage statement as one self-contained page that prints well (`asp meter invoice <id> --html-file`). Lines, tax lines and the total in the plan's currency; the sentence that says
 * whether the usage still matches the log; every text escaped; no script and no external file; and it says it is a statement of use, not a tax invoice or an e-invoice. Synthetic statement, fake names, mock credits.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderInvoiceHtml, type InvoiceBody } from "../src/invoice-html.ts";

const body: InvoiceBody = {
  holder: "did:web:example.com:users:<acme>", fleet: "did:web:example.com:fleets:acme", month: "2026-11", plan: "plan-1", contract: "c1",
  usage: { active_agents: 3, writes: 1200, tokens: 5_000_000, storage_bytes: 2048 },
  lines: [{ item: "agents (3 active)", quantity: 3, unit_price: 500, amount: 1500 }, { item: "writes over 1000 <extra>", quantity: 200, unit_price: 2, amount: 400 }],
  subtotal: 1900, tax: [{ name: "GST", rate_bp: 1800, amount: 342 }], total: 2242, currency: "USD", credits_applied: 5,
};

test("the page shows the lines, the tax and the total in major units, escapes every text, and has no script or external file", () => {
  const html = renderInvoiceHtml({ id: "sha256:abc", issued: "2026-12-01T00:00:00Z", body, matchesLog: true });
  assert.match(html, /<h1>Statement of use<\/h1>/);
  assert.match(html, /agents \(3 active\)/);
  assert.match(html, /<td class="n">15\.00<\/td>/, "1500 minor units is 15.00");
  assert.match(html, /GST \(18\.00 %\)<\/td><td class="n">3\.42/);
  assert.match(html, /Total \(USD\)<\/td><td class="n">22\.42/);
  assert.match(html, /Settled in part with 5 purchased credit/);
  assert.ok(html.includes("&lt;acme&gt;") && html.includes("&lt;extra&gt;"), "holder and item are escaped");
  assert.ok(!/<script|src=|href=|http:\/\/|https:\/\//.test(html), "self-contained");
  assert.match(html, /not a tax invoice or an e-invoice/);
  assert.match(html, /The usage this statement states is what the log counts/);
});

test("when the log now counts differently the page says so and names the difference", () => {
  const html = renderInvoiceHtml({ id: "sha256:abc", issued: "t", body, matchesLog: false, differences: ["writes 1200 -> 1210"] });
  assert.match(html, /class="warn" role="status">The log now counts differently: writes 1200 -&gt; 1210/);
});
