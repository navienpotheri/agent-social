/**
 * `asp society cohort smoke-endpoint` (open-model strand, ENG96): a 20-second test of a model endpoint that speaks the Anthropic Messages API (vLLM 0.11.1 and later and SGLang serve it at /v1/messages) before a long run: one request that should
 * come back as a tool call, then the tool result sent back and a reply read. It prints whether the endpoint was reached, whether a tool_use block came back and parsed, whether usage is present, the latency of each call, the first 200 characters of text and
 * a plain verdict. The key, if any, is read from the named environment variable and goes only in the request header; nothing is stored. The request is the same shape the cohort's own provider sends (model, max_tokens, system, messages, tools).
 */
export interface SmokeResult { reachable: boolean; toolUse: boolean; toolArgsParsed: boolean; usage: boolean; secondRoundTrip: boolean; latencyMs: number[]; text: string; verdict: string; problems: string[] }
export async function smokeEndpoint(o: { baseUrl: string; model: string; key?: string; maxTokens?: number; fetchImpl?: typeof fetch }): Promise<SmokeResult> {
  const base = o.baseUrl.replace(/\/+$/, ""), doFetch = o.fetchImpl ?? fetch, problems: string[] = [], latency: number[] = [];
  const tools = [{ name: "echo", description: "Repeat a short text back to the caller.", input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }];
  const call = async (messages: unknown[]): Promise<{ status: number; body?: { content?: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string } ; raw: string }> => {
    const t0 = Date.now();
    const res = await doFetch(`${base}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", ...(o.key ? { "x-api-key": o.key, authorization: `Bearer ${o.key}` } : {}) }, body: JSON.stringify({ model: o.model, max_tokens: o.maxTokens ?? 1000, system: "You are testing a connection. Use the tool when asked.", messages, tools }) });
    const raw = await res.text(); latency.push(Date.now() - t0);
    let body: never | undefined; try { body = JSON.parse(raw) as never; } catch { /* not JSON */ }
    return { status: res.status, ...(body ? { body } : {}), raw };
  };
  const fail = (verdict: string, extra: Partial<SmokeResult> = {}): SmokeResult => ({ reachable: false, toolUse: false, toolArgsParsed: false, usage: false, secondRoundTrip: false, latencyMs: latency, text: "", verdict, problems, ...extra });
  let r1;
  try { r1 = await call([{ role: "user", content: "Call the echo tool with the text hello, and nothing else." }]); } catch (e) { problems.push(`could not reach ${base}/v1/messages: ${(e as Error).message}`); return fail("NOT REACHABLE: the endpoint did not answer (is the tunnel up and the server running?)"); }
  if (r1.status >= 400 || !r1.body) { problems.push(`status ${r1.status}: ${r1.raw.slice(0, 200)}`); return fail(`REACHED BUT REFUSED: status ${r1.status}; the server may not serve /v1/messages, or the model name is wrong`, { reachable: true }); }
  const blocks = Array.isArray(r1.body.content) ? r1.body.content : [], tu = blocks.find((b) => b.type === "tool_use"), text1 = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ");
  const usage = typeof r1.body.usage?.input_tokens === "number" && typeof r1.body.usage?.output_tokens === "number";
  if (!usage) problems.push("the reply carries no usage (input_tokens, output_tokens): the cohort's cost and token caps would read zero");
  if (!tu) { problems.push(`no tool_use block came back (stop_reason ${r1.body.stop_reason ?? "none"}); the model answered in text, or the server's tool-call parser is not on`); return { reachable: true, toolUse: false, toolArgsParsed: false, usage, secondRoundTrip: false, latencyMs: latency, text: text1.slice(0, 200), verdict: "REACHED, BUT NO TOOL CALL: the cohort cannot run on this endpoint as served (check the tool-call parser flag, or use another model)", problems }; }
  const parsed = !!tu.id && typeof tu.input === "object" && tu.input !== null && typeof (tu.input as { text?: unknown }).text === "string";
  if (!parsed) problems.push("the tool_use block has no id or its input is not an object with the text field");
  const r2 = await call([{ role: "user", content: "Call the echo tool with the text hello, and nothing else." }, { role: "assistant", content: blocks }, { role: "user", content: [{ type: "tool_result", tool_use_id: tu.id ?? "x", content: "hello" }] }]);
  const ok2 = r2.status < 400 && !!r2.body && Array.isArray(r2.body.content);
  if (!ok2) problems.push(`the second request (the tool result sent back) failed: status ${r2.status}: ${r2.raw.slice(0, 200)}`);
  const text2 = ok2 ? (r2.body!.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ") : "";
  const good = parsed && ok2 && usage;
  return { reachable: true, toolUse: true, toolArgsParsed: parsed, usage, secondRoundTrip: ok2, latencyMs: latency, text: (text2 || text1).slice(0, 200), verdict: good ? "OK: the endpoint returns tool calls and takes tool results; a cohort run can start" : `PROBLEMS: ${problems.join("; ")}`, problems };
}
export function renderSmoke(r: SmokeResult, model: string, base: string): string {
  const yn = (b: boolean): string => (b ? "yes" : "NO");
  return [`Smoke test of ${base} (model ${model})`, `  reachable: ${yn(r.reachable)}`, `  tool_use returned: ${yn(r.toolUse)}`, `  tool arguments parsed: ${yn(r.toolArgsParsed)}`, `  usage present: ${yn(r.usage)}`, `  tool result round trip: ${yn(r.secondRoundTrip)}`, `  latency: ${r.latencyMs.map((x) => `${x} ms`).join(", ") || "n/a"}`, `  first text: ${JSON.stringify(r.text)}`, `Verdict: ${r.verdict}`].join("\n") + "\n";
}
