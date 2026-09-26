import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AspError, Job, canonicalize, createRecord, defaultSchemas, signerFromSeed, staticResolver, verifyRecord,
} from "../src/index.ts";

const dir = fileURLToPath(new URL("../../../conformance/", import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(dir + f, "utf8"));

const keys: { kid: string; seed_hex: string; public_key: string }[] = load("keys.json").keys;
const resolve = staticResolver(Object.fromEntries(keys.map((k) => [k.kid, k.public_key])));
const schemas = defaultSchemas();

function codeOf(fn: () => unknown): { code?: string; detail?: string } {
  try {
    fn();
    return {};
  } catch (e) {
    if (e instanceof AspError) return { code: e.code, detail: e.detail };
    throw e;
  }
}

for (const c of load("vectors/canonical.json").cases) {
  test(`canonical: ${c.name}`, () => {
    const value = JSON.parse(c.input_json);
    if (c.error) assert.equal(codeOf(() => canonicalize(value)).code, c.error);
    else assert.equal(canonicalize(value), c.output);
  });
}

for (const c of load("vectors/schema.json").cases) {
  test(`schema: ${c.name}`, () => {
    assert.equal(schemas.isValid(c.schema, c.instance), c.valid);
  });
}

for (const c of load("vectors/records.json").cases) {
  test(`record: ${c.name}`, () => {
    const got = codeOf(() => verifyRecord(c.record, resolve));
    assert.equal(got.code, c.expect === "ok" ? undefined : c.expect.error);
  });
}

for (const c of load("vectors/lifecycle.json").cases) {
  test(`lifecycle: ${c.name}`, () => {
    const job = new Job({ resolve });
    let failedAt = -1;
    let got: { code?: string; detail?: string } = {};
    for (const [i, r] of c.records.entries()) {
      got = codeOf(() => job.apply(r));
      if (got.code) { failedAt = i; break; }
    }
    if ("state" in c.expect) {
      assert.equal(got.code, undefined, `unexpected ${got.code} at ${failedAt}`);
      assert.equal(job.state, c.expect.state);
    } else {
      assert.equal(got.code, c.expect.error);
      assert.equal(failedAt, c.expect.at);
      if (c.expect.guard) assert.equal(got.detail, c.expect.guard);
    }
  });
}

test("signatures are deterministic across SDKs: re-signing reproduces every valid vector", () => {
  const seeds = new Map(keys.map((k) => [k.kid, Buffer.from(k.seed_hex, "hex")]));
  for (const c of load("vectors/records.json").cases.filter((c: any) => c.expect === "ok")) {
    const r = c.record;
    const again = createRecord(
      { type: r.type.slice(4, -5), issuer: r.issuer, actor: r.actor, subject: r.subject, body: r.body, prev: r.prev, issued_at: r.issued_at },
      signerFromSeed(r.sig.kid, seeds.get(r.sig.kid)!),
    );
    assert.equal(again.id, r.id, c.name);
    assert.equal(again.sig.value, r.sig.value, c.name);
  }
});
