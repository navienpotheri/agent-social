/**
 * What a runtime's live output says about a run, as run-log events (gap E5, E7): the text the agent wrote, each tool call with its input, each
 * tool's result, and how the run ended. One parser per output format; a line that says nothing worth keeping gives `[]`. The recorder masks
 * secrets and cuts long text, so these functions only choose what to keep.
 */

export interface LineEvent { kind: string; data: Record<string, unknown> }

const parse = (line: string): any | undefined => {
  if (!line.startsWith("{")) return undefined;
  try { return JSON.parse(line); } catch { return undefined; }
};
const textOf = (c: unknown): string => {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p: any) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).filter(Boolean).join("\n");
  return "";
};
const inputText = (input: unknown): string => {
  const o = input as Record<string, unknown> | undefined;
  for (const k of ["command", "cmd", "file_path", "path", "url", "pattern", "query"]) if (typeof o?.[k] === "string") return o[k] as string;
  return JSON.stringify(input ?? {});
};

/** Claude Code, `--output-format stream-json`. */
export function claudeCodeRunLogEvents(line: string): LineEvent[] {
  const o = parse(line);
  if (!o) return [];
  if (o.type === "assistant" && Array.isArray(o.message?.content)) {
    return o.message.content.flatMap((b: any): LineEvent[] => {
      if (b?.type === "text" && b.text) return [{ kind: "assistant_text", data: { text: b.text } }];
      if (b?.type === "tool_use") return [{ kind: "tool_call", data: { tool: b.name, id: b.id, input: inputText(b.input) } }];
      return [];
    });
  }
  if (o.type === "user" && Array.isArray(o.message?.content)) {
    return o.message.content.filter((b: any) => b?.type === "tool_result").map((b: any): LineEvent => {
      const text = textOf(b.content);
      return { kind: "tool_result", data: { id: b.tool_use_id, text, ...(b.is_error ? { error: true } : {}), ...(text.includes("ASP Mandate") ? { blocked: true } : {}) } };
    });
  }
  if (o.type === "result") {
    return [{ kind: "run_result", data: { status: o.subtype ?? (o.is_error ? "error" : "success"), turns: o.num_turns, ms: o.duration_ms, tokens_in: o.usage?.input_tokens, tokens_out: o.usage?.output_tokens, ...(typeof o.total_cost_usd === "number" ? { cost_usd: o.total_cost_usd } : {}) } }];
  }
  return [];
}

/** Codex, `codex exec --json`: one item per line, written when it starts and again when it completes; only completed ones are kept. */
export function codexRunLogEvents(line: string): LineEvent[] {
  const o = parse(line);
  if (!o) return [];
  if (o.type === "turn.completed") return [{ kind: "run_result", data: { tokens_in: o.usage?.input_tokens, tokens_out: o.usage?.output_tokens } }];
  if (o.type !== "item.completed" || !o.item) return [];
  const it = o.item;
  switch (it.type) {
    case "agent_message": return it.text ? [{ kind: "assistant_text", data: { text: it.text } }] : [];
    case "command_execution": return [
      { kind: "tool_call", data: { tool: "shell", id: it.id, input: it.command } },
      { kind: "tool_result", data: { id: it.id, text: it.aggregated_output ?? "", ...(typeof it.exit_code === "number" && it.exit_code !== 0 ? { error: true, exit_code: it.exit_code } : {}) } },
    ];
    case "mcp_tool_call": return [
      { kind: "tool_call", data: { tool: `mcp__${it.server}__${it.tool}`, id: it.id, input: JSON.stringify(it.arguments ?? {}) } },
      { kind: "tool_result", data: { id: it.id, text: textOf(it.result?.content) || (it.error ? JSON.stringify(it.error) : ""), ...(it.error ? { error: true } : {}) } },
    ];
    case "file_change": return [{ kind: "tool_call", data: { tool: "file_change", id: it.id, input: (it.changes ?? []).map((c: any) => `${c.kind} ${c.path}`).join(", ") } }];
    case "web_search": return [{ kind: "tool_call", data: { tool: "web_search", id: it.id, input: it.query ?? "" } }];
    default: return [];
  }
}
