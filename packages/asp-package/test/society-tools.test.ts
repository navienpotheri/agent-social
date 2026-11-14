import { test } from "node:test";
import assert from "node:assert/strict";
import { aspHandler } from "../src/gateway/mcp.ts";

// The agent's view of the society inside its loop (DK3, DK4): the tools only pass through to what the CLI supplies; the log is the authority on what may be bought.
const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;

test("with a society the agent gets asp_standing, and asp_buy only when the run holds its key; without one it gets neither", async () => {
  const none = aspHandler({});
  assert.deepEqual((await none.listTools()).map((t) => t.name).filter((n) => n === "asp_standing" || n === "asp_buy"), []);
  const readOnly = aspHandler({ society: { standing: async () => "credits: 5" } });
  assert.ok((await readOnly.listTools()).some((t) => t.name === "asp_standing"));
  assert.ok(!(await readOnly.listTools()).some((t) => t.name === "asp_buy"), "no key, no buying");
  const full = aspHandler({ society: { standing: async () => "credits: 5", buy: async () => "bought" } });
  assert.deepEqual((await full.listTools()).map((t) => t.name).filter((n) => n === "asp_standing" || n === "asp_buy").sort(), ["asp_buy", "asp_standing"]);
  assert.match(String(full.instructions?.()), /asp_standing shows your balance, tier and what you may buy; asp_buy spends within that budget/);
  assert.doesNotMatch(String(readOnly.instructions?.()), /asp_buy/);
});

test("asp_standing returns what the CLI built; asp_buy passes the service and quantity through, refuses a missing service or a bad quantity, and shows the log's refusal as the answer", async () => {
  const calls: [string, number][] = [];
  const h = aspHandler({
    society: {
      standing: async () => "credits: 120\ntier 1\nacademy 0 of 60 this month",
      buy: async (service, q) => { calls.push([service, q]); if (service === "market.expensive") throw new Error("institution_spend_cap_exceeded: the Mandate caps academy at 60 credits a month"); return `bought ${service} x${q}`; },
    },
  });
  assert.match(text(await h.callTool("asp_standing", {})), /credits: 120\ntier 1\nacademy 0 of 60 this month/);
  assert.equal(text(await h.callTool("asp_buy", { service: "academy.exam.sit" })), "bought academy.exam.sit x1");
  assert.equal(text(await h.callTool("asp_buy", { service: "academy.exam.sit", quantity: 3 })), "bought academy.exam.sit x3");
  assert.deepEqual(calls, [["academy.exam.sit", 1], ["academy.exam.sit", 3]]);
  const noService = await h.callTool("asp_buy", {});
  assert.equal(noService.isError, true);
  assert.equal((await h.callTool("asp_buy", { service: "x", quantity: 0 })).isError, true);
  const refused = await h.callTool("asp_buy", { service: "market.expensive" });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /institution_spend_cap_exceeded/);
  assert.equal(calls.length, 3, "a refused argument never reached the buyer");
});

test("asp_price is offered only when the CLI supplies prices; it passes the service through (or none for the whole list) and says in the instructions that it shows costs before buying (DK4)", async () => {
  const asked: (string | undefined)[] = [];
  const without = aspHandler({ society: { standing: async () => "credits: 5" } });
  assert.ok(!(await without.listTools()).some((t) => t.name === "asp_price"));
  assert.doesNotMatch(String(without.instructions?.()), /asp_price/);
  const h = aspHandler({ society: { standing: async () => "credits: 5", price: async (s) => { asked.push(s); return `price of ${s ?? "everything"}`; } } });
  assert.ok((await h.listTools()).some((t) => t.name === "asp_price"));
  assert.match(String(h.instructions?.()), /asp_price shows what each service costs before you buy/);
  assert.equal(text(await h.callTool("asp_price", { service: "academy.exam.sit" })), "price of academy.exam.sit");
  assert.equal(text(await h.callTool("asp_price", {})), "price of everything");
  assert.deepEqual(asked, ["academy.exam.sit", undefined]);
});

