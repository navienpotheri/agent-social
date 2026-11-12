import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGateway, type Gateway } from "../src/index.ts";
import { requestsOfScript, requestsOfCall, scriptRequestsOf } from "../src/gateway/script-requests.ts";

const servers: Server[] = [];
const gateways: Gateway[] = [];
after(async () => { for (const s of servers) s.close(); for (const g of gateways) await g.close(); });

test("requestsOfScript: a request in a loop is unbounded, a literal range multiplies, a lone request is one, a file with no request is nothing, hosts come from the URLs written in it", () => {
  const loop = requestsOfScript("import requests\nfor w in words:\n    requests.post('https://target.example/login', data={'pw': w})\n", "other")!;
  assert.deepEqual(loop.perHost, { "target.example": 1000 });
  const ranged = requestsOfScript("import requests\nfor i in range(5):\n    requests.get('https://a.example/x')\n", "other")!;
  assert.deepEqual(ranged.perHost, { "a.example": 5 });
  const one = requestsOfScript("import requests\nr = requests.get('https://a.example/x')\nprint(r.status_code)\n", "other")!;
  assert.deepEqual(one.perHost, { "a.example": 1 });
  assert.equal(requestsOfScript("print('hello')\nfor i in range(3): print(i)\n", "other"), undefined);
  const js = requestsOfScript("const urls = ['https://a.example/1','https://b.example/2'];\nawait Promise.all(urls.map((u) => fetch(u)));", "other")!;
  assert.deepEqual(js.perHost, { "a.example": 1000, "b.example": 1000 });
  const noHost = requestsOfScript("while True:\n    s = socket.create_connection((host, 22))\n", "other")!;
  assert.deepEqual([noHost.unknown, noHost.total], [1000, 1000]);
  const sh = requestsOfScript("for i in $(seq 1 50); do curl -s https://a.example/$i; done\n", "shell")!;
  assert.deepEqual(sh.perHost, { "a.example": 50 });
});

test("scriptRequestsOf and requestsOfCall: a script named in the command is read when it is inside the project; one outside, a missing file and a command without a script are not", () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-script-"));
  writeFileSync(join(dir, "scan.py"), "import requests\nfor w in words:\n    requests.get('https://target.example/' + w)\n");
  const call = (command: string) => ({ name: "bash", args: { command } });
  assert.deepEqual(scriptRequestsOf(call("python scan.py"), dir)?.perHost, { "target.example": 1000 });
  assert.equal(scriptRequestsOf(call("python ../scan.py"), dir), undefined, "outside the project");
  assert.equal(scriptRequestsOf(call("python missing.py"), dir), undefined);
  assert.equal(scriptRequestsOf(call("git status"), dir), undefined);
  assert.equal(scriptRequestsOf(call("python scan.py"), undefined), undefined);
  // For a command that is already a network command the larger count per host wins; the command's own host stays.
  const both = requestsOfCall(call("curl https://docs.example.org/a && python scan.py"), "shell.network", dir);
  assert.equal(both.perHost["docs.example.org"], 1);
  assert.equal(both.perHost["target.example"], 1000);
  assert.equal(both.unknown, 0);
});

// Gap H17: a script that imports a sibling file in the project is followed one level in, so the requests its import makes are counted too; the import's own imports are not read.
test("scriptRequestsOf: a script's own relative import is followed one level, so the requests it makes count too; that file's own imports are not followed", () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-script-imp-"));
  writeFileSync(join(dir, "helper.py"), "import requests\nrequests.get('https://helper.example/x')\n");
  writeFileSync(join(dir, "deeper.py"), "import requests\nrequests.get('https://deeper.example/x')\n");
  writeFileSync(join(dir, "via_helper.py"), "import helper\nimport requests\nrequests.get('https://main.example/x')\n");
  writeFileSync(join(dir, "chain.js"), "const { go } = require('./helper.js');\nfetch('https://main.example/x');\n");
  writeFileSync(join(dir, "helper.js"), "require('./deeper.js');\nmodule.exports.go = () => fetch('https://helper.example/x');\n");
  writeFileSync(join(dir, "deeper.js"), "fetch('https://deeper.example/x');\n");
  const call = (command: string) => ({ name: "bash", args: { command } });
  const py: Record<string, number> = scriptRequestsOf(call("python via_helper.py"), dir)!.perHost;
  assert.equal(py["deeper.example"], undefined, "helper.py itself imports nothing, so there is no second level to follow");
  assert.deepEqual(py, { "main.example": 1, "helper.example": 1 });
  const js: Record<string, number> = scriptRequestsOf(call("node chain.js"), dir)!.perHost;
  assert.equal(js["deeper.example"], undefined, "chain.js's own import (helper.js) is read; helper.js's import (deeper.js) is one level further and is not");
  assert.deepEqual(js, { "main.example": 1, "helper.example": 1 });
});

test("gateway: running a project script that hammers a host is refused by the rate limit (no strike); a script that makes one request, and a script with no requests, go through", async () => {
  const dir = mkdtempSync(join(tmpdir(), "asp-script-gw-"));
  writeFileSync(join(dir, "scan.py"), "import requests\nfor w in words:\n    requests.get('https://docs.example.org/' + w)\n");
  writeFileSync(join(dir, "one.py"), "import requests\nrequests.get('https://docs.example.org/')\n");
  writeFileSync(join(dir, "calc.py"), "print(1 + 1)\n");
  const reply = (cmds: string[]) => JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: cmds.map((c, i) => ({ id: String(i), type: "function", function: { name: "bash", arguments: JSON.stringify({ command: c }) } })) } }] });
  const up = createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(reply(["python scan.py", "python one.py", "python calc.py"])); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r)); servers.push(up);
  const g = createGateway({ openaiUpstream: `http://127.0.0.1:${(up.address() as { port: number }).port}/v1`, scopes: ["repo.read", "shell.exec", "shell.network"], confineTo: dir, rate: { per_host_per_minute: 10, total_per_minute: 20 } });
  const port = await g.listen(); gateways.push(g);
  const out: any = await (await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [] }) })).json();
  const calls = out.choices[0].message.tool_calls.map((c: any) => JSON.parse(c.function.arguments).command);
  assert.deepEqual(calls, ["python one.py", "python calc.py"]);
  assert.match(out.choices[0].message.content, /this call makes about 1000 network requests/);
  assert.equal(g.summary().strikes, 0);
  assert.equal(g.drain().metrics.rate_limited, 1);
});
