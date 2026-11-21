/**
 * Untrusted flow (register row DK1713, follow-up 2): what an outward call carries is compared with what the agent has read. A tool result is data, whoever wrote it: a file, a ticket, a shell's output and a web page
 * all carry text that the principal did not write. The words of an injection cannot be listed (the detector does not generalise), but what an injection needs can: to make an agent do harm outward it has to put a
 * destination or a payload into the agent's hands, and the agent has to copy it into a call. So the gateway keeps the salient tokens of every tool result (a host, an address, an email, an IP, a shell command line, a long
 * opaque string) and, when an outward call carries one that neither the principal's own messages nor the Mandate's named hosts contain, the call is held for the principal, as after any untrusted text.
 * This is narrower than holding every outward call after every read, which holds most harmless work: a call that does not copy anything from what was read passes. It is not a guarantee: a destination spelled
 * out in pieces, or an attack that needs no copied token (a plain destructive call), is not found here; the Mandate bounds those.
 */

import { reachesOutward } from "./untrusted.ts";

/** Where a copied value can leave: the scopes that reach outward after untrusted text, and also a web read (a GET with the payload in its address leaves too) and a tool the Mandate granted by name (an email, a post). */
export const flowReachesOutward = (scope: string): boolean => reachesOutward(scope) || scope === "web.read" || scope.startsWith("web.") || scope.startsWith("tool.");

const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;
const HOST_RE = /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|xyz|ru|cn|info|biz|site|online|co|me|sh|ly|cc|tk|top|club|example|test|invalid|internal|local)\b(?::\d+)?/gi;
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g;
const OPAQUE_RE = /\b[A-Za-z0-9+/_-]{32,}={0,2}/g;
const CMD_RE = /\b(?:curl|wget|nc|ncat|scp|rsync|ssh|git\s+push|git\s+remote\s+add|sftp|ftp)\s+[^\n;&|]{4,}/gi;

/** The salient tokens of a text: what an outward call would have to copy to send something somewhere. Lower-cased, trailing punctuation removed. */
export function salientTokens(text: string): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => { const t = s.toLowerCase().replace(/[.,;:!?'")\]]+$/, ""); if (t.length >= 6) out.add(t); };
  for (const re of [URL_RE, HOST_RE, IP_RE, EMAIL_RE, OPAQUE_RE, CMD_RE]) for (const m of text.matchAll(re)) add(m[0]);
  // a host inside a URL counts on its own, so the call can name the host without the full address
  for (const m of text.matchAll(URL_RE)) { try { out.add(new URL(m[0]).host.toLowerCase()); } catch { /* not a URL */ } }
  return out;
}

/** The tokens of an outward call's arguments that come from what the agent read and not from its principal or the Mandate. Empty when none do. */
export function copiedFromUntrusted(args: unknown, read: Iterable<string>, own: { principalText: string; allowedHosts?: string[] }): string[] {
  const readSet = new Set(read);
  if (!readSet.size) return [];
  const argText = JSON.stringify(args ?? "").toLowerCase().replace(/\\"/g, '"');
  const mine = (own.principalText + " " + (own.allowedHosts ?? []).join(" ")).toLowerCase();
  const callTokens = salientTokens(argText);
  const hits: string[] = [];
  for (const t of readSet) {
    if (mine.includes(t)) continue;
    if (argText.includes(t) || callTokens.has(t)) hits.push(t);
  }
  return hits.slice(0, 5);
}

/** What the principal typed in a model request: the text of every user message, tool results left out (chat completions, Responses and Anthropic Messages). */
export function principalTexts(body: any): string[] {
  const out: string[] = [];
  const items: any[] = Array.isArray(body?.messages) ? body.messages : Array.isArray(body?.input) ? body.input : [];
  if (typeof body?.input === "string") out.push(body.input);
  for (const m of items) {
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") out.push(m.content);
    else if (Array.isArray(m.content)) for (const p of m.content) { if (typeof p === "string") out.push(p); else if ((p?.type === "text" || p?.type === "input_text") && typeof p.text === "string") out.push(p.text); }
  }
  return out;
}
