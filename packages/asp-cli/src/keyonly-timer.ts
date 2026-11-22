/**
 * The timer behind the sponsor-less review of `asp serve` (register rows DK542 and DK546): every `everyMs` it runs one review pass, never lets a failing pass stop the timer, does not start a pass while the last one
 * is still running, and stops when the server closes. The pass itself (`reviewKeyOnly`) is tested apart; this is the wiring around it, so that it can be tested without a service.
 */
import type { Server } from "node:http";

export interface KeyOnlyTimer { stop(): void; runs(): number }

export function startKeyOnlyReviewTimer(o: { everyMs: number; pass: () => Promise<void>; server: Pick<Server, "on">; onError?: (e: Error) => void }): KeyOnlyTimer {
  let running = false, n = 0;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try { n++; await o.pass(); } catch (e) { o.onError?.(e as Error); } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, Math.max(1, o.everyMs));
  timer.unref();
  const stop = () => clearInterval(timer);
  o.server.on("close", stop);
  return { stop, runs: () => n };
}
