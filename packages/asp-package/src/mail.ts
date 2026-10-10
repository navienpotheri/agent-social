/**
 * The end-of-Mandate mail (gap E8, docs/live-beta-flow-1.md step 8): one mail per Mandate, highlights only, built from the signed log and (when the
 * run was kept) the run log. Pure text in, text out: this file makes the subject, a plain-text body and an HTML body, and the `.eml` that holds
 * both. It sends nothing; the CLI queues the `.eml` in an outbox folder and a delivery step (not built yet) would hand it to a mail provider.
 */
import type { RunLogCheck } from "./gateway/runlog.ts";

interface Stored { id: string; seq: number; record: { type: string; issuer: string; subject?: string | null; issued_at: string; body: any } }
/** The part of a log handle the mail needs. */
export interface MailLog {
  chain(contract: string): Promise<Stored[]>;
  chainInfo(contract: string): Promise<{ state: string | null } | undefined | null>;
  since(afterSeq: number, limit?: number): Promise<Stored[]>;
}

export interface MandateFacts {
  contract: { id: string; purpose: string; principal: string; performer: string; price?: { value: number; unit: string }; deadline?: string };
  state: string;
  mandate?: { id: string; issuedAt: string; expires?: string; scopes: string[]; hosts?: string[]; spendCap: number; unit: string; irreversible: string; gatedScopes: string[]; shareToCommons: boolean };
  activity: {
    actions: number;
    scopesUsed: { scope: string; actions: number }[];
    blocked: { scope: string; count: number }[];
    strikes: number;
    metrics: { requests: number; toolCalls: number; tokensIn: number; tokensOut: number; seconds: number; models: string[] };
    assurance: string[];
    runLogCommitments: number;
    /** The most run-log events any Action committed to; the run log may hold more, from after the last report that could be recorded. */
    runLogCommittedEvents: number;
    /** Reports made after the job ended, for its last moments (S80). */
    lateActions: number;
  };
  approvals: { kind: string; question: string; proposed?: string; answer: "approved" | "corrected" | "picked" | "refused (no answer in time)" | "no answer"; correction?: string }[];
  memory: { description: string; at: string }[];
  ending?: { basis: string; at: string; escrowReleased: number; bondReturned: number; bondSlashed: number; fees?: number; proRataPermille?: number; unit: string };
  evidence: { contractRecord: string; mandateRecord?: string; settlementRecord?: string; lastRecord: string; recordCount: number };
}

const STRENGTH = ["self_reported", "runtime_observed", "gateway_observed", "gateway_enforced", "hook_enforced", "sandbox_enforced"];

