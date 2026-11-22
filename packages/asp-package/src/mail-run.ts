/**
 * The mail at the end of a governed run (register row ML1; a run through `asp run <runtime>`): the end-of-Mandate mail waits for a Settled contract, and a governed run does not settle one (it works under a standing job
 * and leaves signed Action reports). This file reads the END OF A RUN from the log instead: the final Action report that `asp run` signs when the runtime exits (its summary is "<runtime> run, <folder>", with
 * ", killed mid-run" when the run was stopped for a violation), and builds one mail for it: what the agent was asked and allowed, what it did, what was refused (each blocked scope, with its count and targets), an
 * ESTIMATE of what the model tokens cost, and how the run ended. Pure text in, text out; it sends nothing (the CLI queues it, the service's mailer sends it, each once for each run).
 *
 * What it does not say: nothing about delivery (a mail may not arrive; the log is the record), nothing about a study, and credits only as mock accounting entries.
 */
import { costUsd, isPricedModel, priceFor } from "./gateway/pricing.ts";
import type { BuiltMail, MailLog, MailOptions } from "./mail.ts";

interface Stored { id: string; seq: number; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: any } }

export interface RunEnd { key: string; action: string; contract: string; at: string; /** The runtime, when the summary names it (a governed run's gateway report does not: null). */ runtime: string | null; killed: boolean; /** Why the gateway stopped the run, when it did. */ stopped?: string; late: boolean }

/** The two summaries the CLI gives the final Action of a run: a governed run through the gateway (`asp run <runtime>`): "ASP gateway (<mode>, exit): <n> request(s) so far, ...[; stopped: <reason>]"; and a run with `--contract`: "<runtime> run, <folder>[, killed mid-run]". */
const GATEWAY_END = /^ASP gateway \(.*, exit\): /;
const RUN_END = /^([a-z0-9][a-z0-9._-]*) run, /;

export function runEndOf(s: Stored): RunEnd | undefined {
  if (s.record.type !== "asp.action/v0.2") return undefined;
  const b = s.record.body as { contract?: string; summary?: string; late?: unknown };
  const sum = typeof b.summary === "string" ? b.summary : "";
  if (!b.contract) return undefined;
  if (GATEWAY_END.test(sum)) {
    const stopped = /; stopped: (.+)$/.exec(sum)?.[1];
    return { key: `run:${s.id}`, action: s.id, contract: b.contract, at: s.record.issued_at, runtime: null, killed: !!stopped, ...(stopped ? { stopped } : {}), late: !!b.late };
  }
  const m = RUN_END.exec(sum);
  if (!m) return undefined;
  return { key: `run:${s.id}`, action: s.id, contract: b.contract, at: s.record.issued_at, runtime: m[1]!, killed: /, killed mid-run$/.test(sum), late: !!b.late };
}

/** Every end of a run the log holds, oldest first. */
export async function findRunEnds(log: MailLog): Promise<RunEnd[]> {
  return (await log.since(0, 1_000_000)).map(runEndOf).filter((x): x is RunEnd => !!x);
}

export interface RunEndFacts {
  end: RunEnd;
  contract: { id: string; purpose: string; principal: string; performer: string };
  mandate?: { scopes: string[]; hosts?: string[]; spendCap: number; unit: string };
  scopesUsed: string[];
  blocked: { scope: string; count: number; targets?: string[] }[];
  rateLimited: number;
  metrics: { requests: number; toolCalls: number; tokensIn: number; tokensOut: number; seconds: number; models: string[] };
  assurance?: string;
  runLog?: { events: number };
  /** An estimate from the price table, never the provider's bill; `priced` is false when the model is not in the table (the default price was used). */
  cost?: { usd: number; model: string | null; priced: boolean };
  summary: string;
}

