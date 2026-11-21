// Row DK1716: the outbound scan. A key, a card number or an email address in the arguments of a tool call or in a model request is found by kind and hash, never by value; a key or a card in a call is not run,
// in a model request it is masked before the provider sees it; harmless strings of the same shape are left alone, at the false-positive rate stated below over the fixed corpus. The scan reduces accidents.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanOutboundText } from "@agent-social/asp-package";
import { main, type Io } from "../src/cli.ts";
import { makeFixture } from "./fixture.ts";

const ALICE = "did:web:example.com:users:alice";
const CODER = "did:web:example.com:agents:coder";
const BANK = "did:web:example.com:bank";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

// Fake keys only: made up for this test, not any real account's.
const KEY = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEfake1234";
const CARD = "4532 0151 1283 0366"; // a Luhn-valid number that is not a published test card
const EMAIL = "jane.doe@acme-corp.io";

test("a planted key, a card number and an email address are found by kind, with a hash and not the value", () => {
  const hits = scanOutboundText(`use ${KEY} and charge ${CARD} then mail ${EMAIL}`);
  assert.deepEqual(hits.map((h) => h.kind).sort(), ["Anthropic API key", "card number", "email address"]);
  for (const h of hits) assert.match(h.hash, /^[0-9a-f]{16}$/);
});

const HARMLESS = [
  "version 1.2.3-beta.4 released 2026-11-21", "commit 9fceb02d0ae598e95dc970b74767f19372d61af7", "uuid 123e4567-e89b-12d3-a456-426614174000",
  "epoch 1763730000000 ms", "order number 4000123412341", "build 20261121-0042", "sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "Stripe test card 4242 4242 4242 4242", "4111111111111111 (test)", "ping support@example.com", "noreply@agentsocial.example", "reach me at a@localhost",
  "port 8080 and pid 12345678901", "phone 555 0100 2030", "ip 192.168.100.200", "the number 1234567890123456", "price 1,299.00", "x = 0.30000000000000004",
  "path C:/Users/dev/project/src/index.ts", "token_budget per_run 1000000", "email me: user at example dot com", "git@github.com:org/repo.git",
  "a 19-digit id 1234567890123456789", "lorem ipsum dolor sit amet", "dates 2026-11-21T10:00:00Z", "isbn 978-3-16-148410-0", "hex 0xdeadbeefcafebabe",
  "sk-learn is a library", "the word password is fine", "Bearer of bad news", "AKIA is a prefix", "ghp is not a token", "ratio 3.14159265358979",
  "a long camelCaseIdentifierThatIsNotASecretAtAllButIsLong", "https://example.com/a/b?c=d", "ssh://git@host.example/path", "user@host", "+44 20 7946 0958",
  "Visa test number 4012888888881881 in the docs", "sample card 5555 5555 5555 4444", "see docs.example.org", "release 2026.11.21.1",
];
test("harmless strings of the same shape are not found: 0 false positives over the fixed corpus of 42", () => {
  assert.equal(HARMLESS.length, 42);
  const hit = HARMLESS.filter((t) => scanOutboundText(t).length);
  assert.deepEqual(hit, [], `false positives: ${hit.join(" | ")} (rate ${hit.length}/${HARMLESS.length})`);
});