/** Reads everything the mail says out of the log. Returns undefined when the contract is not in it. */
export async function collectMandateFacts(log: MailLog, contract: string): Promise<MandateFacts | undefined> {
  const chain = await log.chain(contract);
  const first = chain.find((s) => s.record.type === "asp.contract/v0.2");
  if (!first) return undefined;
  const info = await log.chainInfo(contract);
  const cb = first.record.body;
  const mandateRec = chain.filter((s) => s.record.type === "asp.mandate/v0.2").at(-1);
  const mb = mandateRec?.record.body;
  const settlement = chain.filter((s) => s.record.type === "asp.settlement/v0.2").at(-1);
  const everything = await log.since(0, 1_000_000);
  const actions = everything.filter((s) => s.record.type === "asp.action/v0.2" && s.record.body.contract === contract);

  const used = new Map<string, number>();
  const blocked = new Map<string, number>();
  const metrics = { requests: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0, seconds: 0, models: new Set<string>() };
  const assurance = new Set<string>();
  let commitments = 0;
  let committedEvents = 0;
  let lateActions = 0;
  for (const a of actions) {
    const b = a.record.body;
    for (const s of b.scopes_used ?? []) used.set(s, (used.get(s) ?? 0) + 1);
    for (const x of b.blocked_attempts ?? []) blocked.set(x.scope, (blocked.get(x.scope) ?? 0) + x.count);
    const m = b.metrics;
    if (m) {
      metrics.requests += m.requests ?? 0; metrics.toolCalls += m.tool_calls ?? 0; metrics.tokensIn += m.tokens_in ?? 0; metrics.tokensOut += m.tokens_out ?? 0; metrics.seconds += m.seconds ?? 0;
      for (const x of m.models ?? []) metrics.models.add(x.provider ? `${x.name} (${x.provider})` : x.name);
    }
    if (b.assurance) assurance.add(b.assurance);
    if (b.late) lateActions++;
    for (const x of b.artifacts ?? []) {
      const m = /^asp:\/\/run-log\/(\d+)$/.exec(x.uri);
      if (m) { commitments++; committedEvents = Math.max(committedEvents, Number(m[1])); }
    }
  }

  const approvals: MandateFacts["approvals"] = [];
  for (const cp of chain.filter((s) => s.record.type === "asp.checkpoint/v0.2")) {
    const res = everything.find((s) => s.record.type === "asp.attestation/v0.2" && s.record.body.kind === "checkpoint_resolution" && s.record.body.about === cp.id);
    const verdict = res?.record.body.verdict as string | undefined;
    approvals.push({
      kind: cp.record.body.kind, question: cp.record.body.question, ...(cp.record.body.proposed_action ? { proposed: cp.record.body.proposed_action } : {}),
      answer: verdict === "approved" ? "approved" : verdict === "corrected" ? "corrected" : verdict === "picked" ? "picked" : verdict === "expired" ? "refused (no answer in time)" : "no answer",
      ...(verdict === "corrected" && res?.record.body.correction ? { correction: String(res.record.body.correction) } : {}),
    });
  }

  const from = Date.parse(mandateRec?.record.issued_at ?? first.record.issued_at);
  const to = Date.parse(settlement?.record.issued_at ?? "9999-01-01");
  const memory = everything
    .filter((s) => s.record.type === "asp.lineage/v0.2" && s.record.body.child === cb.performer && s.record.body.change?.layer === "memory"
      && Date.parse(s.record.issued_at) >= from && Date.parse(s.record.issued_at) <= to + 60_000)
    .map((s) => ({ description: String(s.record.body.change.description), at: s.record.issued_at }));

  const sb = settlement?.record.body;
  const last = chain.at(-1)!;
  return {
    contract: { id: contract, purpose: cb.purpose, principal: cb.principal, performer: cb.performer, ...(cb.price ? { price: cb.price } : {}), ...(cb.deadline ? { deadline: cb.deadline } : {}) },
    state: info?.state ?? "unknown",
    ...(mb ? { mandate: {
      id: mandateRec!.id, issuedAt: mandateRec!.record.issued_at, ...(mb.expires ? { expires: mb.expires } : {}), scopes: mb.scopes ?? [], ...(mb.network?.hosts ? { hosts: mb.network.hosts } : {}),
      spendCap: mb.spend?.cap ?? 0, unit: mb.spend?.unit ?? "credit", irreversible: mb.irreversible?.policy ?? "checkpoint", gatedScopes: mb.irreversible?.scopes ?? [], shareToCommons: !!mb.learning?.share_to_commons,
    } } : {}),
    activity: {
      actions: actions.length,
      scopesUsed: [...used].sort().map(([scope, n]) => ({ scope, actions: n })),
      blocked: [...blocked].sort().map(([scope, count]) => ({ scope, count })),
      strikes: [...blocked.values()].reduce((n, c) => n + c, 0),
      metrics: { ...metrics, models: [...metrics.models].sort() },
      assurance: [...assurance].sort((a, b) => STRENGTH.indexOf(b) - STRENGTH.indexOf(a)),
      runLogCommitments: commitments,
      runLogCommittedEvents: committedEvents,
      lateActions,
    },
    approvals,
    memory,
    ...(sb ? { ending: {
      basis: sb.basis, at: settlement!.record.issued_at, escrowReleased: sb.escrow_released?.value ?? 0, bondReturned: sb.bond_returned?.value ?? 0, bondSlashed: sb.bond_slashed?.value ?? 0,
      ...(sb.fees ? { fees: sb.fees.value } : {}), ...(typeof sb.pro_rata_permille === "number" ? { proRataPermille: sb.pro_rata_permille } : {}), unit: sb.escrow_released?.unit ?? "credit",
    } } : {}),
    evidence: { contractRecord: first.id, ...(mandateRec ? { mandateRecord: mandateRec.id } : {}), ...(settlement ? { settlementRecord: settlement.id } : {}), lastRecord: last.id, recordCount: chain.length },
  } satisfies MandateFacts;
}

export interface MailOptions {
  to: string;
  from?: string;
  /** The run log the gateway kept, checked; adds a section and its figures. Never its content: only counts and the first refusal. */
  runLog?: RunLogCheck & { path: string };
  /** Where the full run report and the run page live, when there is a dashboard. Without it the mail names the file on the machine that ran the job. */
  linkBase?: string;
}

export interface BuiltMail { subject: string; text: string; html: string; eml: string; highlights: string[] }