export async function collectRunEndFacts(log: MailLog, end: RunEnd): Promise<RunEndFacts | undefined> {
  const chain = await log.chain(end.contract);
  const first = chain.find((s) => s.record.type === "asp.contract/v0.2");
  if (!first) return undefined;
  const act = (await log.since(0, 1_000_000)).find((s) => s.id === end.action);
  if (!act) return undefined;
  const b = act.record.body;
  const mb = chain.filter((s) => s.record.type === "asp.mandate/v0.2").at(-1)?.record.body;
  const m = b.metrics ?? {};
  const models = (m.models ?? []).map((x: { name: string }) => x.name as string);
  const tIn = m.tokens_in ?? 0, tOut = m.tokens_out ?? 0;
  const model = models[0] ?? null;
  const events = (b.artifacts ?? []).map((x: { uri: string }) => /^asp:\/\/run-log\/(\d+)/.exec(x.uri)).filter(Boolean).map((x: RegExpExecArray) => Number(x[1])).sort((x: number, y: number) => y - x)[0];
  return {
    end,
    contract: { id: end.contract, purpose: first.record.body.purpose, principal: first.record.body.principal, performer: first.record.body.performer },
    ...(mb ? { mandate: { scopes: mb.scopes ?? [], ...(mb.network?.hosts ? { hosts: mb.network.hosts } : {}), spendCap: mb.spend?.cap ?? 0, unit: mb.spend?.unit ?? "credit" } } : {}),
    scopesUsed: [...(b.scopes_used ?? [])].sort(),
    blocked: (b.blocked_attempts ?? []).map((x: { scope: string; count: number; targets?: string[] }) => ({ scope: x.scope, count: x.count, ...(x.targets?.length ? { targets: x.targets } : {}) })),
    rateLimited: m.rate_limited ?? 0,
    metrics: { requests: m.requests ?? 0, toolCalls: m.tool_calls ?? 0, tokensIn: tIn, tokensOut: tOut, seconds: m.seconds ?? 0, models },
    ...(b.assurance ? { assurance: b.assurance } : {}),
    ...(events !== undefined ? { runLog: { events } } : {}),
    ...(tIn + tOut > 0 ? { cost: { usd: costUsd(tIn, tOut, priceFor(model)), model, priced: isPricedModel(model) } } : {}),
    summary: String(b.summary ?? ""),
  };
}

const num = (n: number) => n.toLocaleString("en-US");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (id: string) => (id.length > 24 ? `${id.slice(0, 19)}...` : id);

