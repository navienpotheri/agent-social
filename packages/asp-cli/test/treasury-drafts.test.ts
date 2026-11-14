/**
 * `asp treasury draft | sign` on a real log (register row DK292; spec-delta S372): unsigned drafts of the first budgets, each valid against the log's rules and inside the 25 % growth rule for the next month, and
 * nothing is signed or recorded until the owner runs the sign command. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecord } from "@agent-social/asp-core";
import { INSTITUTION_DIDS, TREASURY_DID } from "@agent-social/asp-log";
import { Keystore, openLog } from "@agent-social/asp-package";
import { main, setClock, type Io } from "../src/cli.ts";
import { buildDrafts, type DraftFile } from "../src/treasury.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

const OWNER = "did:web:example.com:users:the-owner";
let clockMs = Date.parse("2026-11-14T00:00:00Z");

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ok = async (f: Fixture, args: string[]) => { const r = await asp(f, args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
const budgetsIn = async (f: Fixture) => { const log = await openLog(f.aspHome, {}); let n = 0; for (let after = 0; ;) { const page = await log.log.since(after, 500); if (!page.length) break; for (const s of page) { after = s.seq; if (s.record.type === "asp.budget/v0.2") n++; } } return n; };

test("the drafts cover every institution, the allowance and the deposit reward; each is valid against the log's rules; nothing is signed or recorded until the owner signs, one command per budget", async () => {
  const f = makeFixture();
  setClock(() => new Date(clockMs));
  const savedOwner = process.env.ASP_OWNER_DID;
  process.env.ASP_OWNER_DID = OWNER;
  try {
    for (const d of [OWNER, TREASURY_DID]) await ok(f, ["identity", "new", "--kind", "human", "--did", d]);
    await ok(f, ["credits", "grant", "--to", TREASURY_DID, "--amount", "60000"]);
    const before = await budgetsIn(f);
    const dir = mkdtempSync(join(tmpdir(), "asp-drafts-"));
    const file = join(dir, "budgets.json");
    const drafted = await ok(f, ["treasury", "draft", "--period", "2026-12", "--out", file]);
    assert.match(drafted.out, /13 unsigned budget draft\(s\) for 2026-12/);
    assert.match(drafted.out, /nothing is signed or recorded/);
    assert.equal(await budgetsIn(f), before, "writing the drafts recorded nothing");
    const parsed = JSON.parse(readFileSync(file, "utf8")) as DraftFile;
    assert.match(parsed.status, /UNSIGNED/);
    // Every institution, the allowance at 40 credits each, and the deposit-reward line; a reason with each.
    assert.deepEqual(parsed.drafts.filter((d) => d.purpose === "charter").map((d) => d.institution).sort(), [...INSTITUTION_DIDS].sort());
    assert.equal(parsed.drafts.find((d) => d.id === "allowance")!.amount, 40 * 500);
    assert.equal(parsed.drafts.find((d) => d.id === "deposit-reward")!.purpose, "deposit_reward");
    assert.ok(parsed.drafts.every((d) => d.why.length > 20 && /^sha256:/.test(d.sha256)));
    assert.deepEqual(buildDrafts("2026-12").drafts.map((d) => d.amount), parsed.drafts.map((d) => d.amount), "the drafts are a pure function of the period");

    // The owner's co-signature is required, and without the sign command nothing exists.
    const noCosign = await asp(f, ["treasury", "sign", "--draft", file, "--id", "courts"]);
    assert.notEqual(noCosign.code, 0);
    assert.match(noCosign.err, /needs the owner's co-signature/);
    assert.equal(await budgetsIn(f), before);
    // A draft changed by hand after it was written is not signed silently.
    const edited = JSON.parse(readFileSync(file, "utf8")) as DraftFile;
    edited.drafts.find((d) => d.id === "courts")!.amount = 9999;
    const editedFile = join(dir, "edited.json");
    writeFileSync(editedFile, JSON.stringify(edited));
    const tampered = await asp(f, ["treasury", "sign", "--draft", editedFile, "--id", "courts", "--cosign-by", OWNER]);
    assert.notEqual(tampered.code, 0);
    assert.match(tampered.err, /was changed after it was written/);
    assert.match((await ok(f, ["treasury", "sign", "--draft", editedFile, "--id", "courts", "--cosign-by", OWNER, "--amount", "2500"])).out, /courts, 2500 credits/, "the owner may confirm a figure of their own");
    assert.equal(await budgetsIn(f), before + 1, "exactly the one budget the owner signed");

    // Each remaining draft is accepted by the log, one command each; the total fits the funded Treasury.
    for (const d of parsed.drafts.filter((x) => x.id !== "courts")) {
      tick();
      const r = await ok(f, ["treasury", "sign", "--draft", file, "--id", d.id, "--cosign-by", OWNER]);
      assert.match(r.out, new RegExp(`budget \\S+: ${d.id}, ${d.amount} credits`));
    }
    assert.equal(await budgetsIn(f), before + 13);

    // The growth rule for the next month: up to 125 % of this month's needs no co-signature, more does.
    const log = await openLog(f.aspHome, {});
    const treasury = new Keystore(f.aspHome).forDid(TREASURY_DID)!;
    const next = (amount: number) => createRecord({ type: "budget" as never, issuer: TREASURY_DID, subject: null, prev: null, body: { institution: "did:web:asp.local:registry", period: "2027-01", amount: { value: amount, unit: "credit" }, purpose: "charter" }, issued_at: "2026-12-20T00:00:00Z" }, treasury);
    await assert.rejects(log.append(next(1251)), /25 %/);
    await log.append(next(1250));
  } finally { setClock(undefined); if (savedOwner === undefined) delete process.env.ASP_OWNER_DID; else process.env.ASP_OWNER_DID = savedOwner; }
});
const tick = () => { clockMs += 60_000; };