const short = (id: string) => (id.length > 24 ? `${id.slice(0, 19)}...` : id);
const num = (n: number) => n.toLocaleString("en-US");
const endedHow = (e: NonNullable<MandateFacts["ending"]>) => ({
  accepted: "the principal accepted the delivery", ruling: "a Court ruling decided it", revoked: "the principal revoked the Mandate", silence: "the principal did not answer in time, so the delivery was accepted",
}[e.basis] ?? e.basis);

/** The highlights and the three renderings of the mail. */
export function buildMandateMail(f: MandateFacts, o: MailOptions): BuiltMail {
  const a = f.activity;
  const ended = f.state === "Settled" && f.ending;
  const refusedCalls = o.runLog?.events.filter((e) => e.kind === "tool_call" && (e.data as any).allowed === false) ?? [];
  const firstRefusal = refusedCalls[0]?.data as any;
  const toolCalls = o.runLog?.events.filter((e) => e.kind === "tool_call").length;
  const masked = (o.runLog?.events.find((e) => e.kind === "run_end")?.data as any)?.redactions as number | undefined;

  const subject = ended ? `Your agent finished: ${f.contract.purpose}` : `Your agent's job is still running: ${f.contract.purpose}`;
  const sections: { title: string; lines: string[] }[] = [];

  sections.push({ title: "What it was asked", lines: [f.contract.purpose, `Agent ${f.contract.performer}${f.contract.price ? `, price ${num(f.contract.price.value)} ${f.contract.price.unit}` : ""}.`] });

  if (f.mandate) {
    const m = f.mandate;
    sections.push({ title: "What it was allowed", lines: [
      `Scopes: ${m.scopes.join(", ") || "none"}.`,
      ...(m.hosts ? [`Network access only to: ${m.hosts.join(", ")}.`] : []),
      `Spend cap: ${num(m.spendCap)} ${m.unit}.`,
      m.gatedScopes.length ? `Needed your approval first (${m.irreversible}): ${m.gatedScopes.join(", ")}.` : "Nothing needed your approval first.",
      m.shareToCommons ? "Lessons it learned could be shared to the commons." : "Lessons it learned stayed private.",
    ] });
  }

  const did: string[] = [];
  did.push(a.actions ? `${a.actions} report(s) of activity; scopes used: ${a.scopesUsed.map((s) => s.scope).join(", ") || "none"}.` : "No activity was reported.");
  if (a.metrics.requests) did.push(`${num(a.metrics.requests)} model request(s), ${num(a.metrics.toolCalls)} tool call(s), ${num(a.metrics.tokensIn + a.metrics.tokensOut)} tokens, about ${num(a.metrics.seconds)} s${a.metrics.models.length ? `; models: ${a.metrics.models.join(", ")}` : ""}.`);
  if (a.assurance.length) did.push(`How strongly it was held to the Mandate: ${a.assurance[0].replace(/_/g, " ")}${a.assurance[0] === "self_reported" ? " (the agent's own word)" : ""}.`);
  if (a.lateActions) did.push(`${a.lateActions} of those reports were made after the job had ended, for the agent's last moments; they are marked late in the log.`);
  sections.push({ title: "What it did", lines: did });

  const stopped: string[] = [];
  if (a.blocked.length) stopped.push(`${a.strikes} attempt(s) were blocked before they ran: ${a.blocked.map((b) => `${b.scope} x${b.count}`).join(", ")}.`);
  else stopped.push("Nothing was blocked.");
  if (firstRefusal) stopped.push(`First blocked call: ${firstRefusal.tool} (${firstRefusal.scope || "no scope"}), ${firstRefusal.reason ?? "outside the Mandate"}.`);
  sections.push({ title: "What was blocked", lines: stopped });

  if (f.approvals.length) {
    sections.push({ title: "What needed your approval", lines: f.approvals.map((p) => `${p.question}${p.proposed ? ` (${p.proposed})` : ""}: ${p.answer}${p.correction ? ` - ${p.correction}` : ""}.`) });
  }

  sections.push({ title: "What changed in its memory", lines: f.memory.length ? f.memory.map((m) => m.description) : ["Nothing."] });

  if (f.ending) {
    const e = f.ending;
    sections.push({ title: "How it ended", lines: [
      `${endedHow(e).replace(/^./, (c) => c.toUpperCase())}.`,
      `Paid to the agent: ${num(e.escrowReleased)} ${e.unit}. Bond returned: ${num(e.bondReturned)}. Bond lost: ${num(e.bondSlashed)}.${e.proRataPermille !== undefined ? ` Share paid for work done: ${e.proRataPermille / 10}%.` : ""}`,
    ] });
  } else sections.push({ title: "How it ended", lines: [`Not ended yet: the job is ${f.state}.`] });

  const check: string[] = [`Contract ${short(f.evidence.contractRecord)}${f.evidence.settlementRecord ? `, settlement ${short(f.evidence.settlementRecord)}` : ""}, last record ${short(f.evidence.lastRecord)} (${f.evidence.recordCount} records). Anyone can check these against the log.`];
  if (o.runLog) {
    check.push(o.runLog.ok
      ? `The run log has ${o.runLog.head.events} event(s) and checks out${toolCalls !== undefined ? ` (${toolCalls} tool call(s) in it)` : ""}${masked ? `; ${masked} secret-like value(s) were masked` : ""}. ${a.runLogCommitments} of the agent's reports commit to it.`
      : `The run log did NOT check out: ${o.runLog.problem}.`);
    if (o.runLog.ok && a.runLogCommitments > 0 && o.runLog.head.events > a.runLogCommittedEvents) {
      check.push(`${o.runLog.head.events - a.runLogCommittedEvents} event(s) at the end of the run log came after the last report the agent could record (a job that has ended takes no more reports), so the figures above may leave them out; the run log has them.`);
    }
    check.push(o.linkBase ? `Full run log:${o.linkBase.replace(/\/$/, "")}/run-log` : `Full run log, kept on the machine that ran the job: ${o.runLog.path}`);
  } else check.push("No run log was kept for this job.");
  if (o.linkBase) check.push(`Run page: ${o.linkBase.replace(/\/$/, "")}/#/job/${f.contract.id}`);
  sections.push({ title: "Check it", lines: check });

  const highlights = [
    ended ? `Ended: ${endedHow(f.ending!)}` : `Still ${f.state}`,
    a.blocked.length ? `${a.strikes} blocked attempt(s)` : "nothing blocked",
    f.approvals.length ? `${f.approvals.length} approval request(s)` : "no approvals needed",
    f.memory.length ? `${f.memory.length} memory change(s)` : "no memory changes",
  ];

  const text = [subject, "", highlights.join(" | "), "", ...sections.flatMap((s) => [s.title.toUpperCase(), ...s.lines.map((l) => `  ${l}`), ""]), "-- Agent Social. This mail has highlights only; the full record is in the log.", ""].join("\n");
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f4ef;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1d1b"><div style="max-width:620px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #e3e1d8;border-radius:12px;padding:24px"><h1 style="font-size:20px;margin:0 0 6px">${esc(subject)}</h1><p style="margin:0 0 18px;color:#5b5a54;font-size:14px">${esc(highlights.join("  ·  "))}</p>${sections.map((s) => `<h2 style="font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#5b5a54;margin:18px 0 6px">${esc(s.title)}</h2>${s.lines.map((l) => `<p style="margin:0 0 6px;font-size:15px;line-height:1.45">${esc(l)}</p>`).join("")}`).join("")}</div><p style="font-size:12px;color:#8a8980;margin:14px 4px">Agent Social. This mail has highlights only; the full record is in the log.</p></div></body></html>`;

  const boundary = "asp-" + Buffer.from(f.contract.id).toString("hex").slice(0, 16);
  const eml = [
    `From: ${o.from ?? "Agent Social <noreply@localhost>"}`, `To: ${o.to}`, `Subject: ${subject.replace(/[\r\n]+/g, " ")}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
    `X-ASP-Contract: ${f.contract.id}`, `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", Buffer.from(text).toString("base64").replace(/(.{76})/g, "$1\r\n"), "",
    `--${boundary}`, 'Content-Type: text/html; charset="utf-8"', "Content-Transfer-Encoding: base64", "", Buffer.from(html).toString("base64").replace(/(.{76})/g, "$1\r\n"), "",
    `--${boundary}--`, "",
  ].join("\r\n");
  return { subject, text, html, eml, highlights };
}

