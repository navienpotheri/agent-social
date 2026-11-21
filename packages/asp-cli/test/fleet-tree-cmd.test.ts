// asp fleet node|move|tree (DK1372, S1409) through the real commands on a real local log: the organisation's key signs the nodes, members join a node on their passports, a move is signed, a child's Mandate may only narrow its parent's, and the tree prints with usage.
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
const ORG = "did:web:example.com:orgs:tree-co", LEAD = "did:web:example.com:users:tree-lead";
const MANDATE = { purpose: "Work", floor: "asp.floor/v1", scopes: ["repo.read", "repo.write"], forbidden_means: [], spend: { cap: 50, unit: "credit" }, irreversible: { policy: "checkpoint" }, subcontract: { allowed: false }, nodes: { max_parallel: 2 }, learning: { scope: "harness", share_to_commons: false }, self_modification: "principal_approves", overlay: null, checkpoints: [], expires: "2040-01-01T00:00:00Z", revocable: true };

test("an organisation builds a fleet tree with commands: nodes with a budget and a Mandate, members that join a node, a signed move, the tree printed, and a widening refused", async () => {
  setClock(() => new Date("2026-11-21T10:00:00Z"));
  try {
    const f = makeFixture();
    for (const d of [ORG, LEAD]) assert.equal((await asp(f, ["identity", "new", "--kind", "human", "--did", d])).code, 0);
    const FLEET = `${ORG}:fleets:all`;
    assert.equal((await asp(f, ["fleet", "declare", "--org", ORG, "--name", "All", "--purpose", "every agent"])).code, 0);
    const file = (name: string, body: unknown) => { const p = join(f.root, name); writeFileSync(p, JSON.stringify(body)); return p; };
    const node = (args: string[]) => asp(f, ["fleet", "node", "set", "--did", FLEET, "--owner", LEAD, ...args]);
    assert.notEqual((await node(["--node", "eng", "--kind", "department", "--name", "Eng", "--parent", "root"])).code, 0, "the root comes first");
    assert.equal((await node(["--node", "root", "--kind", "fleet", "--name", "Acme", "--credits", "100", "--tokens", "5000"])).code, 0);
    const dept = await node(["--node", "eng", "--kind", "department", "--name", "Engineering", "--parent", "root", "--credits", "60", "--tokens", "3000", "--file", file("m1.json", MANDATE)]);
    assert.equal(dept.code, 0, dept.err || dept.out);
    assert.equal((await node(["--node", "ops", "--kind", "department", "--name", "Operations", "--parent", "root", "--credits", "40", "--tokens", "2000"])).code, 0);
    const wide = await node(["--node", "platform", "--kind", "team", "--name", "Platform", "--parent", "eng", "--credits", "10", "--tokens", "100", "--file", file("m2.json", { ...MANDATE, scopes: ["repo.read", "shell.exec"] })]);
    assert.notEqual(wide.code, 0);
    assert.match(wide.err + wide.out, /may only narrow its parent.s .eng.: scopes go beyond it/, "a child's Mandate may only narrow its parent's");
    const over = await node(["--node", "platform", "--kind", "team", "--name", "Platform", "--parent", "eng", "--credits", "70", "--tokens", "100"]);
    assert.notEqual(over.code, 0);
    assert.match(over.err + over.out, /node platform asks 70 credits; eng has 60/);
    assert.equal((await node(["--node", "platform", "--kind", "team", "--name", "Platform", "--parent", "eng", "--credits", "30", "--tokens", "1000", "--file", file("m3.json", { ...MANDATE, scopes: ["repo.read"] })])).code, 0);
    for (const [name, at] of [["m1", "platform"], ["m2", "ops"], ["m3", undefined]] as const) {
      const r = await asp(f, ["identity", "new", "--kind", "agent", "--did", `did:web:example.com:agents:tree-${name}`, "--sponsor", ORG, "--fleet", FLEET, ...(at ? ["--node", at] : [])]);
      assert.equal(r.code, 0, r.err || r.out);
    }
    const bad = await asp(f, ["identity", "new", "--kind", "agent", "--did", "did:web:example.com:agents:tree-x", "--sponsor", ORG, "--fleet", FLEET, "--node", "nowhere"]);
    assert.notEqual(bad.code, 0, "an undeclared node");
    let tree = await asp(f, ["fleet", "tree", FLEET]);
    assert.match(tree.out, /3 member\(s\), 4 node\(s\), 0 move\(s\)/);
    assert.match(tree.out, /platform \[team\] Platform {2}1 here, 1 below and here; credits 0\/30; tokens 0\/1000; Mandate set/);
    assert.match(tree.out, /root \[fleet\] Acme {2}1 here, 3 below and here/, "a member that names no node sits at the root");
    const mv = await asp(f, ["fleet", "move", "--did", FLEET, "--member", "did:web:example.com:agents:tree-m3", "--to", "ops", "--reason", "reorganised"]);
    assert.equal(mv.code, 0, mv.err || mv.out);
    assert.notEqual((await asp(f, ["fleet", "move", "--did", FLEET, "--member", "did:web:example.com:agents:tree-m3", "--to", "ops"])).code, 0, "already there");
    tree = await asp(f, ["fleet", "tree", FLEET]);
    assert.match(tree.out, /3 member\(s\), 4 node\(s\), 1 move\(s\)/);
    assert.match(tree.out, /ops \[department\] Operations {2}2 here/);
    const json = JSON.parse((await asp(f, ["fleet", "tree", FLEET, "--json"])).out);
    assert.equal(json.nodes.find((n: { node: string }) => n.node === "eng").subtreeMembers, 1);
    assert.notEqual((await asp(f, ["fleet", "node", "set", "--did", FLEET])).code, 0, "a usage line, not a crash");
  } finally { setClock(undefined); }
});
