// The gateway's judge (mutation check, launch-bar-2, 2026-11-22): seven of 26 operator mutants of judge.ts went undetected by the gateway tests. These cases pin them: a flag that looks like a host is not a host, a
// tripwire trips on a name in the call and an exact target and is not fooled by its own prefix, a command on the known-bad list is refused as a shell command only, a URL in a call's own fields is read, and an
// MCP server that declares nothing (or an empty list, or no name) is refused with its own words. Fake hosts and fake fingerprints only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hostsOf, judge, mcpDestinationProblem, trippedBy } from "../src/gateway/judge.ts";

const bash = (command: string) => ({ name: "Bash", args: { command } });

test("a flag that contains a dot is not read as a host, and a URL token is read once as the host that it names", () => {
  assert.deepEqual(hostsOf(bash("curl --user-agent=my.agent -o out.json https://example.org/x"), "shell.network"), ["example.org"]);
  assert.deepEqual(hostsOf(bash("curl -H Accept:text.html example.org"), "shell.network"), ["example.org"]);
  assert.deepEqual(hostsOf(bash("curl -s --retry-all-errors v1.2.3 example.org"), "shell.network").includes("v1.2.3"), false);
});

test("a URL in a call's own url field is read as a host, whatever else the call carries", () => {
  assert.deepEqual(hostsOf({ name: "web_fetch", args: { url: "https://docs.example.org/page", note: "x.y.z" } }, "web.read"), ["docs.example.org"]);
  assert.deepEqual(hostsOf({ name: "web_fetch", args: { href: "api.example.org/v1", other: 5 } }, "web.read"), ["api.example.org"]);
  assert.deepEqual(hostsOf({ name: "web_fetch", args: { note: "https://not-a-url-field.example.org" } }, "web.read"), [], "only the named URL fields are read for a non-shell scope");
});

test("a tripwire trips on an exact target, on a bare fragment anywhere in the call, and without regard to case; a prefixed tripwire is not fooled by its own text", () => {
  const call = { name: "Read", args: { file_path: "/home/me/.aws/Credentials-Backup" } };
  assert.equal(trippedBy(call, ["path:/home/me/.aws/credentials-backup"]), "path:/home/me/.aws/credentials-backup", "an exact target, case-insensitively");
  assert.equal(trippedBy(call, ["credentials-backup"]), "credentials-backup", "a bare fragment");
  assert.equal(trippedBy(call, ["CREDENTIALS-BACKUP"]), "CREDENTIALS-BACKUP", "a bare fragment in another case");
  assert.equal(trippedBy(call, ["nothing-like-it"]), undefined);
  assert.equal(trippedBy(call, []), undefined, "no tripwires");
  // A prefixed tripwire matches a target only: the same words in the call's text are not enough.
  const talk = { name: "Bash", args: { command: "echo host:honeypot.example" } };
  assert.equal(trippedBy(talk, ["host:honeypot.example"]), undefined, "the words host:honeypot.example in an echo are not a call to that host");
  assert.equal(trippedBy({ name: "Bash", args: { command: "curl https://honeypot.example/x" } }, ["host:honeypot.example"]), "host:honeypot.example", "a real call to it is");
  assert.equal(trippedBy({ name: "Bash", args: { command: "curl https://honeypot.example/x" } }, ["honeypot.example"]), "honeypot.example", "and by the bare name");
});

test("a command on the known-bad list is refused as a shell command, and the same fingerprint on another kind of call is not", () => {
  const first = judge(bash("node build.js"), ["shell.exec"]);
  assert.equal(first.allow, true);
  const fp = `${first.artifact!.uri}#${first.artifact!.sha256}`;
  const refused = judge(bash("node build.js"), ["shell.exec"], [{ fingerprint: fp, report: "r1" } as never]);
  assert.equal(refused.allow, false);
  assert.match(refused.allow ? "" : (refused.reason ?? ""), /known-bad list/);
  const notShell = judge({ name: "Read", args: { file_path: "a.txt" } }, ["repo.read"], [{ fingerprint: fp, report: "r1" } as never]);
  assert.equal(notShell.allow, true, "a read of a file is not a shell command");
  // The list marks commands: a call that is not a shell command with the very same fingerprint as an entry is not refused by it.
  const read = judge({ name: "Read", args: { file_path: "a.txt" } }, ["repo.read"]);
  const readFp = `${read.artifact!.uri}#${read.artifact!.sha256}`;
  assert.equal(judge({ name: "Read", args: { file_path: "a.txt" } }, ["repo.read"], [{ fingerprint: readFp, report: "r2" } as never]).allow, true, "the known-bad list is for shell commands");
});

test("an MCP server that declares nothing, an empty list or no name is refused in words, and a declared destination inside the hosts is allowed", () => {
  const hosts = ["api.example.org"];
  const call = (name: string) => ({ name, args: { id: 1 } });
  assert.match(mcpDestinationProblem(call("mcp__fetcher__get"), hosts, {})!, /does not declare where its tools reach/);
  assert.match(mcpDestinationProblem(call("mcp__fetcher__get"), hosts, { fetcher: [] })!, /does not declare where its tools reach/, "an empty list declares nothing");
  assert.match(mcpDestinationProblem(call("mcp__"), hosts, {})!, /\(unnamed\)/, "a call with no server name");
  assert.equal(mcpDestinationProblem(call("mcp__fetcher__get"), hosts, { fetcher: ["api.example.org"] }), undefined);
  assert.match(mcpDestinationProblem(call("mcp__fetcher__get"), hosts, { fetcher: ["other.example.org"] })!, /other\.example\.org.*not one this job's Mandate allows/);
});