// ---------- alerts: the mails that do not wait for the end of the Mandate ----------

export type AlertKind = "killed" | "report_upheld" | "expired";
export interface MailAlert { key: string; kind: AlertKind; contract: string; at: string; detail: string; record: string }

/**
 * The events that get their own mail at once: a kill (the kill switch settles the job as revoked with the bond slashed), a report against the
 * agent that a panel upheld, and a Mandate whose expiry has passed while the job is still running. Each has a stable key, so it is mailed once.
 */
export async function findAlerts(log: MailLog, nowMs: number = Date.now()): Promise<MailAlert[]> {
  const all = await log.since(0, 1_000_000);
  const out: MailAlert[] = [];
  for (const s of all) {
    const b = s.record.body;
    if (s.record.type === "asp.settlement/v0.2" && b.basis === "revoked" && (b.bond_slashed?.value ?? 0) > 0) {
      out.push({ key: `alert:killed:${b.contract}`, kind: "killed", contract: b.contract, at: s.record.issued_at, record: s.id,
        detail: `The job was stopped by the kill switch: ${b.bond_slashed.value} ${b.bond_slashed.unit} of the agent's bond was slashed and the escrow went back to you.` });
    }
    if (s.record.type === "asp.attestation/v0.2" && b.kind === "report_ruling" && b.verdict === "upheld") {
      const report = all.find((x) => x.id === b.about);
      if (report) out.push({ key: `alert:report:${s.id}`, kind: "report_upheld", contract: report.record.body.about, at: s.record.issued_at, record: s.id,
        detail: `A report against the agent was upheld by a panel: ${((report.record.body.reasons as string[] | undefined) ?? []).join("; ") || "no reasons recorded"}.` });
    }
  }
  const latest = new Map<string, Stored>();
  for (const s of all) if (s.record.type === "asp.mandate/v0.2") latest.set(s.record.body.contract, s);
  for (const [contract, m] of latest) {
    const expires = m.record.body.expires as string | undefined;
    if (!expires || Date.parse(expires) > nowMs) continue;
    const state = (await log.chainInfo(contract))?.state;
    if (state === "Running" || state === "Checkpoint") out.push({ key: `alert:expired:${contract}`, kind: "expired", contract, at: expires, record: m.id,
      detail: `The Mandate expired on ${expires.slice(0, 10)} and the job is still ${state.toLowerCase()}. The agent should not be acting under it any more.` });
  }
  return out;
}