async function setup(callArgs: Record<string, unknown> | null) {
  const f = makeFixture();
  const asp = async (args: string[]) => { const out: string[] = []; const err: string[] = []; const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env: { ASP_HOME: f.aspHome }, cwd: f.root }; return { code: await main(args, io), out: out.join("\n"), err: err.join("\n") }; };
  const ok = async (args: string[]) => { const r = await asp(args); assert.equal(r.code, 0, `${args.join(" ")}: ${r.err || r.out}`); return r; };
  await ok(["identity", "new", "--kind", "human", "--did", ALICE]);
  await ok(["identity", "new", "--kind", "agent", "--did", CODER, "--sponsor", ALICE, "--purpose", "Work"]);
  await ok(["identity", "new", "--kind", "human", "--did", BANK]);
  await ok(["credits", "grant", "--to", ALICE, "--amount", "1000"]);
  await ok(["credits", "grant", "--to", CODER, "--amount", "200"]);
  const intent = /^intent (\S+)/.exec((await ok(["market", "intent", "--by", ALICE, "--purpose", "Scan", "--budget", "1000", "--deadline", "2026-12-01T00:00:00Z"])).out)![1];
  const offer = /^offer (\S+)/.exec((await ok(["market", "offer", "--by", CODER, "--intent", intent, "--price", "1000", "--plan", "go", "--eta", "2026-11-01T00:00:00Z"])).out)![1];
  const contract = /^contract (\S+):/.exec((await ok(["market", "contract", "--principal", ALICE, "--bank", BANK, "--intent", intent, "--offer", offer])).out)![1];
  await ok(["market", "bond", "--contract", contract, "--backer", CODER, "--amount", "200", "--escrow-payer", ALICE, "--escrow-amount", "1000"]);
  await ok(["market", "mandate", "--contract", contract, "--principal", ALICE, "--performer", CODER, "--scopes", "repo.read"]);
  const seen: string[] = [];
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    seen.push(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    const message = callArgs ? { role: "assistant", content: "reading", tool_calls: [{ id: "a", type: "function", function: { name: "read_file", arguments: JSON.stringify(callArgs) } }] } : { role: "assistant", content: "ok" };
    res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 3, completion_tokens: 3 }, choices: [{ index: 0, finish_reason: callArgs ? "tool_calls" : "stop", message }] }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  servers.push(upstream);
  const url = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`;
  const runLog = () => { const dir = join(f.aspHome, "runs"); const d = readdirSync(dir).sort().at(-1)!; return readFileSync(join(dir, d, "run-log.ndjson"), "utf8"); };
  /** The agent script reads its prompt from a file, so the prompt is not in the command line the run log records. */
  const script = (prompt: string) => { writeFileSync(join(f.root, "prompt.txt"), prompt); return `import { readFileSync } from "node:fs"; const p = readFileSync(${JSON.stringify(join(f.root, "prompt.txt"))}, "utf8"); const r = await fetch(process.env.OPENAI_BASE_URL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: p }] }) }); await r.json();`; };
  return { asp, contract, url, seen, runLog, script };
}

test("a key in a tool call is not run, and the run log names its kind and a hash and holds no value", async () => {
  const w = await setup({ path: `notes-${KEY}.txt` });
  const run = await w.asp(["gateway", "--contract", w.contract, "--by", CODER, "--openai-upstream", w.url, "--", process.execPath, "--input-type=module", "-e", w.script("read my notes")]);
  assert.equal(run.code, 0, run.err);
  assert.match(run.err, /REFUSED +read_file.*carry Anthropic API key \([0-9a-f]{16}\)/);
  const log = w.runLog();
  assert.match(log, /"outbound_hit"/);
  assert.match(log, /"kind":"Anthropic API key"/);
  assert.doesNotMatch(log, /FAKEFAKEFAKE/, "the key is nowhere in the run log");
});

test("a card number or a key in a model request is masked before the provider sees it; an email address is only recorded", async () => {
  const w = await setup(null);
  const run = await w.asp(["gateway", "--contract", w.contract, "--by", CODER, "--openai-upstream", w.url, "--", process.execPath, "--input-type=module", "-e", w.script(`pay with ${CARD}, key ${KEY}, write to ${EMAIL}`)]);
  assert.equal(run.code, 0, run.err);
  assert.equal(w.seen.length, 1);
  assert.doesNotMatch(w.seen[0]!, /4532 0151|FAKEFAKEFAKE/, "the provider got neither the card nor the key");
  assert.match(w.seen[0]!, /\[redacted card number\]/);
  assert.match(w.seen[0]!, /\[redacted Anthropic API key\]/);
  assert.match(w.seen[0]!, /jane\.doe@acme-corp\.io/, "an email address is recorded, not removed, in the default mode");
  const log = w.runLog();
  assert.match(log, /"where":"model_request"/);
  for (const kind of ["card number", "Anthropic API key", "email address"]) assert.match(log, new RegExp(`"kind":"${kind}"`));
  const hitLines = log.split("\n").filter((l) => l.includes('"outbound_hit"')).join("\n");
  assert.doesNotMatch(hitLines, /4532 0151|FAKEFAKEFAKE|jane\.doe@/, "no hit record holds a value");
  assert.doesNotMatch(log, /4532 0151|FAKEFAKEFAKE/, "the key and the card are masked in the run log's own copy of the request too");
});

test("--outbound-scan block refuses the model request itself; --outbound-scan off sends it as it is; a bad mode is a usage error", async () => {
  const w = await setup(null);
  const blocked = await w.asp(["gateway", "--contract", w.contract, "--by", CODER, "--outbound-scan", "block", "--openai-upstream", w.url, "--", process.execPath, "--input-type=module", "-e", w.script(`mail ${EMAIL}`)]);
  assert.equal(w.seen.length, 0, "the provider was not called");
  assert.match(blocked.err, /the model request was not sent: it carries email address/);
  const off = await w.asp(["gateway", "--contract", w.contract, "--by", CODER, "--outbound-scan", "off", "--openai-upstream", w.url, "--", process.execPath, "--input-type=module", "-e", w.script(`key ${KEY}`)]);
  assert.equal(off.code, 0);
  assert.match(w.seen[0]!, /FAKEFAKEFAKE/);
  const bad = await w.asp(["gateway", "--contract", w.contract, "--by", CODER, "--outbound-scan", "maybe", "--openai-upstream", w.url, "--", "true"]);
  assert.notEqual(bad.code, 0);
});
