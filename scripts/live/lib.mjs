// Shared helpers for the live-check scripts (docs/live-check-cli.md). Node only, so the same script runs on Windows, macOS and Linux.
// A script is a list of steps. A step is automatic (a check that passes or fails) or human (it says what to do and waits for Enter; `--yes` skips the wait for a dry run and says so in the report).
// The report is printed at the end and written to live-check-<name>-<date>.log in the current folder, with anything that looks like a token or key replaced, ready to paste into docs/live-run-checklist.md.
// Credits are accounting entries, not money. Nothing here uses a real model agent.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

export const redact = (t) => String(t)
  .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{12,}/g, "Bearer [token]")
  .replace(/\b(sk|rk|re|whsec|ghp|gho|xox[bap])[-_][A-Za-z0-9_-]{8,}/g, "[key]")
  .replace(/(?<!sha256:)\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");

export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const next = argv[i + 1]; if (next === undefined || next.startsWith("--")) out[k] = true; else { out[k] = next; i++; } } else out._.push(a);
  }
  return out;
}

export function session(name, opts = {}) {
  const lines = [], results = [];
  const yes = !!opts.yes;
  const say = (t) => { const s = redact(t); lines.push(s); console.log(s); };
  let n = 0;
  const api = {
    say,
    title(t) { say(`\n=== ${t} ===`); },
    /** An automatic check. fn returns true, or a string/false for a failure with a reason. */
    async check(what, fn) {
      n++;
      let ok = false, detail = "";
      try { const r = await fn(); ok = r === true || r === undefined; detail = ok ? "" : String(r === false ? "failed" : r); } catch (e) { detail = e.message; }
      results.push({ n, what, ok, human: false, detail });
      say(`${ok ? "PASS" : "FAIL"}  ${n}. ${what}${detail ? `  (${detail})` : ""}`);
      return ok;
    },
    /** A step only a person can do: says what to do, waits for Enter, then asks whether it worked (y/n). With --yes it is recorded as not done by a person. */
    async human(what, doThis) {
      n++;
      say(`\nSTEP ${n} (you): ${what}`);
      for (const l of [].concat(doThis)) say(`   ${l}`);
      if (yes) { results.push({ n, what, ok: true, human: true, detail: "skipped (--yes): not done by a person", skipped: true }); say(`SKIP  ${n}. (--yes: this step was not done by a person)`); return true; }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q) => new Promise((r) => rl.question(q, r));
      await ask("   Press Enter when done... ");
      const a = (await ask("   Did it work as described? (y/n) ")).trim().toLowerCase();
      const note = a === "y" ? "" : (await ask("   What happened instead? ")).trim();
      rl.close();
      const ok = a === "y";
      results.push({ n, what, ok, human: true, detail: note });
      say(`${ok ? "PASS" : "FAIL"}  ${n}. ${what}${note ? `  (${note})` : ""}`);
      return ok;
    },
    /** Runs a program and returns { code, out, err }; never throws. */
    run(cmd, argv, o = {}) {
      return new Promise((resolve) => {
        const c = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"], shell: false, ...o });
        let out = "", err = "";
        c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
        c.on("error", (e) => resolve({ code: -1, out, err: e.message }));
        c.on("close", (code) => resolve({ code: code ?? 1, out, err }));
      });
    },
    done() {
      const failed = results.filter((r) => !r.ok), skipped = results.filter((r) => r.skipped);
      say(`\n${failed.length ? `FAILED: ${failed.length} of ${results.length} steps failed` : `PASSED: ${results.length - skipped.length} of ${results.length} steps passed`}${skipped.length ? ` (${skipped.length} human step(s) skipped with --yes)` : ""}`);
      const stamp = new Date().toISOString().slice(0, 10);
      const md = [`### ${name} (${new Date().toISOString()})`, "", ...results.map((r) => `- ${r.ok ? (r.skipped ? "skipped" : "passed") : "FAILED"}: ${r.what}${r.detail ? ` (${redact(r.detail)})` : ""}`), ""].join("\n");
      const file = `live-check-${name}-${stamp}.log`;
      try { writeFileSync(file, lines.join("\n") + "\n\nPaste into docs/live-run-checklist.md:\n\n" + md); say(`Report written to ${file}`); } catch { /* the console has it */ }
      return failed.length ? 1 : 0;
    },
    results,
  };
  return api;
}
