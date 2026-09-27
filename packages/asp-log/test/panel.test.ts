import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { b64urlEncode, cosign, publicKeyFromSeed, signerFromSeed, type AspRecord, type Signer } from "@agent-social/asp-core";
import { EventLog } from "../src/index.ts";
import { alice, at, bank, codeOf, coder, lifecycleCases, memory, pgUrl, postgres, rec, registerParties, type Harness } from "./harness.ts";

/** A fresh, ad-hoc human identity, self-issued, not from conformance/keys.json. */
function freshParty(name: string): { did: string } & Signer & { publicKey: Uint8Array } {
  const did = `did:web:example.com:users:${name}`;
  const seed = new Uint8Array(randomBytes(32));
  return { did, ...signerFromSeed(`${did}#key-1`, seed) };
}

async function registerJuror(log: EventLog, p: { did: string } & Signer & { publicKey: Uint8Array }, stake: number, prev: string | null = null) {
  const record = rec("juror", p, { did: p.did, stake: { value: stake, unit: "credit" } }, prev);
  return log.append(record);
}

for (const h of [memory, postgres] as Harness[]) {
  describe(`Courts ruling panel on ${h.name}`, { skip: h === postgres && !pgUrl && "set ASP_TEST_DATABASE_URL to run" }, () => {
    after(() => h.cleanup());

    /** Builds a job through to Disputed (dispute_ruled vector, minus its own fixed ruling/settlement), on real registry keys. */
    async function toDisputed(log: EventLog) {
      await registerParties(log);
      const records = lifecycleCases.find((c: any) => c.name === "dispute_ruled").records as AspRecord[];
      let last;
      for (const r of records.slice(0, 7)) last = await log.append(r); // contract..2nd rejection
      return { contractId: records[0].id, head: last!.id };
    }

    test("juror register: a fresh registration locks real credits; an update moves the difference", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const j = freshParty("juror-1");
      await log.append(rec("passport", j, { did: j.did, kind: "human", keys: [{ id: j.kid, type: "Ed25519", public_key: b64urlEncode(j.publicKey) }] }, null, j.did));
      await log.mint(j.did, 500);

      const first = await registerJuror(log, j, 100);
      assert.equal(await log.balance(j.did), 400, "100 credits locked as stake");
      assert.deepEqual(await log.juror(j.did), { did: j.did, head: first.id, staked: 100 });

      const raised = await registerJuror(log, j, 300, first.id);
      assert.equal(raised.state, null);
      assert.equal(await log.balance(j.did), 200, "another 200 locked (100 -> 300)");

      const lowered = await registerJuror(log, j, 50, raised.id);
      assert.equal(await log.balance(j.did), 450, "250 returned (300 -> 50)");
      assert.deepEqual(await log.juror(j.did), { did: j.did, head: lowered.id, staked: 50 });
    });

    test("juror register: insufficient balance is refused, same as a Bond", async () => {
      const log = new EventLog(await h.make());
      await registerParties(log);
      const j = freshParty("juror-2");
      await log.append(rec("passport", j, { did: j.did, kind: "human", keys: [{ id: j.kid, type: "Ed25519", public_key: b64urlEncode(j.publicKey) }] }, null, j.did));
      await log.mint(j.did, 50);
      assert.equal(await codeOf(registerJuror(log, j, 100)), "GUARD_FAILED");
      assert.equal(await log.balance(j.did), 50);
    });

    test("drawPanel excludes the contract's principal, performer, and their sponsors", async () => {
      const log = new EventLog(await h.make());
      const { contractId } = await toDisputed(log);

      // A juror sponsored by alice (the principal) is a conflict of interest.
      const conflicted = freshParty("alice-friend");
      await log.append(rec("passport", alice, { did: conflicted.did, kind: "agent", sponsor: alice.did, tier: 1, shape: {}, keys: [{ id: conflicted.kid, type: "Ed25519", public_key: b64urlEncode(conflicted.publicKey) }] }, null, conflicted.did));
      await log.mint(conflicted.did, 500);
      await registerJuror(log, conflicted, 100);

      const clean = [freshParty("juror-a"), freshParty("juror-b"), freshParty("juror-c")];
      for (const j of clean) {
        await log.append(rec("passport", j, { did: j.did, kind: "human", keys: [{ id: j.kid, type: "Ed25519", public_key: b64urlEncode(j.publicKey) }] }, null, j.did));
        await log.mint(j.did, 500);
        await registerJuror(log, j, 100);
      }

      const panel = await log.drawPanel(contractId);
      assert.equal(panel.length, 3);
      assert.ok(!panel.includes(conflicted.did), "excluded: sponsored by the principal");
      assert.ok(!panel.includes(alice.did) && !panel.includes(coder.did), "excluded: principal and performer themselves");
      for (const d of panel) assert.ok(clean.some((j) => j.did === d), `${d} is one of the conflict-free jurors`);
    });

    test("a ruling needs a majority of the drawn panel to sign, not any DID", async () => {
      const log = new EventLog(await h.make());
      const { contractId, head } = await toDisputed(log);
      const jurors = [freshParty("juror-x"), freshParty("juror-y"), freshParty("juror-z")];
      for (const j of jurors) {
        await log.append(rec("passport", j, { did: j.did, kind: "human", keys: [{ id: j.kid, type: "Ed25519", public_key: b64urlEncode(j.publicKey) }] }, null, j.did));
        await log.mint(j.did, 500);
        await registerJuror(log, j, 100);
      }
      const panel = await log.drawPanel(contractId);
      assert.equal(panel.length, 3);
      const bySigner = (did: string) => jurors.find((j) => j.did === did)!;

      const ruling = (signers: string[]) => {
        const [first, ...rest] = signers.map(bySigner);
        let record = rec("attestation", first, { kind: "ruling", about: contractId, verdict: "split", fault: { [alice.did]: 500, [coder.did]: 500 } }, head, contractId);
        for (const s of rest) record = cosign(record, s);
        return record;
      };

      // A ruling by someone who isn't even on the drawn panel doesn't count towards quorum.
      const outsider = freshParty("outsider");
      await log.append(rec("passport", outsider, { did: outsider.did, kind: "human", keys: [{ id: outsider.kid, type: "Ed25519", public_key: b64urlEncode(outsider.publicKey) }] }, null, outsider.did));
      let record = rec("attestation", outsider, { kind: "ruling", about: contractId, verdict: "split", fault: { [alice.did]: 500, [coder.did]: 500 } }, head, contractId);
      record = cosign(record, bySigner(panel[0]));
      assert.equal(await codeOf(log.append(record)), "GUARD_FAILED", "1 of 3 (the outsider doesn't count) is short of quorum");

      const quorumRuling = ruling([panel[0], panel[1]]);
      const res = await log.append(quorumRuling);
      assert.equal(res.state, "Disputed");
    });

    test("with no jurors registered anywhere, the mocked pre-Courts behavior holds: any neutral DID may rule", async () => {
      const log = new EventLog(await h.make());
      const { contractId, head } = await toDisputed(log);
      const p = freshParty("neutral");
      await log.append(rec("passport", p, { did: p.did, kind: "human", keys: [{ id: p.kid, type: "Ed25519", public_key: b64urlEncode(p.publicKey) }] }, null, p.did));
      const record = rec("attestation", p, { kind: "ruling", about: contractId, verdict: "split", fault: { [alice.did]: 500, [coder.did]: 500 } }, head, contractId);
      assert.equal(await codeOf(log.append(record)), undefined);
    });

    test("verify() replays juror registrations and a panel-quorum ruling without breaking", async () => {
      const log = new EventLog(await h.make());
      const { contractId, head } = await toDisputed(log);
      const jurors = [freshParty("v-juror-1"), freshParty("v-juror-2"), freshParty("v-juror-3")];
      for (const j of jurors) {
        await log.append(rec("passport", j, { did: j.did, kind: "human", keys: [{ id: j.kid, type: "Ed25519", public_key: b64urlEncode(j.publicKey) }] }, null, j.did));
        await log.mint(j.did, 500);
        await registerJuror(log, j, 100);
      }
      const panel = await log.drawPanel(contractId);
      const bySigner = (did: string) => jurors.find((j) => j.did === did)!;
      let record = rec("attestation", bySigner(panel[0]), { kind: "ruling", about: contractId, verdict: "split", fault: { [alice.did]: 500, [coder.did]: 500 } }, head, contractId);
      record = cosign(record, bySigner(panel[1]));
      await log.append(record);

      const report = await log.verify();
      assert.equal(report.ok, true, report.error && JSON.stringify(report.error));
    });
  });
}
