// The GitHub Action and its sample pipeline (register row DK64): the example uses every required input of the Action, names no input the Action does not have, and holds no secret in the file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");

/** The input names under `inputs:` and which are required, read from the Action's YAML without a YAML library. */
function actionInputs(yml: string): { names: string[]; required: string[] } {
  const block = yml.slice(yml.indexOf("inputs:"), yml.indexOf("runs:"));
  const names: string[] = [], required: string[] = [];
  let current = "";
  for (const line of block.split("\n")) {
    const m = /^  ([a-z-]+):\s*$/.exec(line);
    if (m) { current = m[1]; names.push(current); }
    else if (current && /^    required: true/.test(line)) required.push(current);
  }
  return { names, required };
}

test("the sample pipeline passes every required input of the Action and none it does not have", () => {
  const { names, required } = actionInputs(read(".github/actions/asp-run/action.yml"));
  assert.ok(required.length >= 6, "the Action has its required inputs");
  const example = read("docs/examples/asp-run-workflow.yml");
  const withBlock = example.slice(example.indexOf("with:", example.indexOf("asp-run@")));
  const used = [...withBlock.matchAll(/^          ([a-z-]+):/gm)].map((m) => m[1]);
  for (const r of required) assert.ok(used.includes(r), `the sample passes the required input ${r}`);
  for (const u of used) assert.ok(names.includes(u), `${u} is an input of the Action`);
});

test("the sample holds no secret: the token, the passphrase and the API key come from the repository's secrets", () => {
  const example = read("docs/examples/asp-run-workflow.yml");
  for (const key of ["asp-log-token", "backup-passphrase", "anthropic-api-key"]) {
    assert.match(example, new RegExp(String.raw`${key}: \$\{\{ secrets\.[A-Z_]+ \}\}`), `${key} is a secret reference`);
  }
  assert.doesNotMatch(example, /sk-ant-|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}/, "no key-shaped text");
});