const ALERT_TITLE: Record<AlertKind, string> = {
  killed: "Your agent was stopped by the kill switch",
  report_upheld: "A report against your agent was upheld",
  expired: "Your agent's Mandate has expired",
};

/** A short mail for one alert: what happened, to which job, and what to check. Highlights only, like the end mail. */
export function buildAlertMail(a: MailAlert, f: MandateFacts, o: Pick<MailOptions, "to" | "from" | "linkBase">): BuiltMail {
  const subject = `${ALERT_TITLE[a.kind]}: ${f.contract.purpose}`;
  const lines = [
    a.detail,
    `Job: ${f.contract.purpose}. Agent: ${f.contract.performer}.`,
    ...(f.activity.blocked.length ? [`Before this, ${f.activity.strikes} attempt(s) were blocked: ${f.activity.blocked.map((b) => `${b.scope} x${b.count}`).join(", ")}.`] : []),
    `Check it: record ${short(a.record)} on contract ${short(f.evidence.contractRecord)}; anyone can verify them against the log.`,
    ...(o.linkBase ? [`Run page: ${o.linkBase.replace(/\/$/, "")}/#/job/${f.contract.id}`] : []),
  ];
  const text = [subject, "", ...lines.map((l) => `  ${l}`), "", "-- Agent Social. This is an alert; the end-of-job mail with the highlights follows when the job ends.", ""].join("\n");
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f4ef;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1d1b"><div style="max-width:620px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #e3e1d8;border-left:4px solid #b3261e;border-radius:12px;padding:24px"><h1 style="font-size:20px;margin:0 0 12px">${esc(subject)}</h1>${lines.map((l) => `<p style="margin:0 0 8px;font-size:15px;line-height:1.45">${esc(l)}</p>`).join("")}</div><p style="font-size:12px;color:#8a8980;margin:14px 4px">Agent Social. This is an alert; the end-of-job mail with the highlights follows when the job ends.</p></div></body></html>`;
  const boundary = "asp-" + Buffer.from(a.key).toString("hex").slice(0, 16);
  const b64 = (t: string) => Buffer.from(t).toString("base64").replace(/(.{76})/g, "$1\r\n");
  const eml = [
    `From: ${o.from ?? "Agent Social <noreply@localhost>"}`, `To: ${o.to}`, `Subject: ${subject.replace(/[\r\n]+/g, " ")}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
    `X-ASP-Contract: ${f.contract.id}`, `X-ASP-Alert: ${a.kind}`, "Importance: high", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", b64(text), "",
    `--${boundary}`, 'Content-Type: text/html; charset="utf-8"', "Content-Transfer-Encoding: base64", "", b64(html), "",
    `--${boundary}--`, "",
  ].join("\r\n");
  return { subject, text, html, eml, highlights: [a.detail] };
}
