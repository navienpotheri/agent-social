// The owner types the commands in his kits (the signing kit, the live block, the live-check kit, the incident drill) himself. Every `npm run asp --` command in them is a documented command, and every flag in them is
// in the CLI's own help and is an option that the parser knows, so a renamed flag cannot leave a kit that fails on the day. Same method as live-run-plan.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const KITS = ["docs/owner-sign-kit.md", "docs/owner-live-block.md", "docs/live-check-kit.md", "docs/incident-drill.md"].filter((p) => existsSync(new URL(p, root)));

test("every command in the owner's kits is a documented command, and every flag is one the CLI knows", async () => {
  const { main } = await import("../src/cli.ts");
  const out: string[] = [];
  await main(["help", "all"], { out: (l: string) => out.push(l), err() {}, env: {}, cwd: process.cwd() } as never);
  const help = out.join("\n") + "\n" + read("docs/commands.md");
  const src = read("packages/asp-cli/src/cli.ts");
  const missingCommands: string[] = [];
  const missingFlags: string[] = [];
  assert.ok(KITS.length >= 3);
  for (const kit of KITS) {
    for (const m of read(kit).matchAll(/npm run asp -- ([^`\n]+)/g)) {
      const cmd = m[1]!.split("#")[0]!.trim();
      const first = cmd.split(" ")[0]!;
      if (!first || first.startsWith("<") || first.startsWith("-")) continue;
      if (!(help.includes(`asp ${first}`) || help.includes(`\`asp ${first}`))) missingCommands.push(`${kit}: asp ${first}`);
      for (const f of cmd.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)) {
        const name = f[1]!;
        const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        if (!help.includes(`--${name}`)) missingFlags.push(`${kit}: --${name} not in the help`);
        else if (!(src.includes(`"${name}": {`) || src.includes(`  ${name}: {`) || src.includes(`  ${camel}: {`))) missingFlags.push(`${kit}: --${name} not an option of the parser`);
      }
    }
  }
  assert.deepEqual([...new Set(missingCommands)], []);
  assert.deepEqual([...new Set(missingFlags)], []);
});