export function buildRunEndMail(f: RunEndFacts, o: Pick<MailOptions, "to" | "from" | "linkBase">): BuiltMail {
  const subject = f.end.killed ? `Your agent's run was stopped: ${f.contract.purpose}` : `Your agent's run ended: ${f.contract.purpose}`;
  const sections: { title: string; lines: string[] }[] = [];
  sections.push({ title: "What it was asked", lines: [f.contract.purpose, `Agent ${f.contract.performer}${f.end.runtime ? `, run with ${f.end.runtime}` : ", run through the gateway"}.`] });
  if (f.mandate) sections.push({ title: "What it was allowed", lines: [
    `Scopes: ${f.mandate.scopes.join(", ") || "none"}.`,
    ...(f.mandate.hosts ? [`Network access only to: ${f.mandate.hosts.join(", ")}.`] : []),
    `Spend cap: ${num(f.mandate.spendCap)} ${f.mandate.unit} (mock accounting entries, not money).`,
  ] });
  const m = f.metrics;
  const did = [`Scopes used in this run: ${f.scopesUsed.join(", ") || "none"}.`];
  if (m.requests || m.toolCalls) did.push(`${num(m.requests)} model request(s), ${num(m.toolCalls)} tool call(s), ${num(m.tokensIn + m.tokensOut)} tokens${m.seconds ? `, about ${num(m.seconds)} s` : ""}${m.models.length ? `; models: ${m.models.join(", ")}` : ""}.`);
  if (f.assurance) did.push(`How strongly it was held to the Mandate: ${f.assurance.replace(/_/g, " ")}${f.assurance === "self_reported" ? " (the agent's own word)" : ""}.`);
  sections.push({ title: "What it did", lines: did });
  const stopped: string[] = [];
  if (f.blocked.length) {
    const n = f.blocked.reduce((a, b) => a + b.count, 0);
    stopped.push(`${n} attempt(s) were refused before they ran:`);
    for (const b of f.blocked) stopped.push(`${b.scope} x${b.count}${b.targets?.length ? ` (${b.targets.slice(0, 5).join(", ")}${b.targets.length > 5 ? ", ..." : ""})` : ""}`);
  } else stopped.push("Nothing was refused.");
  if (f.rateLimited) stopped.push(`${f.rateLimited} network call(s) were refused for going over the rate limit.`);
  sections.push({ title: "What was refused", lines: stopped });
  if (f.cost) sections.push({ title: "What it cost (an estimate)", lines: [
    `About $${f.cost.usd.toFixed(2)} for ${num(m.tokensIn + m.tokensOut)} tokens${f.cost.model ? ` of ${f.cost.model}` : ""}, from a price table${f.cost.priced ? "" : " (this model is not in the table, so a default price was used)"}. It is an estimate, not your provider's bill; check the provider's own usage page.`,
  ] });
  sections.push({ title: "How it ended", lines: [
    f.end.killed ? (f.end.stopped ? `The run was stopped by the gateway: ${f.end.stopped}.` : "The run was stopped by the gateway for a Mandate violation; nothing was written back.") : "The runtime exited and the run's final report was signed.",
    ...(f.end.late ? ["The report was made after the job had ended, for the agent's last moments."] : []),
  ] });
  const check = [`Report ${short(f.end.action)} on contract ${short(f.contract.id)}, signed at ${f.end.at}. Anyone can check the signed records with asp verify.`];
  if (f.runLog) check.push(`The report commits to a run log of ${num(f.runLog.events)} event(s); the full log stays on the machine that ran it.`);
  if (o.linkBase) check.push(`Run page: ${o.linkBase.replace(/\/$/, "")}/#/job/${f.contract.id}`);
  sections.push({ title: "Check it", lines: check });
  const highlights = [f.end.killed ? "stopped for a violation" : "ended", f.blocked.length ? `${f.blocked.reduce((a, b) => a + b.count, 0)} refused` : "nothing refused", ...(f.cost ? [`about $${f.cost.usd.toFixed(2)} (estimate)`] : [])];
  const text = [subject, "", highlights.join(" | "), "", ...sections.flatMap((s) => [s.title.toUpperCase(), ...s.lines.map((l) => `  ${l}`), ""]), "-- Agent Social. This mail has highlights only; the signed log is the record. A mail may not arrive; nothing here depends on it.", ""].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f4ef;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1d1b"><div style="max-width:620px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #e6e3da;border-radius:10px;padding:20px"><h1 style="font-size:18px;margin:0 0 8px">${esc(subject)}</h1><p style="margin:0 0 16px;color:#555">${esc(highlights.join(" | "))}</p>${sections.map((s) => `<h2 style="font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#555;margin:16px 0 4px">${esc(s.title)}</h2>${s.lines.map((l) => `<p style="margin:2px 0">${esc(l)}</p>`).join("")}`).join("")}<p style="margin:20px 0 0;color:#777;font-size:12px">Agent Social. Highlights only; the signed log is the record. A mail may not arrive; nothing here depends on it.</p></div></div></body></html>`;
  const boundary = "asp-" + Buffer.from(f.end.action).toString("hex").slice(0, 16);
  const eml = [
    `From: ${o.from ?? "Agent Social <noreply@localhost>"}`, `To: ${o.to}`, `Subject: ${subject.replace(/[\r\n]+/g, " ")}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
    `X-ASP-Contract: ${f.contract.id}`, `X-ASP-Run-End: ${f.end.action}`, `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", Buffer.from(text).toString("base64").replace(/(.{76})/g, "$1\r\n"), "",
    `--${boundary}`, 'Content-Type: text/html; charset="utf-8"', "Content-Transfer-Encoding: base64", "", Buffer.from(html).toString("base64").replace(/(.{76})/g, "$1\r\n"), "",
    `--${boundary}--`, "",
  ].join("\r\n");
  return { subject, text, html, eml, highlights };
}
