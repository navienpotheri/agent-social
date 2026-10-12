/**
 * A request to the ASP services that waits out a rate limit (gap O16). The log service answers 429 with `Retry-After` before it runs anything,
 * so repeating the request is safe, for a read or a write. This waits the time it asks (at least a second, at most ten) and tries again, up to
 * `retries` more times, then returns the last response for the caller to report. Bodies must be strings or byte arrays, which can be sent twice.
 */
export async function fetchRetry(input: string | URL, init: RequestInit = {}, retries = 3): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(input, init);
    if (res.status !== 429 || attempt >= retries) return res;
    await res.arrayBuffer().catch(() => undefined); // let the connection go
    const wait = Math.min(Math.max(Number(res.headers.get("retry-after")) || 1, 1), 10);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}
