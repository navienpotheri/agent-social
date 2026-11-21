/**
 * Ladders on the log (register row DK1741; spec-delta S1598; docs/institutions/games-and-arena.md): a season with a published draw seed, entries by agents with a counted job, and matches recorded only for pairings the
 * draw gives, so an agreed match never reaches the log; same-controller matches are recorded and not counted; the table is the rating of the counted matches. Fake keys only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ladderDraw, rateLadder } from "../src/index.ts";
import { DAY, jump, kit, mk, nowIso, operator, refusedBy, type Party } from "./society-kit.ts";

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

async function world(n = 6) {
  const k = await kit();
  await k.withPrices();
  const client = await k.person("ld-client", 20_000);
  const players: Party[] = [];
  for (let i = 0; i < n; i++) { const s = await k.person(`ld-s${i}`); const a = await k.agent(`ld-a${i}`, s, { funds: 0 }); await k.runJob(client, a, 40); players.push(a); }
  const season = (o: Record<string, unknown> = {}) => mk("ladder_season", operator, { game: "twenty-one", season: "2026-12", entry_closes_at: iso(Date.parse(nowIso()) + 2 * DAY), ends_at: iso(Date.parse(nowIso()) + 20 * DAY), draw_seed: "seed-2026-12-a", rounds: 6, ...o });
  const enter = (p: Party, id: string) => mk("ladder_entry", p, { season: id }, null, { subject: p.did });
  const match = (id: string, round: number, a: string, b: string, score = 1000) => mk("ladder_match", operator, { season: id, round, a, b, score_permille: score, transcript_sha256: "sha256:" + "f".repeat(64) });
  return { k, players, season, enter, match };
}

test("DK1741: a ladder season runs: entries with a counted job, drawn matches only, and a rating table of the counted ones", async () => {
  const w = await world();
  const s = w.season();
  await w.k.log.append(s);
  assert.equal(await refusedBy(w.k.log.append(w.season())), "ladder_season_exists");
  const fresh = await w.k.agent("ld-fresh", await w.k.person("ld-fresh-sponsor"), { funds: 0 });
  assert.equal(await refusedBy(w.k.log.append(w.enter(fresh, s.id))), "ladder_entry_no_standing", "an identity with no counted job has no place");
  for (const p of w.players) await w.k.log.append(w.enter(p, s.id));
  assert.equal(await refusedBy(w.k.log.append(w.enter(w.players[0], s.id))), "ladder_entry_exists");
  assert.equal(await refusedBy(w.k.log.append(w.match(s.id, 0, w.players[0].did, w.players[1].did))), "ladder_match_early", "rounds are drawn after entry closes");
  jump(2 * DAY + 60_000);
  assert.equal(await refusedBy(w.k.log.append(w.enter(fresh, s.id))), "ladder_entry_closed");
  const entrants = w.players.map((p) => p.did);
  const pairs = ladderDraw("seed-2026-12-a", 0, entrants);
  assert.equal(pairs.length, 3);
  assert.deepEqual(ladderDraw("seed-2026-12-a", 0, [...entrants].reverse()), pairs, "the draw does not depend on the order entrants are listed in");
  assert.notDeepEqual(ladderDraw("seed-2026-12-a", 1, entrants), pairs, "another round draws again");
  // a pairing the draw does not give is refused, however the players agreed it
  const drawnSet = new Set(pairs.flat());
  assert.equal(drawnSet.size, 6);
  const [p0, p1] = pairs[0]; const [p2] = pairs[1];
  assert.equal(await refusedBy(w.k.log.append(w.match(s.id, 0, p0, p2))), "ladder_not_drawn", "an agreed match is not recorded");
  assert.equal(await refusedBy(w.k.log.append(w.match(s.id, 0, p0, p0))), "ladder_self");
  for (const [a, b] of pairs) await w.k.log.append(w.match(s.id, 0, a, b, 1000));
  assert.equal(await refusedBy(w.k.log.append(w.match(s.id, 0, p1, p0, 0))), "ladder_match_exists", "one result for a pairing in a round");
  assert.equal(await refusedBy(w.k.log.append(w.match(s.id, 9, p0, p1))), "ladder_round", "the season has six rounds");
  assert.equal(await refusedBy(w.k.log.append(mk("ladder_match", w.players[0], { season: s.id, round: 1, a: p0, b: p1, score_permille: 1000, transcript_sha256: "sha256:" + "f".repeat(64) }))), "ladder_wrong_issuer", "a player does not record its own match");
  const f = (await w.k.log.ladderFacts(s.id))!;
  const t = rateLadder(f.players, f.matches);
  assert.equal(t.counted.filter((c) => c.counted).length, 3, "three drawn matches, three counted");
  const winner = t.ratings.find((x) => x.id === pairs[0][0])!, loser = t.ratings.find((x) => x.id === pairs[0][1])!;
  assert.deepEqual([winner.rating, loser.rating], [1020, 980], "a first win moves the rating by 20 of the 40 step");
  assert.equal((await w.k.log.verify()).ok, true, "a replica recomputes the table from the records");
});

test("DK1741: matches between agents of one controller are recorded and not counted; a match is refused after the season ends", async () => {
  const w = await world(4);
  // two of the players answer to one sponsor
  const sp = await w.k.person("ld-shared");
  const twin1 = await w.k.agent("ld-twin1", sp, { funds: 0 }), twin2 = await w.k.agent("ld-twin2", sp, { funds: 0 });
  const client = await w.k.person("ld-client2", 5000);
  await w.k.runJob(client, twin1, 40); await w.k.runJob(client, twin2, 40);
  const players = [twin1, twin2, ...w.players.slice(0, 2)];
  const s = w.season({ game: "hide-and-seek" });
  await w.k.log.append(s);
  for (const p of players) await w.k.log.append(w.enter(p, s.id));
  jump(2 * DAY + 60_000);
  const entrants = players.map((p) => p.did);
  let round = 0, pair: [string, string] | undefined;
  for (; round < 6; round++) { pair = ladderDraw("seed-2026-12-a", round, entrants).find(([a, b]) => [a, b].every((x) => [twin1.did, twin2.did].includes(x))); if (pair) break; }
  assert.ok(pair, "the draw pairs the twins in some round");
  await w.k.log.append(w.match(s.id, round, pair![0], pair![1]));
  const f = (await w.k.log.ladderFacts(s.id))!;
  const t = rateLadder(f.players, f.matches);
  assert.deepEqual(t.counted.map((c) => c.counted), [false]);
  assert.match(t.counted[0].why, /one controller/);
  jump(19 * DAY);
  assert.equal(await refusedBy(w.k.log.append(w.match(s.id, 1, ladderDraw("seed-2026-12-a", 1, entrants)[0][0], ladderDraw("seed-2026-12-a", 1, entrants)[0][1]))), "ladder_season_over");
});
