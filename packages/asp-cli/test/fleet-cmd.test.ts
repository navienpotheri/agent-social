// asp fleet declare|show|update|members|close|list (DK1353, S1407) through the real commands on a real local log: the organisation's key signs, a co-sponsor and a template, members join by `asp identity new --fleet`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, setClock, type Io } from "../src/cli.ts";
import { makeFixture, type Fixture } from "./fixture.ts";

async function asp(f: Fixture, args: string[]) {
  const out: string[] = [], err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root };
  const code = await main(args, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const ORG = "did:web:example.com:orgs:acme", DEV = "did:web:example.com:users:acme-dev", OUT = "did:web:example.com:users:outsider";

test("an organisation declares a fleet with a template and a co-sponsor, agents join under the organisation or the co-sponsor, and the commands read, update and close it", async () => {
  setClock(() => new Date("2026-11-21T10:00:00Z"));
  try {
    const f = makeFixture();
    for (const d of [ORG, DEV, OUT]) assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", d])).code, 0);
    assert.notEqual((await asp(f, ["fleet", "declare", "--org", ORG])).code, 0, "a name is needed");
    const declared = await asp(f, ["fleet", "declare", "--org", ORG, "--name", "Coders", "--purpose", "ship code", "--max-members", "3", "--runtime", "claude-code", "--model", "model-a", "--co-sponsor", DEV]);
    assert.equal(declared.code, 0, declared.err || declared.out);
    const FLEET = `${ORG}:fleets:coders`;
    assert.match(declared.out, new RegExp(`fleet ${FLEET} declared`));
    assert.notEqual((await asp(f, ["fleet", "declare", "--org", ORG, "--name", "Coders"])).code, 0, "already declared");
    const join = (sponsor: string, name: string, extra: string[] = []) => asp(f, ["identity", "new", "--kind", "agent", "--did", `did:web:example.com:agents:${name}`, "--sponsor", sponsor, "--fleet", FLEET, ...extra]);
    assert.equal((await join(ORG, "a1", ["--runtime", "claude-code", "--model", "model-a"])).code, 0);
    assert.equal((await join(DEV, "a2", ["--runtime", "codex"])).code, 0, "a co-sponsor's agent joins; a different runtime is labelled");
    assert.notEqual((await join(OUT, "a3")).code, 0, "someone the organisation did not name");
    const shown = await asp(f, ["fleet", "show", FLEET]);
    assert.match(shown.out, /co-sponsors did:web:example.com:users:acme-dev/);
    assert.match(shown.out, /members 2 of at most 3/);
    assert.match(shown.out, /by template: matches 1, differs 1/);
    const members = await asp(f, ["fleet", "members", FLEET]);
    assert.match(members.out, /2 member\(s\)/);
    assert.match(members.out, /template differs: runtime/);
    assert.equal(JSON.parse((await asp(f, ["fleet", "show", FLEET, "--json"])).out).members.length, 2);
    assert.match((await asp(f, ["fleet", "list", "--org", ORG])).out, new RegExp(FLEET));
    // update: a cap below the members is refused; a binding template; a larger cap
    assert.notEqual((await asp(f, ["fleet", "update", FLEET, "--max-members", "1"])).code, 0);
    assert.notEqual((await asp(f, ["fleet", "update", FLEET, "--by", DEV, "--max-members", "9"])).code, 0, "only the organisation updates");
    assert.equal((await asp(f, ["fleet", "update", FLEET, "--max-members", "5", "--strict"])).code, 0);
    assert.notEqual((await join(ORG, "a4", ["--runtime", "other"])).code, 0, "the template is now binding");
    assert.equal((await join(ORG, "a5", ["--runtime", "claude-code", "--model", "model-a"])).code, 0);
    assert.equal((await asp(f, ["fleet", "close", FLEET])).code, 0);
    assert.notEqual((await join(ORG, "a6", ["--runtime", "claude-code", "--model", "model-a"])).code, 0, "closed to new members");
    assert.match((await asp(f, ["fleet", "show", FLEET])).out, /\[closed to new members\]/);
    assert.notEqual((await asp(f, ["fleet", "show", "did:web:example.com:nothing"])).code, 0);
    assert.notEqual((await asp(f, ["fleet", "nonsense"])).code, 0);
  } finally { setClock(undefined); }
});

test("asp fleet template, narrow and mandate (DK1355, S1408): the organisation signs one Mandate, a member's Mandate derives from it, a persona has its own, a member may only narrow, an amendment applies to every member", async () => {
  setClock(() => new Date("2026-11-21T10:00:00Z"));
  try {
    const f = makeFixture();
    for (const d of [ORG, DEV]) assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", d])).code, 0);
    assert.equal((await asp(f, ["fleet", "declare", "--org", ORG, "--name", "Coders", "--purpose", "ship code"])).code, 0);
    const FLEET = `${ORG}:fleets:coders`;
    const A1 = "did:web:example.com:agents:t1", A2 = "did:web:example.com:agents:t2", R1 = "did:web:example.com:agents:reviewer-1";
    for (const [d, extra] of [[A1, []], [A2, []], [R1, ["--persona", "reviewer"]]] as [string, string[]][]) assert.equal((await asp(f, ["identity", "new", "--kind", "agent", "--did", d, "--sponsor", ORG, "--fleet", FLEET, ...extra])).code, 0);
    const mandate = { purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read", "repo.write"], forbidden_means: [], spend: { cap: 100, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 2 }, learning: { scope: "memory", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true };
    const file = join(f.root, "template.json");
    writeFileSync(file, JSON.stringify(mandate));
    assert.equal((await asp(f, ["fleet", "template", "show", FLEET])).out.includes("has no Mandate template"), true);
    const set = await asp(f, ["fleet", "template", "set", "--did", FLEET, "--file", file]);
    assert.equal(set.code, 0, set.err || set.out);
    assert.match(set.out, /version 1/);
    writeFileSync(file, JSON.stringify({ ...mandate, scopes: ["repo.read"] }));
    assert.equal((await asp(f, ["fleet", "template", "set", "--did", FLEET, "--file", file, "--persona", "reviewer"])).code, 0);
    const C = "sha256:" + "6".repeat(64);
    const m1 = JSON.parse((await asp(f, ["fleet", "mandate", "--member", A1, "--contract", C])).out);
    assert.deepEqual([m1.contract, m1.scopes], [C, ["repo.read", "repo.write"]]);
    assert.deepEqual(JSON.parse((await asp(f, ["fleet", "mandate", "--member", R1, "--contract", C])).out).scopes, ["repo.read"], "the persona's own template");
    writeFileSync(file, JSON.stringify({ scopes: ["repo.read"], spend: { cap: 40, unit: "credit" } }));
    assert.equal((await asp(f, ["fleet", "narrow", "--member", A1, "--file", file])).code, 0);
    assert.equal(JSON.parse((await asp(f, ["fleet", "mandate", "--member", A1, "--contract", C])).out).spend.cap, 40);
    writeFileSync(file, JSON.stringify({ scopes: ["shell.exec"] }));
    const wide = await asp(f, ["fleet", "narrow", "--member", A2, "--file", file]);
    assert.notEqual(wide.code, 0);
    assert.match(wide.err, /may only narrow the template: scopes/);
    // an amendment (version 2): every member follows it
    writeFileSync(file, JSON.stringify({ ...mandate, spend: { cap: 20, unit: "credit" } }));
    assert.equal((await asp(f, ["fleet", "template", "set", "--did", FLEET, "--file", file])).code, 0);
    assert.equal(JSON.parse((await asp(f, ["fleet", "mandate", "--member", A2, "--contract", C])).out).spend.cap, 20);
    assert.equal(JSON.parse((await asp(f, ["fleet", "mandate", "--member", A1, "--contract", C])).out).spend.cap, 20, "a's narrowing (cap 40) would now widen the template (20): the template wins");
    assert.notEqual((await asp(f, ["fleet", "template", "set", "--did", FLEET, "--file", file, "--by", DEV])).code, 0, "only the organisation signs");
  } finally { setClock(undefined); }
});

test("DK1505: `asp fleet revoke <fleet> --nonce` signs the organisation's revocation of an unused invitation; a second time, a missing nonce and an unknown fleet are refused", async () => {
  setClock(() => new Date("2026-11-21T10:00:00Z"));
  try {
    const f = makeFixture();
    assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", ORG])).code, 0);
    assert.equal((await asp(f, ["fleet", "declare", "--org", ORG, "--name", "Coders", "--purpose", "ship code"])).code, 0);
    const FLEET = `${ORG}:fleets:coders`;
    const nonce = "Zr3k9QmV2xT7pL1aB4cD8e";
    const r = await asp(f, ["fleet", "revoke", FLEET, "--nonce", nonce, "--reason", "shared by mistake"]);
    assert.equal(r.code, 0, r.err || r.out);
    assert.match(r.out, new RegExp(`invitation ${nonce} of ${FLEET} revoked`));
    assert.notEqual((await asp(f, ["fleet", "revoke", FLEET, "--nonce", nonce])).code, 0, "once");
    assert.notEqual((await asp(f, ["fleet", "revoke", FLEET])).code, 0, "the nonce is needed");
    assert.notEqual((await asp(f, ["fleet", "revoke", `${ORG}:fleets:nowhere`, "--nonce", nonce])).code, 0, "a fleet that is not declared");
    assert.notEqual((await asp(f, ["fleet", "revoke", FLEET, "--nonce", "short"])).code, 0, "a nonce of the wrong shape");
  } finally { setClock(() => new Date()); }
});
