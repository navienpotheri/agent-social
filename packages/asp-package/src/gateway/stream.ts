/**
 * Live streaming through the gateway (docs/gateway-design.md, P1). Text and thinking are forwarded as they arrive;
 * a tool call is held back until it is complete, judged, and then either forwarded whole or dropped, so the agent
 * never receives a call it may not make and never sees half of one.
 */
import type { ServerResponse } from "node:http";
import type { ToolCall } from "./judge.ts";

/** Returns a refusal reason, or undefined to allow. May take a long time (an approval hold). */
export type Decide = (call: ToolCall) => Promise<string | undefined>;
export interface Counters { input: number; output: number }

export interface SseEvent { event?: string; data: string }

/** Reads a server-sent-events body one event at a time. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buf = "";
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    for (;;) {
      const i = buf.search(/\r?\n\r?\n/);
      if (i < 0) break;
      const raw = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
      const ev: SseEvent = { data: "" };
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith("event:")) ev.event = line.slice(6).trim();
        else if (line.startsWith("data:")) ev.data += (ev.data ? "\n" : "") + line.slice(5).replace(/^ /, "");
      }
      if (ev.data || ev.event) yield ev;
    }
    if (done) break;
  }
}

const refusalText = (calls: { name: string; reason: string }[]) =>
  calls.map((c) => `[ASP] The action "${c.name}" was not run: ${c.reason}. Continue without it.`).join("\n");

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : { input: v }; } catch { return { input: raw }; }
}

/** OpenAI-compatible chat completion chunks, built from a whole reply (used by tests as a stand-in provider). */
export function openaiChunks(reply: any): string[] {
  const out: string[] = [];
  const base = { id: reply.id, object: "chat.completion.chunk", created: reply.created, model: reply.model };
  const choice = reply.choices?.[0] ?? { message: {}, finish_reason: "stop" };
  const m = choice.message ?? {};
  out.push(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: m.content ?? "" }, finish_reason: null }] })}\n\n`);
  (m.tool_calls ?? []).forEach((tc: any, i: number) => {
    const args: string = tc.function?.arguments ?? "";
    out.push(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: tc.id, type: "function", function: { name: tc.function?.name, arguments: "" } }] }, finish_reason: null }] })}\n\n`);
    const mid = Math.ceil(args.length / 2);
    for (const part of [args.slice(0, mid), args.slice(mid)]) {
      out.push(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: part } }] }, finish_reason: null }] })}\n\n`);
    }
  });
  out.push(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason ?? "stop" }], ...(reply.usage ? { usage: reply.usage } : {}) })}\n\n`);
  out.push("data: [DONE]\n\n");
  return out;
}

/** Anthropic Messages events, built from a whole reply (used by tests as a stand-in provider). */
export function anthropicEvents(reply: any): string[] {
  const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const out: string[] = [];
  out.push(ev("message_start", { type: "message_start", message: { id: reply.id, type: "message", role: "assistant", model: reply.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: reply.usage?.input_tokens ?? 0, output_tokens: 0 } } }));
  (reply.content ?? []).forEach((b: any, i: number) => {
    if (b.type === "tool_use") {
      out.push(ev("content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }));
      const json = JSON.stringify(b.input ?? {});
      const mid = Math.ceil(json.length / 2);
      for (const part of [json.slice(0, mid), json.slice(mid)]) out.push(ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: part } }));
    } else if (b.type === "thinking") {
      out.push(ev("content_block_start", { type: "content_block_start", index: i, content_block: { type: "thinking", thinking: "" } }));
      out.push(ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "thinking_delta", thinking: b.thinking ?? "" } }));
      if (b.signature) out.push(ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "signature_delta", signature: b.signature } }));
    } else if (b.type === "text") {
      out.push(ev("content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } }));
      out.push(ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text ?? "" } }));
    } else {
      out.push(ev("content_block_start", { type: "content_block_start", index: i, content_block: b }));
    }
    out.push(ev("content_block_stop", { type: "content_block_stop", index: i }));
  });
  out.push(ev("message_delta", { type: "message_delta", delta: { stop_reason: reply.stop_reason ?? "end_turn", stop_sequence: reply.stop_sequence ?? null }, usage: { output_tokens: reply.usage?.output_tokens ?? 0 } }));
  out.push(ev("message_stop", { type: "message_stop" }));
  return out;
}

const write = (res: ServerResponse, text: string) => { res.write(text); };

