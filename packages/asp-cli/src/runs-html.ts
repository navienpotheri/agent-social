/**
 * The sessions of this machine as one self-contained page a person can read, keep or print (E8): `asp runs --html-file <file>`. One row for each session: when, runtime, how it ended, the calls judged and refused with each
 * refusal's reason, the tokens, and what the person asked. Read from the sessions index on this machine; nothing is sent anywhere. No script, no external file; every text is escaped. Credits are accounting entries, not money.
 */
export interface RunsPageRow { sid: string; at: string; runtime: string; agent: string; purpose: string; state: string; calls?: number; refused: string[]; tokens?: number; stopped?: string; exitCode?: number; runLog?: string }

const esc = (t: unknown): string => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderRunsHtml(o: { rows: RunsPageRow[]; generated: string; machine?: string }): string {
  const refusedTotal = o.rows.reduce((n, r) => n + r.refused.length, 0);
  const body = o.rows.map((r) => `<tr><td><code>${esc(r.sid)}</code><br><span class="mut">${esc(r.at)}</span></td><td>${esc(r.runtime)}<br><span class="mut">${esc(r.agent)}</span></td><td>${esc(r.state)}${r.exitCode !== undefined ? ` <span class="mut">(exit ${esc(r.exitCode)})</span>` : ""}</td><td class="n">${r.calls === undefined ? "?" : esc(r.calls)}</td><td class="n">${esc(r.refused.length)}</td><td class="n">${r.tokens === undefined ? "?" : esc(r.tokens)}</td><td>${esc(r.purpose)}${r.refused.length ? `<ul>${r.refused.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${r.stopped ? `<p class="warn">${esc(r.stopped)}</p>` : ""}${r.runLog ? `<p class="mut">run log: ${esc(r.runLog)}</p>` : ""}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>What my agents did</title>
<style>:root{--bg:#fff;--fg:#1a1a1a;--mut:#5a5a5a;--line:#d9d9d9;--warn:#8a3b00}@media (prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e8e8e8;--mut:#a0a0a0;--line:#33373c;--warn:#ffb070}}@media print{:root{--bg:#fff;--fg:#000;--mut:#444;--line:#999;--warn:#000}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:64rem;padding:1.5rem 16px}h1{font-size:1.4rem;margin:0 0 .25rem}.mut{color:var(--mut);font-size:.9rem}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border-bottom:1px solid var(--line);padding:.4rem .5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}th.n,td.n{text-align:right;font-variant-numeric:tabular-nums}ul{margin:.25rem 0 0 1.1rem;padding:0}.warn{color:var(--warn);margin:.25rem 0 0}@media (max-width:40rem){th:nth-child(5),td:nth-child(5),th:nth-child(6),td:nth-child(6){display:none}}</style></head><body>
<h1>What my agents did</h1>
<p class="mut">${esc(o.rows.length)} session(s) on ${esc(o.machine ?? "this machine")}, ${esc(refusedTotal)} call(s) refused in all. Generated ${esc(o.generated)}. This is the sessions index of this machine; the signed record of a job is in the log (<code>asp run-log verify</code> checks a run log).</p>
${o.rows.length ? `<table><thead><tr><th>Session</th><th>Runtime</th><th>Ended</th><th class="n">Calls</th><th class="n">Refused</th><th class="n">Tokens</th><th>What was asked, and what was refused</th></tr></thead><tbody>${body}</tbody></table>` : "<p>No sessions yet.</p>"}
<p class="mut">Credits are accounting entries, not money. A refusal is a call the gateway did not run; the reason is the one it gave the agent.</p>
</body></html>
`;
}
