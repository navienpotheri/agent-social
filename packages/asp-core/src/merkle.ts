/**
 * A Merkle root over a set of leaves, and an inclusion proof (register row DK1742; spec-delta S1599): the forum keeps its votes in its own store, and the log commits only the ROOT of a period's vote set, so a voter can prove its
 * vote is in what was committed without the log holding every vote. Leaves are the SHA-256 of `leaf|<text>`, inner nodes the SHA-256 of `node|<left>|<right>`; leaves are SORTED first, so the root does not depend on the order the
 * service lists them in; an odd node is carried up unchanged. Pure; the Python SDK has the same functions and the same vectors (conformance/vectors/merkle.json).
 */
import { createHash } from "node:crypto";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const merkleLeaf = (text: string): string => sha(`leaf|${text}`);
const node = (l: string, r: string): string => sha(`node|${l}|${r}`);
export const EMPTY_ROOT: string = sha("empty");

function levels(leaves: readonly string[]): string[][] {
  let level = [...new Set(leaves)].sort().map(merkleLeaf);
  const out = [level];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? node(level[i]!, level[i + 1]!) : level[i]!);
    out.push(next);
    level = next;
  }
  return out;
}

/** The root of a set of leaf texts (duplicates counted once); the root of no leaves is the fixed EMPTY_ROOT. */
export function merkleRoot(leaves: readonly string[]): string {
  if (!leaves.length) return EMPTY_ROOT;
  const l = levels(leaves);
  return l[l.length - 1]![0]!;
}

export interface MerkleStep { side: "left" | "right"; hash: string }

/** The proof that one leaf text is in the set: the sibling hashes from the leaf up to the root, or null when it is not there. */
export function merkleProof(leaves: readonly string[], text: string): MerkleStep[] | null {
  const sorted = [...new Set(leaves)].sort();
  let i = sorted.indexOf(text);
  if (i < 0) return null;
  const proof: MerkleStep[] = [];
  const l = levels(leaves);
  for (let d = 0; d < l.length - 1; d++) {
    const sib = i % 2 === 0 ? i + 1 : i - 1;
    if (sib < l[d]!.length) proof.push({ side: i % 2 === 0 ? "right" : "left", hash: l[d]![sib]! });
    i = Math.floor(i / 2);
  }
  return proof;
}

/** Whether a leaf text with its proof gives the root. */
export function merkleVerify(root: string, text: string, proof: readonly MerkleStep[]): boolean {
  let h = merkleLeaf(text);
  for (const s of proof) h = s.side === "left" ? node(s.hash, h) : node(h, s.hash);
  return h === root;
}