/** Judges an OpenAI-compatible chat stream: content flows through, tool calls are held, judged and re-emitted or dropped. */
export async function relayOpenaiStream(body: ReadableStream<Uint8Array>, res: ServerResponse, decide: Decide, count: Counters): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const held = new Map<number, { id?: string; name: string; args: string }>();
  let base: Record<string, unknown> = {};
  for await (const ev of readSse(body)) {
    if (ev.data === "[DONE]") { write(res, "data: [DONE]\n\n"); break; }
    let chunk: any;
    try { chunk = JSON.parse(ev.data); } catch { write(res, `data: ${ev.data}\n\n`); continue; }
    base = { id: chunk.id, object: chunk.object, created: chunk.created, model: chunk.model };
    if (chunk.usage) { count.input += chunk.usage.prompt_tokens ?? 0; count.output += chunk.usage.completion_tokens ?? 0; }
    const choice = chunk.choices?.[0];
    const tcs = choice?.delta?.tool_calls;
    if (Array.isArray(tcs)) {
      for (const t of tcs) {
        const h = held.get(t.index ?? 0) ?? { name: "", args: "" };
        if (t.id) h.id = t.id;
        if (t.function?.name) h.name += t.function.name;
        if (t.function?.arguments) h.args += t.function.arguments;
        held.set(t.index ?? 0, h);
      }
      if (!choice.delta.content && !choice.delta.role && !choice.finish_reason) continue;
      delete choice.delta.tool_calls;
    }
    if (choice?.finish_reason) {
      // The reply is complete: judge what was held, then send the survivors, the refusal note and the finish.
      const kept: { index: number; h: { id?: string; name: string; args: string } }[] = [];
      const refused: { name: string; reason: string }[] = [];
      let n = 0;
      for (const [, h] of [...held].sort((a, b) => a[0] - b[0])) {
        const reason = await decide({ id: h.id, name: h.name, args: parseArgs(h.args) });
        if (reason) refused.push({ name: h.name, reason }); else kept.push({ index: n++, h });
      }
      for (const k of kept) {
        write(res, `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: k.index, id: k.h.id, type: "function", function: { name: k.h.name, arguments: k.h.args } }] }, finish_reason: null }] })}\n\n`);
      }
      if (refused.length) write(res, `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: "\n" + refusalText(refused) }, finish_reason: null }] })}\n\n`);
      if (!kept.length && choice.finish_reason === "tool_calls") choice.finish_reason = "stop";
      held.clear();
    }
    write(res, `data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end();
}

/** Judges an Anthropic Messages stream the same way, renumbering blocks so a dropped call leaves no gap. */
export async function relayAnthropicStream(body: ReadableStream<Uint8Array>, res: ServerResponse, decide: Decide, count: Counters): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const outIndex = new Map<number, number>();
  const held = new Map<number, { id: string; name: string; json: string }>();
  const refused: { name: string; reason: string }[] = [];
  let next = 0, toolKept = 0;
  for await (const e of readSse(body)) {
    let d: any;
    try { d = JSON.parse(e.data); } catch { write(res, `event: ${e.event ?? "message"}\ndata: ${e.data}\n\n`); continue; }
    switch (d.type) {
      case "message_start":
        count.input += d.message?.usage?.input_tokens ?? 0;
        write(res, ev("message_start", d));
        break;
      case "content_block_start":
        if (d.content_block?.type === "tool_use") { held.set(d.index, { id: d.content_block.id, name: d.content_block.name, json: "" }); break; }
        outIndex.set(d.index, next++);
        write(res, ev("content_block_start", { ...d, index: outIndex.get(d.index) }));
        break;
      case "content_block_delta": {
        const h = held.get(d.index);
        if (h) { if (d.delta?.type === "input_json_delta") h.json += d.delta.partial_json ?? ""; break; }
        write(res, ev("content_block_delta", { ...d, index: outIndex.get(d.index) ?? d.index }));
        break;
      }
      case "content_block_stop": {
        const h = held.get(d.index);
        if (!h) { write(res, ev("content_block_stop", { ...d, index: outIndex.get(d.index) ?? d.index })); break; }
        held.delete(d.index);
        const reason = await decide({ id: h.id, name: h.name, args: parseArgs(h.json) });
        if (reason) { refused.push({ name: h.name, reason }); break; }
        const i = next++;
        toolKept++;
        write(res, ev("content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: h.id, name: h.name, input: {} } }));
        write(res, ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: h.json || "{}" } }));
        write(res, ev("content_block_stop", { type: "content_block_stop", index: i }));
        break;
      }
      case "message_delta": {
        count.output += d.usage?.output_tokens ?? 0;
        if (refused.length) {
          const i = next++;
          write(res, ev("content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } }));
          write(res, ev("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: refusalText(refused) } }));
          write(res, ev("content_block_stop", { type: "content_block_stop", index: i }));
          if (!toolKept && d.delta?.stop_reason === "tool_use") d.delta.stop_reason = "end_turn";
        }
        write(res, ev("message_delta", d));
        break;
      }
      default:
        write(res, ev(d.type ?? e.event ?? "message", d));
    }
  }
  res.end();
}

// ---------------------------------------------------------------------------------------------------------------
// OpenAI Responses API (what current Codex speaks)

const CALL_ITEMS = new Set(["function_call", "local_shell_call", "custom_tool_call"]);

/** A tool call out of a Responses output item. */
export function callOfItem(item: any): ToolCall {
  if (item.type === "local_shell_call") return { id: item.call_id ?? item.id, name: "local_shell", args: { command: item.action?.command ?? [] } };
  if (item.type === "custom_tool_call") return { id: item.call_id ?? item.id, name: item.name ?? "custom", args: parseArgs(typeof item.input === "string" ? item.input : "") };
  return { id: item.call_id ?? item.id, name: item.name ?? "", args: parseArgs(item.arguments ?? "") };
}

const refusalItem = (n: number, text: string) => ({ id: `msg_asp_${n}`, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] });

/** Responses events built from a whole response (a stand-in provider for tests). */
export function responsesEvents(response: any): string[] {
  const out: string[] = [];
  let seq = 0;
  const ev = (o: any) => out.push(`event: ${o.type}\ndata: ${JSON.stringify({ ...o, sequence_number: seq++ })}\n\n`);
  ev({ type: "response.created", response: { ...response, status: "in_progress", output: [] } });
  (response.output ?? []).forEach((item: any, i: number) => {
    ev({ type: "response.output_item.added", output_index: i, item: { ...item, status: "in_progress" } });
    if (item.type === "function_call") {
      const half = Math.ceil((item.arguments ?? "").length / 2);
      for (const part of [(item.arguments ?? "").slice(0, half), (item.arguments ?? "").slice(half)]) ev({ type: "response.function_call_arguments.delta", output_index: i, item_id: item.id, delta: part });
      ev({ type: "response.function_call_arguments.done", output_index: i, item_id: item.id, arguments: item.arguments });
    } else if (item.type === "message") {
      (item.content ?? []).forEach((c: any, ci: number) => {
        ev({ type: "response.content_part.added", output_index: i, item_id: item.id, content_index: ci, part: { ...c, text: "" } });
        ev({ type: "response.output_text.delta", output_index: i, item_id: item.id, content_index: ci, delta: c.text });
        ev({ type: "response.content_part.done", output_index: i, item_id: item.id, content_index: ci, part: c });
      });
    }
    ev({ type: "response.output_item.done", output_index: i, item });
  });
  ev({ type: "response.completed", response });
  return out;
}

/** Judges a Responses stream: other items flow through, each tool call is held until its item is done, judged, then forwarded or dropped. */
export async function relayResponsesStream(body: ReadableStream<Uint8Array>, res: ServerResponse, decide: Decide, count: Counters): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  let seq = 0;
  const send = (o: any) => { write(res, `event: ${o.type}\ndata: ${JSON.stringify({ ...o, sequence_number: seq++ })}\n\n`); };
  const outIndex = new Map<number, number>();
  let next = 0;
  const mapIdx = (i: number) => { if (!outIndex.has(i)) outIndex.set(i, next++); return outIndex.get(i)!; };
  const held = new Map<number, any[]>();
  const refusedIdx = new Set<number>();
  const refused: { name: string; reason: string }[] = [];
  for await (const e of readSse(body)) {
    if (e.data === "[DONE]") break;
    let d: any;
    try { d = JSON.parse(e.data); } catch { continue; }
    const oi: number | undefined = typeof d.output_index === "number" ? d.output_index : undefined;
    if (d.type === "response.output_item.added" && CALL_ITEMS.has(d.item?.type)) { held.set(oi!, [d]); continue; }
    if (oi !== undefined && held.has(oi)) {
      const buf = held.get(oi)!;
      buf.push(d);
      if (d.type !== "response.output_item.done") continue;
      held.delete(oi);
      const call = callOfItem(d.item);
      const reason = await decide(call);
      if (reason) { refused.push({ name: call.name, reason }); refusedIdx.add(oi); continue; }
      for (const b of buf) send({ ...b, output_index: mapIdx(oi) });
      continue;
    }
    if (d.type === "response.completed" || d.type === "response.incomplete" || d.type === "response.failed") {
      const r = d.response ?? {};
      count.input += r.usage?.input_tokens ?? 0;
      count.output += r.usage?.output_tokens ?? 0;
      const output = (r.output ?? []).filter((_: any, i: number) => !refusedIdx.has(i));
      if (refused.length) {
        const i = next++;
        const item = refusalItem(i, refusalText(refused));
        send({ type: "response.output_item.added", output_index: i, item: { ...item, status: "in_progress", content: [] } });
        send({ type: "response.content_part.added", output_index: i, item_id: item.id, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
        send({ type: "response.output_text.delta", output_index: i, item_id: item.id, content_index: 0, delta: item.content[0].text });
        send({ type: "response.content_part.done", output_index: i, item_id: item.id, content_index: 0, part: item.content[0] });
        send({ type: "response.output_item.done", output_index: i, item });
        output.push(item);
      }
      send({ ...d, response: { ...r, output } });
      continue;
    }
    send(oi !== undefined ? { ...d, output_index: mapIdx(oi) } : d);
  }
  res.end();
}
