// Row DK380: a newcomer that has not had the Treasury's allowance is told in its standing note that the treasury_allowance tool exists; the note stays within 200 characters; the allowance command still says why it is not eligible yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { standingNote } from "../src/spend.ts";
import { makeFixture } from "./fixture.ts";

test("DK380: the standing note of a newcomer without the allowance names the treasury_allowance tool, within 200 characters", async () => {
  const f = makeFixture();
  const asp = async (args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root } as Io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const SPONSOR = "did:web:example.com:users:allowance-sponsor", AGENT = "did:web:example.com:agents:allowance-newcomer";
  assert.equal((await asp(["identity", "new", "--kind", "human", "--did", SPONSOR])).code, 0);
  assert.equal((await asp(["identity", "new", "--kind", "agent", "--did", AGENT, "--sponsor", SPONSOR, "--purpose", "work"])).code, 0);
  const log = await openLog(f.aspHome, {} as never);
  const note = await standingNote({ log, io: { out: () => {} }, now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), flags: { by: AGENT }, signerFor: () => { throw new Error("no key needed"); } });
  assert.match(note, /treasury_allowance/);
  assert.ok(note.length <= 200, `${note.length} characters`);
  assert.match(note, /not money/);
  const cmd = await asp(["treasury", "allowance", "--agent", AGENT]);
  assert.match(cmd.out, /not eligible yet|may be eligible/);
});
