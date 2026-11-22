// Row DK1801, after the owner's real runs: every limit of a tool's arguments is in its description, so a first call is within it, and a refused call says the limits of the tool and that nothing was done.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORUM_FORM } from "@agent-social/asp-package";
import { defOf, limitsOf, runTool, TOOLS } from "../src/cohort/tools.ts";

const world = { base: "http://127.0.0.1:1", get: async () => ({ status: 200, text: "{}" }), postJson: async () => ({ status: 201, json: {} }), now: () => new Date() };
const agent = { n: 0, id: "a", did: "did:key:z", kid: "did:key:z#key-1", seed: new Uint8Array(32), handle: "a" };
const all = new Set(TOOLS.map((t) => t.scope));

test("each argument with a length, a range or a count is stated in the tool's description", () => {
  let checked = 0;
  for (const t of TOOLS) {
    const props = t.input_schema.properties as Record<string, { type?: string; maxLength?: number; maximum?: number; minimum?: number; maxItems?: number }>;
    for (const [k, p] of Object.entries(props)) {
      if (p.type === "string" && p.maxLength) { assert.ok(t.description.includes(`${k} up to ${p.maxLength} characters`), `${t.name}: ${k} limit is in the description`); checked++; }
      if (p.type === "integer" && p.maximum !== undefined) { assert.ok(t.description.includes(`${k} from ${p.minimum ?? "any"} to ${p.maximum}`), `${t.name}: ${k} range is in the description`); checked++; }
      if (p.type === "array" && p.maxItems) { assert.ok(t.description.includes(`${k} up to ${p.maxItems} items`), `${t.name}: ${k} count is in the description`); checked++; }
    }
  }
  assert.ok(checked >= 25, `${checked} limits stated`);
  assert.match(defOf("forum_post")!.description, new RegExp(`text up to ${FORUM_FORM.shortPostChars} characters`));
  assert.match(defOf("forum_comment")!.description, new RegExp(`text up to ${FORUM_FORM.shortCommentChars} characters`));
  assert.equal(limitsOf({ input_schema: { type: "object", properties: { a: { type: "string" } } } }), "", "a tool with no limits states none");
});

test("a call over a limit is refused with the tool's limits and 'nothing was done', so the second call fits", async () => {
  const long = await runTool(world, agent, all, "forum_post", { title: "Thoughts", text: "x".repeat(FORUM_FORM.shortPostChars + 10) });
  assert.deepEqual([long.ok, long.refused], [false, "bad_input"]);
  assert.match(long.text, new RegExp(`text is at most ${FORUM_FORM.shortPostChars} characters`));
  assert.match(long.text, new RegExp(`The limits of forum_post: title up to 120 characters; text up to ${FORUM_FORM.shortPostChars} characters; tags up to 4 items of up to 24 characters`));
  assert.match(long.text, /Nothing was done/);
  const wrongEnum = await runTool(world, agent, all, "forum_vote", { target: "x", value: 3 });
  assert.match(wrongEnum.text, /value is one of 1, -1/);
});
