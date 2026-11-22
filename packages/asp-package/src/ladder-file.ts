/**
 * The ladder step an agent stands on, read from a file at every call (DK211; `asp gateway --ladder-file <path>`). The file is written by the operator or the watcher, never by the agent, and holds
 * `{ "step": "none" | "warn" | "tighten" | "quarantine" | "review" }`. A missing file is no step. A file that cannot be read or does not say a step is read as `tighten`: an unreadable file must not
 * switch the check off, and it must not quarantine an agent either, so it holds what reaches outside the project for the principal's approval until the file is whole.
 */
import { existsSync, readFileSync } from "node:fs";
import type { LadderStep } from "./circumvention.ts";

const STEPS: readonly LadderStep[] = ["none", "warn", "tighten", "quarantine", "review"];

export function readLadderFile(path: string): LadderStep {
  if (!existsSync(path)) return "none";
  try {
    const step = (JSON.parse(readFileSync(path, "utf8")) as { step?: unknown }).step;
    return typeof step === "string" && (STEPS as readonly string[]).includes(step) ? (step as LadderStep) : "tighten";
  } catch {
    return "tighten";
  }
}
