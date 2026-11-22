/**
 * A usage statement as one self-contained page that prints well (DK1379): `asp meter invoice <statement id> --html-file <file>`. It is the statement the log signed, shown as lines, tax lines and a total, with the sentence
 * that says whether the usage it states is still what the log counts. It is a STATEMENT OF USE computed from the signed log, not a tax invoice under any country's law and not an e-invoice: the format an enterprise's
 * accounts system reads, and the legal fields a tax invoice needs, are the owner's decision (docs/owner-questions-all.md). Credits are accounting entries, not money. No script, no external file.
 */
export interface InvoiceBody {
  holder: string; fleet?: string; month: string; plan: string; contract?: string;
  usage: Record<string, number>;
  lines: { item: string; quantity: number; unit_price: number; amount: number }[];
  subtotal: number; tax: { name: string; rate_bp: number; amount: number }[]; total: number; currency: string; credits_applied?: number;
}

const esc = (t: unknown): string => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number): string => (n / 100).toFixed(2);

export function renderInvoiceHtml(o: { id: string; issued: string; body: InvoiceBody; matchesLog: boolean; differences?: string[] }): string {
  const b = o.body;
  const rows = b.lines.map((l) => `<tr><td>${esc(l.item)}</td><td class="n">${esc(l.quantity)}</td><td class="n">${money(l.unit_price)}</td><td class="n">${money(l.amount)}</td></tr>`).join("");
  const tax = b.tax.map((t) => `<tr><td colspan="3">${esc(t.name)} (${(t.rate_bp / 100).toFixed(2)} %)</td><td class="n">${money(t.amount)}</td></tr>`).join("");
  const usage = `${esc(b.usage.active_agents)} active agent(s), ${esc(b.usage.writes)} write(s), ${esc(b.usage.tokens)} token(s), ${esc(b.usage.storage_bytes)} byte(s) stored`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Statement of use ${esc(b.month)} for ${esc(b.holder)}</title>
<style>:root{--bg:#fff;--fg:#1a1a1a;--mut:#5a5a5a;--line:#d9d9d9;--warn:#8a3b00}@media (prefers-color-scheme:dark){:root:not([data-print]){--bg:#15171a;--fg:#e8e8e8;--mut:#a0a0a0;--line:#33373c;--warn:#ffb070}}@media print{:root{--bg:#fff;--fg:#000;--mut:#444;--line:#999;--warn:#000}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:46rem;padding:1.5rem 16px}h1{font-size:1.4rem;margin:0 0 .25rem}.mut{color:var(--mut)}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border-bottom:1px solid var(--line);padding:.4rem .5rem;text-align:left;overflow-wrap:anywhere}th.n,td.n{text-align:right;font-variant-numeric:tabular-nums}tfoot td{font-weight:600}.warn{color:var(--warn)}</style></head><body>
<h1>Statement of use</h1>
<p class="mut">${esc(o.id)}<br>issued ${esc(o.issued)} for ${esc(b.holder)}${b.fleet ? ` (fleet ${esc(b.fleet)})` : ""}, period ${esc(b.month)}, plan ${esc(b.plan)}${b.contract ? `, contract ${esc(b.contract)}` : ""}</p>
<table><thead><tr><th>Item</th><th class="n">Quantity</th><th class="n">Unit price (${esc(b.currency)})</th><th class="n">Amount (${esc(b.currency)})</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="3">Subtotal</td><td class="n">${money(b.subtotal)}</td></tr>${tax}<tr><td colspan="3">Total (${esc(b.currency)})</td><td class="n">${money(b.total)}</td></tr></tfoot></table>
${b.credits_applied ? `<p>Settled in part with ${esc(b.credits_applied)} purchased credit(s).</p>` : ""}
<p>Usage: ${usage}.</p>
<p class="${o.matchesLog ? "mut" : "warn"}" role="status">${o.matchesLog ? "The usage this statement states is what the log counts." : `The log now counts differently${o.differences?.length ? `: ${esc(o.differences.join("; "))}` : ""}.`}</p>
<p class="mut">This is a statement of use computed from the signed log. It is not a tax invoice or an e-invoice. Payment is arranged under the contract; credits are accounting entries, not money.</p>
</body></html>
`;
}
