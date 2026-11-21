import { readFileSync } from "node:fs";

export interface RegRow { id: string; pri: string; status: string; gap: string }

/** Every register row that is not closed, by the rule scope.test.ts uses (the status is the last cell); the "Partial" view table is skipped, the section row is the row. */
export function nonClosedRows(registryText: string): RegRow[] {
  const byId = new Map<string, RegRow>();
  let sec = "";
  for (const ln of registryText.split("\n")) {
    if (ln.startsWith("## ")) sec = ln.slice(3).trim();
    const m = /^\| ([A-Z]{1,3}\d+[a-z]?) \|/.exec(ln);
    if (!m || sec.startsWith("Partial")) continue;
    const c = ln.trimEnd().replace(/^\||\|$/g, "").split(" | ").map((x) => x.trim());
    const last = c[c.length - 1]!;
    const t = /\|\s*(A|B|C)\s*\|\s*(open|designed|partial|closed)\s*\|?\s*(closed)?\s*\|?\s*$/.exec(ln);
    const status = ["open", "partial", "designed", "closed"].includes(last) ? last : t ? (t[3] ?? t[2]!) : "closed";
    const pris = [...ln.matchAll(/\| (A|B|C) \|/g)];
    const pri = pris.length ? pris[pris.length - 1]![1]! : "?";
    byId.set(m[1]!, { id: m[1]!, pri, status, gap: c[1] ?? "" });
  }
  return [...byId.values()].filter((r) => r.status !== "closed");
}

export const readRegister = (root: URL): string => readFileSync(new URL("docs/gaps-register.md", root), "utf8");
