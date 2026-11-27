// The shared Merkle vectors (conformance/vectors/merkle.json; register row DK1742, spec-delta S1599): the root of a vote set and an inclusion proof, the same in both SDKs, and a proof that fails for a vote that is not there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_ROOT, merkleLeaf, merkleProof, merkleRoot, merkleVerify } from "../src/index.ts";

const vec = JSON.parse(readFileSync(new URL("../../../conformance/vectors/merkle.json", import.meta.url), "utf8"));
for (const c of vec.cases) {
  test(`merkle: ${c.name}`, () => {
    assert.equal(merkleRoot(c.leaves), c.root);
    assert.deepEqual([...new Set<string>(c.leaves)].sort().map(merkleLeaf), c.leaf_hashes);
    for (const p of c.proofs) {
      assert.deepEqual(merkleProof(c.leaves, p.leaf), p.proof);
      assert.equal(merkleVerify(c.root, p.leaf, p.proof), true, `${p.leaf} is in the root`);
      assert.equal(merkleVerify(c.root, p.leaf + "x", p.proof), false, "another text does not verify with that proof");
    }
  });
}
test("the root does not depend on the order, a vote that is not in the set has no proof and the root of nothing is fixed", () => {
  assert.equal(merkleRoot(["a", "b", "c"]), merkleRoot(["c", "a", "b"]));
  assert.notEqual(merkleRoot(["a", "b", "c"]), merkleRoot(["a", "b", "d"]), "one vote changed, another root");
  assert.equal(merkleProof(["a", "b"], "z"), null);
  assert.equal(merkleRoot([]), EMPTY_ROOT);
});
