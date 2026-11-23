// Rows UC-2200..: ENG88 (the Finds thread starts with labelled house examples, so finds and cards are not an empty room), ENG85 (every limit is in the tool's description and repeated, with the value, in the refusal),
// ENG89 (a cohort-only, default-off setting that leaves out the length caps, and the report says so), ENG86 (the bigger field guide, from the first 25-agent run, for every agent by default; the report shows numbers and whether it was opened).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIRST_25_RUN, HOW_IT_WORKS, buildGuide, renderGuideText } from "../src/cohort/field-guide.ts";
import { relaxLimits, runTool, TOOLS } from "../src/cohort/tools.ts";
import { bootWorld } from "../src/cohort/world.ts";
import { runCohort, type CohortOptions } from "../src/cohort/run.ts";
import { standInProvider } from "../src/cohort/provider.ts";

const all = new Set(TOOLS.map((t) => t.scope));
const mk = (agents: number, b: string[], extra: Partial<CohortOptions> = {}): CohortOptions => ({ out: mkdtempSync(join(tmpdir(), "asp-sd-out-")), home: mkdtempSync(join(tmpdir(), "asp-sd-home-")), agents, model: "stand-in", provider: standInProvider((i) => b[i] ?? "silent", { latencyMs: 4 }), staggerMs: 60, budgetUsd: 2, totalUsd: 2 * agents, minutes: 3, priceIn: 1, priceOut: 5, maxTurns: 60, io: { out: () => undefined }, ...extra } as CohortOptions);

test("ENG88: the Finds thread starts with house examples, labelled as the house's, that say only what is true in this run; none in a run with nothing to find", async () => {
  for (const [opts, n] of [[{ expedition: true, markers: "s" }, 3], [{ expedition: true }, 2], [{}, 0]] as const) {
    const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-sd-finds-")), ...opts });
    try {
      if (!n) { assert.equal(w.api.findsThread, undefined); continue; }
      const th = JSON.parse((await w.api.get(`/forum/posts/${encodeURIComponent(w.api.findsThread!)}`)).text) as { comments: { text: string }[] };
      assert.equal(th.comments.length, n);
      assert.ok(th.comments.every((c) => c.text.startsWith("House example: ") && c.text.length <= 90));
    } finally { await w.close(); }
  }
});

test("ENG85: each limit is in the tool's description, and a refusal repeats the limit with the value that was sent", async () => {
  const d = TOOLS.find((t) => t.name === "forum_comment")!.description;
  assert.match(d, /Limits: .*text up to 90 characters/);
  assert.match(TOOLS.find((t) => t.name === "forum_post")!.description, /title up to 120 characters; text up to 120 characters/);
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-sd-lim-")) });
  try {
    const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
    const post = await runTool(w.api, a, all, "forum_post", { title: "t".repeat(130), text: "x", tags: [] });
    assert.match(post.text, /title is at most 120 characters\. Yours is 130 characters, 10 too many\. The limits of forum_post: .*title up to 120 characters/);
  } finally { await w.close(); }
});

test("ENG89: with the relaxed-limits setting the tool layer does not cap text length, the tools say so, and the report states it; without it nothing changes", async () => {
  const w = await bootWorld({ dir: mkdtempSync(join(tmpdir(), "asp-sd-relax-")), relaxLimits: true });
  try {
    const a = await w.enrol(0, "agent-01"); await w.api.market!.enrolStandalone(a);
    const post = await runTool(w.api, a, all, "forum_post", { title: "A title", text: "A post to comment on.", tags: [] });
    const pid = /sha256:[0-9a-f]{64}/.exec(post.text)![0];
    const long = "x".repeat(200);
    assert.equal((await runTool(w.api, a, all, "forum_comment", { post: pid, text: long })).ok, false);
    w.api.relaxLimits = true;
    const ok = await runTool(w.api, a, all, "forum_comment", { post: pid, text: long });
    assert.equal(ok.ok, true, ok.text);
    const d = relaxLimits(TOOLS).find((t) => t.name === "forum_comment")!;
    assert.match(JSON.stringify(d.input_schema), /"maxLength":900/);
    assert.doesNotMatch(JSON.stringify(d), /at most 90 characters/);
  } finally { await w.close(); }
  const md = readFileSync((await runCohort(mk(1, ["silent"], { relaxLimits: true }))).markdownPath, "utf8");
  assert.match(md, /## Length limits\n\nThe length limits of the tool layer were RELAXED in this run \(`--relax-limits`, cohort only\)/);
  assert.doesNotMatch(readFileSync((await runCohort(mk(1, ["silent"]))).markdownPath, "utf8"), /RELAXED/);
});

test("ENG86: the bigger guide is built from the first 25-agent run (52 refusals), has advice for each of its four refusals and a short account of how the society works, and is offered to every agent by default; the report shows the numbers and whether it was opened", async () => {
  const g = buildGuide(FIRST_25_RUN, FIRST_25_RUN.source, 8);
  assert.deepEqual(g.entries.map((e) => [e.rule, e.count]), [["bad_input", 26], ["market_refused", 22], ["service_404", 3], ["message_message_reply_unknown", 1]]);
  assert.equal(g.refusals, 52);
  const text = renderGuideText(g);
  assert.match(text, /built from the first 25-agent run, 52 refusals by 25 agents/);
  for (const k of ["Jobs:", "Posting a job:", "The forum:", "Talking to a peer:", "Courses:", "Places:"]) assert.ok(HOW_IT_WORKS.includes(k), k);
  const md = readFileSync((await runCohort(mk(2, ["guided-reader", "silent"], { expedition: true }))).markdownPath, "utf8");
  assert.match(md, /The guide listed 4 refusals \(bad_input, market_refused, service_404, message_message_reply_unknown\) from the first 25-agent run\. 2 agents were offered it and 0 were not\./);
  assert.match(md, /Offered: [0-9.]+ refusals an agent .*Not offered: [^.]*\. [0-9]+ of 2 agents opened the guide/);
});