test("the School's tools (AC-19): academy_catalog passes the CLI's catalogue through, academy_enrol only when the run holds the agent's key, and the instructions say promotion is earned, not bought", async () => {
  const enrolled: string[] = [];
  const read = aspHandler({ society: { standing: async () => "credits: 5", academy: { catalog: async () => "co1  Working inside a Mandate" } } });
  assert.ok((await read.listTools()).some((t) => t.name === "academy_catalog"));
  assert.ok(!(await read.listTools()).some((t) => t.name === "academy_enrol"), "no key, no enrolling");
  assert.equal(text(await read.callTool("academy_catalog", {})), "co1  Working inside a Mandate");
  const full = aspHandler({ society: { standing: async () => "credits: 5", academy: { catalog: async () => "x", enrol: async (c) => { enrolled.push(c); return `enrolled in ${c}`; } } } });
  assert.equal(text(await full.callTool("academy_enrol", { course: "co1" })), "enrolled in co1");
  assert.equal((await full.callTool("academy_enrol", {})).isError, true);
  assert.deepEqual(enrolled, ["co1"]);
  assert.match(String(full.instructions?.()), /Promotion to a higher tier is earned, not bought/);
  assert.doesNotMatch(String(aspHandler({ society: { standing: async () => "x" } }).instructions?.()), /The School teaches/);
});

test("the Bank's tools (DK181): bank_line_offer and bank_statement are offered only when the CLI supplies them, and a call shows what the CLI read from the log", async () => {
  const none = aspHandler({ society: { standing: async () => "x" } });
  assert.ok(!(await none.listTools()).some((t) => t.name.startsWith("bank_")));
  const h = aspHandler({ society: { standing: async () => "x", bank: { offer: async () => "The Bank would lend you up to 60 credits for your first bond", statement: async () => "balance 0; owed to the Bank 20; locked in bonds 20" } } });
  const names = (await h.listTools()).map((t) => t.name);
  assert.ok(names.includes("bank_line_offer") && names.includes("bank_statement"));
  assert.match(((await h.callTool("bank_line_offer", {})).content[0] as { text: string }).text, /would lend you up to 60 credits/);
  assert.match(((await h.callTool("bank_statement", { balance: 999 })).content[0] as { text: string }).text, /balance 0; owed to the Bank 20/, "arguments change nothing");
});

test("the Insurer's tools (DK184): insurance_quote is offered when the CLI supplies a quote, insurance_buy only when the run holds the keys a sale needs, and a call passes the contract, cover and amount through", async () => {
  const seen: unknown[] = [];
  const quote = async (contract: string, cover: string, amount?: number) => { seen.push(["quote", contract, cover, amount]); return "bond_slash cover: insured 20, premium 2"; };
  const readOnly = aspHandler({ society: { standing: async () => "x", insurance: { quote } } });
  assert.deepEqual((await readOnly.listTools()).map((t) => t.name).filter((n) => n.startsWith("insurance_")), ["insurance_quote"]);
  const full = aspHandler({ society: { standing: async () => "x", insurance: { quote, buy: async (c, k, a) => { seen.push(["buy", c, k, a]); return "policy sha256:ab: bond_slash cover, 20 insured, premium 2 paid"; } } } });
  assert.deepEqual((await full.listTools()).map((t) => t.name).filter((n) => n.startsWith("insurance_")), ["insurance_quote", "insurance_buy"]);
  assert.match(((await full.callTool("insurance_quote", { contract: "sha256:c", cover: "bond_slash" })).content[0] as { text: string }).text, /premium 2/);
  assert.match(((await full.callTool("insurance_buy", { contract: "sha256:c", cover: "failed_job", amount: 30 })).content[0] as { text: string }).text, /premium 2 paid/);
  assert.deepEqual(seen, [["quote", "sha256:c", "bond_slash", undefined], ["buy", "sha256:c", "failed_job", 30]]);
});
