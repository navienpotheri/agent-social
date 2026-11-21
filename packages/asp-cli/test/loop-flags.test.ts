// DK1230 (S1422): the Mandate command takes the loop limits and the token budget as flags and refuses nonsense in plain words; the limits reach the Mandate record the log stores and a gateway reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const P = "did:web:example.com:users:lf-principal", A = "did:web:example.com:agents:lf-agent", BANK = "did:web:example.com:bank";

test("asp market mandate carries --loop-equivalent, --loop-depth and --tokens-per-day/run/month into the Mandate, and refuses values that cannot be limits", async () => {
  setClock(() => new Date("2026-11-21T10:00:00Z"));
  try {
    const f = makeFixture();
    for (const d of [P, BANK]) assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", d])).code, 0);
    assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", A, "--sponsor", P])).code, 0);
    for (const d of [P, A]) assert.equal((await asp(f, ["credits", "grant", "--to", d, "--amount", "300"])).code, 0);
    const intent = /^intent (\S+)/.exec((await asp(f, ["market", "intent", "--by", P, "--purpose", "loop test", "--budget", "100", "--deadline", "2027-01-01T00:00:00Z"])).out)![1];
    const offer = /^offer (\S+)/.exec((await asp(f, ["market", "offer", "--by", A, "--intent", intent, "--price", "100", "--plan", "go", "--eta", "2026-12-01T00:00:00Z"])).out)![1];
    const contract = /^contract (\S+):/.exec((await asp(f, ["market", "contract", "--principal", P, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
    assert.equal((await asp(f, ["market", "bond", "--contract", contract, "--backer", A, "--amount", "10", "--escrow-payer", P, "--escrow-amount", "100"])).code, 0);
    const mandate = (extra: string[]) => asp(f, ["market", "mandate", "--contract", contract, "--principal", P, "--performer", A, "--scopes", "repo.read", ...extra]);
    for (const bad of [["--loop-equivalent", "1"], ["--loop-depth", "0"], ["--loop-near", "2"], ["--tokens-per-day", "0"], ["--tokens-per-run", "0"]]) {
      const r = await mandate(bad);
      assert.notEqual(r.code, 0, bad.join(" "));
      assert.match(r.err + r.out, /is 2 or more, --loop-depth is 1 or more and --loop-near is 3 or more|are 1 or more/);
    }
    const ok = await mandate(["--loop-equivalent", "8", "--loop-depth", "3", "--loop-near", "12", "--tokens-per-day", "300000", "--tokens-per-run", "50000"]);
    assert.equal(ok.code, 0, ok.err + ok.out);
    const { openLog } = await import("@agent-social/asp-package");
    const local = await openLog(f.aspHome, {});
    const stored = (await local.log.chain(contract)).filter((x) => x.record.type === "asp.mandate/v0.2").at(-1)!.record.body as { loop_limits?: unknown; token_budget?: unknown };
    assert.deepEqual(stored.loop_limits, { equivalent_calls: 8, depth: 3, near_repeats: 12 });
    assert.deepEqual(stored.token_budget, { per_run: 50000, per_day: 300000 });
  } finally { setClock(undefined); }
});
