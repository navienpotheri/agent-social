// Row DK381 (spec-delta S960): `asp treasury statement --sign` signs the month with the Treasury key and the record carries the hash of the statement as printed; a second one for the month is refused; the public route serves the statement and
// the signed copies. Fake keys only; credits are accounting entries, not money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalize } from "@agent-social/asp-core";
import { TREASURY_DID } from "@agent-social/asp-log";
import { openLog } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

test("DK381: the Treasury signs its monthly statement with one command; the record holds the hash of the statement; a second for the month is refused", async () => {
  const f = makeFixture();
  const asp = async (args: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root } as Io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  assert.equal((await asp(["identity", "new", "--kind", "human", "--did", TREASURY_DID])).code, 0);
  assert.equal((await asp(["credits", "grant", "--to", TREASURY_DID, "--amount", "500"])).code, 0);
  const signed = await asp(["treasury", "statement", "--sign", "--period", "2026-11"]);
  assert.match(signed.out, /signed statement sha256:[0-9a-f]{64} for 2026-11: balance 500, hash sha256:[0-9a-f]{64}/);
  const hash = /hash (sha256:[0-9a-f]{64})/.exec(signed.out)![1];
  const lg = await openLog(f.aspHome, {} as never);
  const recs = (await lg.log.recordsOfTypes(["treasury_statement"])) as unknown as { issuer: string; body: { period: string; balance: { value: number }; statement_sha256: string } }[];
  assert.equal(recs.length, 1);
  assert.equal(recs[0].issuer, TREASURY_DID);
  assert.equal(recs[0].body.period, "2026-11");
  assert.equal(recs[0].body.balance.value, 500);
  assert.equal(recs[0].body.statement_sha256, hash);
  assert.equal(hash, "sha256:" + createHash("sha256").update(canonicalize(await lg.log.treasuryStatement())).digest("hex"), "the hash is of the statement the log computes now, which a reader can recompute");
  const again = await asp(["treasury", "statement", "--sign", "--period", "2026-11", "--since", "2026-11-01T00:00:00Z"]); // a different statement for the same month (an identical one is the same record, appended once)
  assert.match(again.err + again.out, /already in the log/, again.out);
  assert.notEqual(again.code, 0);
  assert.match((await asp(["treasury", "statement", "--sign", "--period", "November"])).err, /--period is a month/);
});
