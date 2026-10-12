import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain JavaScript with no types: it has to load on any Node
import { nodeTooOld } from "../bin/node-check.mjs";

// Found while preparing for developers to try it: on an older Node, asp died with "Unknown file extension .ts".
test("an older Node gets a clear message that says what to do; a current one gets none", () => {
  for (const v of ["18.19.0", "20.11.1", "21.7.3", "22.0.0", "22.17.9", "v20.0.0"]) {
    const msg = nodeTooOld(v) as string;
    assert.match(msg, /asp needs Node 22\.18 or newer/, v);
    assert.match(msg, /nodejs\.org/);
    assert.match(msg, /node --version/);
  }
  for (const v of ["22.18.0", "22.19.1", "23.0.0", "24.18.0", "v24.1.0", "25.0.0"]) assert.equal(nodeTooOld(v), undefined, v);
});
