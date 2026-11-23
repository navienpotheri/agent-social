// Row DK1316: two more small games in the games hall (behind --games), played by fixed rules by the house referee (a program): a word-pair game and a trading game; moves are checked against the rule and committed by a hash,
// a round is played when it is full, results are recomputable from the entries, and the report says how many rounds of each game were played. Scripted only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameHall, GAMES, renderGames } from "../src/cohort/games.ts";
import { playTrade, playWordPair, promptOf } from "../src/cohort/games-extra.ts";

const hall = (): GameHall => new GameHall({ pay: async () => undefined });

test("word-pair: the prompt is named when the round opens, moves are checked, and the score is the others who named the same word plus one for a listed word", async () => {
  assert.equal(promptOf(1), "salt");
  const h = hall();
  assert.match(h.list(), /word-pair: The referee names a prompt word; .* A move looks like \{"word": "pepper"\}\. Round word-pair-[0-9]+ \(the prompt word is "salt"\): 0 of 4 entered/s);
  await assert.rejects(h.enter("d1", "agent-01", "word-pair", '{"word": "Pepper"}'), /one lowercase word, 2 to 12 letters/);
  await assert.rejects(h.enter("d1", "agent-01", "word-pair", '{"word": 5}'), /not a move of word-pair/);
  await h.enter("d1", "agent-01", "word-pair", '{"word": "pepper"}');
  await h.enter("d2", "agent-02", "word-pair", '{"word": "pepper"}');
  await h.enter("d3", "agent-03", "word-pair", '{"word": "sea"}');
  const done = await h.enter("d4", "agent-04", "word-pair", '{"word": "chair"}');
  const r = done.played!;
  assert.deepEqual(r.results!.map((x) => [x.handle, x.score, x.rank]), [["agent-01", 2, 1], ["agent-02", 2, 2], ["agent-03", 1, 3], ["agent-04", 0, 4]], "pepper: one other plus a listed word; sea: listed; chair: nothing");
  assert.deepEqual(h.verify(r), [], "recomputes");
  r.results![2]!.score = 5;
  assert.match(h.verify(r).join(";"), /agent-03's result does not recompute/);
  assert.equal(promptOf(2), "night", "the next round has the next prompt");
});

test("trading: limits are checked, the market clears at one price, and a matched player scores what it gained against its own limit", async () => {
  // buyers 15 and 10, sellers 8 and 12: the first pair matches (15 >= 8), the second does not (10 < 12); price = floor((15 + 8) / 2) = 11
  const direct = playTrade([{ agent: "b1", move: { side: "buy", limit: 15 } }, { agent: "b2", move: { side: "buy", limit: 10 } }, { agent: "s1", move: { side: "sell", limit: 8 } }, { agent: "s2", move: { side: "sell", limit: 12 } }]);
  assert.equal(direct.price, 11);
  assert.deepEqual(direct.map((x) => [x.agent, x.score, x.rank]), [["b1", 4, 1], ["s1", 3, 2], ["b2", 0, 3], ["s2", 0, 4]]);
  assert.deepEqual(playTrade([{ agent: "b", move: { side: "buy", limit: 5 } }, { agent: "s", move: { side: "sell", limit: 9 } }]).map((x) => x.score), [0, 0], "no trade, no gain");
  const h = hall();
  await assert.rejects(h.enter("d1", "agent-01", "trading", '{"side": "swap", "limit": 5}'), /side buy or sell, a whole limit from 1 to 20/);
  await assert.rejects(h.enter("d1", "agent-01", "trading", '{"side": "buy", "limit": 25}'), /not a move of trading/);
  for (const [i, m] of ['{"side":"buy","limit":15}', '{"side":"buy","limit":10}', '{"side":"sell","limit":8}', '{"side":"sell","limit":12}'].entries()) {
    const out = await h.enter(`d${i}`, `agent-0${i + 1}`, "trading", m);
    if (i === 3) {
      assert.equal(out.played!.price, 11);
      assert.deepEqual(h.verify(out.played!), []);
      assert.match(out.text, /you came 4 of 4 with a score of 0/);
    }
  }
  const md = renderGames(h);
  assert.match(md, /- trading-[0-9]+ \(cleared at 11\): 1\. agent-01 \(4\), 2\. agent-03 \(3\)/);
  assert.match(md, /Rounds played to the end by game: twenty-one 0, hide-and-seek 0, word-pair 0, trading 1\. Each round has a hashed transcript and the referee is a program of the house; no text says anyone should play\./);
  assert.deepEqual(Object.keys(GAMES), ["twenty-one", "hide-and-seek", "word-pair", "trading"]);
  assert.equal(playWordPair("salt", [{ agent: "x", move: { word: "sea" } }])[0]!.score, 1);
  void mkdtempSync; void tmpdir; void join;
});
