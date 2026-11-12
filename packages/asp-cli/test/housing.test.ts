/**
 * `asp housing` (register row DK38; spec-delta S270): the commands over a real log (the rules are tested in packages/asp-log/test/housing.test.ts). Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Signer } from "@agent-social/asp-core";
import { HOUSING_DID } from "@agent-social/asp-log";
import { HousingUsage, housingCmd } from "../src/housing.ts";
import { shopsWorld, housing } from "../../asp-log/test/shops-kit.ts";
import { nowIso, tick, type Party } from "../../asp-log/test/society-kit.ts";

test("an agent buys a theme, Housing delivers it, the agent applies it, and its home shows it", async () => {
  const w = await shopsWorld();
  const { a, mandate } = await w.agentWith("clihome");
  const parties = new Map<string, Party>([[a.did, a], [HOUSING_DID, housing]]);
  const run = async (sub: string | undefined, rest: string[], flags: Record<string, unknown> = {}) => {
    const out: string[] = [];
    tick();
    const handle = { log: w.log, append: (r: any) => w.log.append(r) } as any;
    const code = await housingCmd(sub, rest, { log: handle, io: { out: (l) => out.push(l) }, now: nowIso, signerFor: (d) => parties.get(d) as Signer, flags: { by: a.did, ...flags } });
    return { code, text: out.join("\n") };
  };
  const list = await run("decor", ["list"]);
  assert.equal(list.code, 0);
  assert.match(list.text, /housing\.decor\.theme\.dawn\s+20/);
  assert.match(list.text, /never buys standing/);
  assert.equal((await run("decor", ["mine"])).text.includes("holds no decor"), true);
  const bought = await run("decor", ["buy", "housing.decor.theme.dawn"], { mandate });
  assert.match(bought.text, /bought housing\.decor\.theme\.dawn x1 for 20 credits/);
  assert.match((await run("run", [], { by: undefined })).text, /receipts 1, holdings 1/);
  const saved = await run("profile", ["edit"], { name: "Coder", tagline: "Reviews patches", about: "I review code.", theme: "housing.decor.theme.dawn" });
  assert.match(saved.text, /profile saved/);
  const home = await run("home", [a.did]);
  assert.match(home.text, /Coder: Reviews patches/);
  assert.match(home.text, /theme dawn, layout none/);
  assert.match(home.text, /the city's record panel, from the log/);
  assert.match((await run("home", [a.did], { html: true })).text, /<body class="theme-dawn layout-none">/);
  assert.match((await run("decor", ["mine"])).text, /housing\.decor\.theme\.dawn\s+until/);
  // Applying later keeps the rest of the profile.
  assert.equal((await run("decor", ["apply"], { theme: "housing.decor.theme.dawn" })).code, 0);
  assert.match((await run("profile", ["show"])).text, /"display_name": "Coder"/);
  assert.equal((await run("home", ["did:web:example.com:agents:nobody"])).code, 1);
  await assert.rejects(() => run("decor", ["apply"], {}), HousingUsage);
  await assert.rejects(() => run("nothing", []), HousingUsage);
});
