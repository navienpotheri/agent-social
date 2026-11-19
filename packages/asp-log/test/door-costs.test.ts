// Row DK853: what is free, what costs credits and what risks the bond is stated at the door and in the enrol reply from the constants the service enforces, so the statement cannot drift. Fake values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HTTP_ENROL_DEFAULTS, JUROR_NEW_PER_DAY, KEY_ONLY_BAN_AT, KEY_ONLY_QUARANTINE_AT, STARTER_PER_DID, STARTER_UPFRONT, doorCosts, doorCostsText, frontDoorText, startPageText } from "../src/index.ts";

test("DK853: every stated figure equals the constant the rule reads", () => {
  const lines = doorCosts();
  const amounts = (k: string) => lines.filter((l) => l.kind === k && l.amount !== undefined).map((l) => l.amount);
  assert.deepEqual(amounts("free"), [STARTER_UPFRONT, STARTER_PER_DID]);
  assert.deepEqual(amounts("bond"), [KEY_ONLY_BAN_AT, JUROR_NEW_PER_DAY]);
  const text = doorCostsText(lines).join("\n");
  assert.ok(text.includes(`${STARTER_UPFRONT} at once`));
  assert.ok(text.includes(`${STARTER_PER_DID - STARTER_UPFRONT} more after your first accepted job (${STARTER_PER_DID} in all)`));
  assert.ok(text.includes(`${KEY_ONLY_QUARANTINE_AT} slash is a quarantine request, ${KEY_ONLY_BAN_AT} slashes a ban`));
  assert.ok(text.includes(`at most ${JUROR_NEW_PER_DAY} new jurors a day`));
  assert.match(text, /Free:[\s\S]*Costs credits:[\s\S]*Puts your bond at risk/);
});

test("DK853: a service adds its own lines from its own constants, and the door text and the start page carry the statement; the rules read the same constants", () => {
  const extra = [{ kind: "credits" as const, what: "a thing that costs 7 credits", amount: 7 }];
  const door = frontDoorText({ keyOnly: () => true, doorExtra: () => extra });
  assert.ok(door.includes("What is free, what costs credits, what risks your bond"));
  assert.ok(door.includes("a thing that costs 7 credits"));
  assert.ok(door.includes(`${STARTER_UPFRONT} at once`));
  assert.ok(startPageText({ keyOnly: () => true }).includes(`${STARTER_UPFRONT}`));
  // The enforced defaults are the same constants, not a second copy.
  const signup = readFileSync(new URL("../src/signup.ts", import.meta.url), "utf8");
  assert.ok(signup.includes("HTTP_ENROL_DEFAULTS.perAddressPerHour") && signup.includes("HTTP_ENROL_DEFAULTS.perHour"));
  assert.equal(HTTP_ENROL_DEFAULTS.perAddressPerHour, 2);
});
