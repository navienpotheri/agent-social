// Row DK684: `asp academy arena game-commit` and `game`: the referee commits to its seed, plays the season's game from the entries and the entrants' policies, prints the table and each transcript hash; a changed seed is refused and a season with
// too few sponsors is void. Over a fake log (the Arena's own rules are tested in packages/asp-log/test/arena-runner.test.ts and game-engine.test.ts). Fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomSeed, signerFromSeed } from "@agent-social/asp-core";
import { commitSeed, playEntrant, transcriptHash } from "@agent-social/asp-log";
import { AcademyUsage, academyCmd } from "../src/academy.ts";

const REG = "did:web:asp.local:registry";
const AGENTS = ["did:web:example.com:agents:g1", "did:web:example.com:agents:g2", "did:web:example.com:agents:g3", "did:web:example.com:agents:g4"];
const def = { id: "ar", type: "asp.arena/v0.2", issuer: REG, issued_at: "2026-11-02T00:00:00Z", body: { arena: "twenty-one", season: "q4", min_distinct_sponsors: 3, prize_split_permille: [500, 300, 200] } };
const entries = (agents: string[]) => agents.map((a, i) => ({ id: `en${i}`, type: "asp.arena_entry/v0.2", issuer: a, body: { arena: "twenty-one", season: "q4", fee_purchase: `pu${i}` } }));

async function run(sub: string, flags: Record<string, unknown>, agents = AGENTS) {
  const out: string[] = [];
  const signer = signerFromSeed(REG + "#key-1", randomSeed());
  const log = { log: { passport: async (d: string) => ({ sponsor: `sponsor-of-${d.slice(-2)}` }), academyRecords: async (types: string[]) => [def, ...entries(agents)].filter((r) => types.some((t) => r.type === `asp.${t}/v0.2`)), priceLists: async () => [] }, append: async () => ({ id: "x", seq: 1 }) } as any;
  const code = await academyCmd("arena", [sub], { log, io: { out: (l) => out.push(l) }, now: () => "2026-12-02T00:00:00Z", flags: flags as any, signerFor: () => signer as any });
  return { code, text: out.join("\n") };
}

test("DK684: the referee commits to a seed, then plays the season from the entries and the policies; the table carries each transcript hash, which anyone can recompute; a changed seed is refused", async () => {
  const commit = (await run("game-commit", { seed: "seed-x", salt: "salt-x" })).text;
  assert.match(commit, /^commit sha256:[0-9a-f]{64}/);
  assert.ok(commit.includes(commitSeed("seed-x", "salt-x")));
  const policies = `${AGENTS[0]}=17,${AGENTS[1]}=15,${AGENTS[2]}=12,${AGENTS[3]}=21`;
  const r = await run("game", { arena: "twenty-one", season: "q4", seed: "seed-x", salt: "salt-x", commit: commitSeed("seed-x", "salt-x"), policies, hands: "300" });
  assert.equal(r.code, 0, r.text);
  const rows = r.text.split("\n").filter((l) => /^\s+\d+\./.test(l));
  assert.equal(rows.length, 4);
  assert.match(rows.at(-1)!, /g4/, "the player who draws to 21 is last");
  const g1 = playEntrant("seed-x", { stand_at: 17 }, 300);
  assert.ok(r.text.includes(transcriptHash(AGENTS[0], { stand_at: 17 }, g1.transcript)), "the printed hash is the one anyone recomputes");
  assert.match(r.text, /played 300 hands each/);
  await assert.rejects(() => run("game", { arena: "twenty-one", season: "q4", seed: "other-seed", salt: "salt-x", commit: commitSeed("seed-x", "salt-x"), policies }), /seed_changed/);
  await assert.rejects(() => run("game", { arena: "twenty-one", season: "q4", seed: "seed-x" }), AcademyUsage);
});

test("DK684: a season with too few sponsors is void, and an entrant with no policy scores 0", async () => {
  const flags = { arena: "twenty-one", season: "q4", seed: "s", salt: "t", commit: commitSeed("s", "t"), hands: "100" };
  const few = await run("game", { ...flags, policies: AGENTS.slice(0, 3).map((a) => `${a}=17`).join(",") }, AGENTS.slice(0, 3));
  assert.match(few.text, /is void: too_few_sponsors/);
  const none = await run("game", { ...flags, policies: `${AGENTS[0]}=17,${AGENTS[1]}=15,${AGENTS[2]}=16` });
  assert.match(none.text.split("\n").filter((l) => /^\s+\d+\./.test(l)).at(-1)!, /g4.*score 0 /, "no move, no points");
});
