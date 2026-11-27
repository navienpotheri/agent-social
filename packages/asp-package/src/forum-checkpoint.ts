/**
 * The forum's rank checkpoint, computed from its store (register rows DK1742 and DK1768; spec-delta S1599): the standing votes are the leaves of a Merkle root (`vote|<voter>|<target>|<value>`), and the rank inputs are the score
 * of every target they give, hashed. The operator signs the result as a `forum_rank_checkpoint` on their own machine; a voter asks for an inclusion proof and checks it against the signed root. Pure. The weighted rank of
 * forum-rank.ts needs the log's controller map and is computed on top of these votes; the checkpoint commits the votes and the plain scores, so a replay from the store reproduces both hashes.
 */
import { createHash } from "node:crypto";
import { merkleProof, merkleRoot } from "@agent-social/asp-core";

export interface StandingVote { voter: string; target: string; value: 1 | -1 }
export const voteLeaf = (v: StandingVote): string => `vote|${v.voter}|${v.target}|${v.value}`;

/** The plain score of each target (up-votes less down-votes), sorted by target: the rank inputs the checkpoint hashes. */
export function rankInputs(votes: readonly StandingVote[]): { target: string; score: number; up: number; down: number }[] {
  const m = new Map<string, { score: number; up: number; down: number }>();
  for (const v of votes) { const x = m.get(v.target) ?? { score: 0, up: 0, down: 0 }; x.score += v.value; if (v.value === 1) x.up++; else x.down++; m.set(v.target, x); }
  return [...m].map(([target, x]) => ({ target, ...x })).sort((a, b) => (a.target < b.target ? -1 : 1));
}

export interface RankCheckpoint { period: string; votes_root: string; votes: number; rank_sha256: string }

/** The checkpoint body for a day: the root of the votes, how many, and the hash of the rank inputs. */
export function rankCheckpointOf(votes: readonly StandingVote[], period: string): RankCheckpoint {
  const leaves = votes.map(voteLeaf);
  return { period, votes_root: merkleRoot(leaves), votes: new Set(leaves).size, rank_sha256: createHash("sha256").update(JSON.stringify(rankInputs(votes))).digest("hex") };
}

/** A voter's inclusion proof against the root of the current vote set, or null when that vote is not in it. */
export function voteProof(votes: readonly StandingVote[], voter: string, target: string, value: 1 | -1): { leaf: string; root: string; proof: ReturnType<typeof merkleProof> } | null {
  const leaves = votes.map(voteLeaf);
  const leaf = voteLeaf({ voter, target, value });
  const proof = merkleProof(leaves, leaf);
  return proof ? { leaf, root: merkleRoot(leaves), proof } : null;
}
