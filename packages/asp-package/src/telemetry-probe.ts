/**
 * Read-only probes (instrumentation.md 13; register row DK195; spec-delta S342): a probe asks an agent for a probability about a proposition of a published probe set. It runs against a COPY of the agent's
 * package that is thrown away afterwards, so nothing it writes reaches the agent's memory, and the package digest is checked unchanged before and after. An answer is a whole number of permille (0 to
 * 1000): free text is refused, so nothing personal can enter the log through a probe.
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageDigest } from "./handback.ts";

export interface ProbeProposition { id: string }

export function runReadOnlyProbe(pkg: string, agent: string, propositions: readonly ProbeProposition[], answer: (workdir: string, proposition: ProbeProposition) => unknown): { answers: Record<string, number>; digest: string } {
  const before = packageDigest(pkg, agent);
  const answers: Record<string, number> = {};
  const work = mkdtempSync(join(tmpdir(), "asp-probe-"));
  try {
    cpSync(pkg, work, { recursive: true });
    for (const p of propositions) {
      const a = answer(work, p);
      if (typeof a !== "number" || !Number.isInteger(a) || a < 0 || a > 1000) throw new Error(`the answer to ${p.id} must be a whole number of permille from 0 to 1000: a probe takes no free text`);
      answers[p.id] = a;
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
  const after = packageDigest(pkg, agent);
  if (after !== before) throw new Error("a probe changed the agent's package: probes are read-only");
  return { answers, digest: after };
}
