// The listening institution's edges (register row DK1722; found loose by a mutation check): a response at exactly the target is not late, a hearing with no response at exactly the target is not yet overdue, only the first reply
// and the first agenda item count, and the response time is rounded to a tenth of an hour. Synthetic support records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listeningStatus } from "../src/support.ts";

let n = 0;
const H = 3_600_000, T0 = Date.parse("2026-11-01T00:00:00Z");
const at = (hours: number) => new Date(T0 + hours * H).toISOString();
const sup = (issuer: string, hoursAfter: number, body: Record<string, unknown>) => ({ id: `s${++n}`, type: "asp.support/v0.2", issuer, issued_at: at(hoursAfter), body }) as never;
const ticket = (hoursAfter: number) => { const r = sup("did:web:x:agent-a", hoursAfter, { act: "ticket", topic: "suggestion", text: "please" }); return r as { id: string };
};

test("a reply at exactly the target is on time, one a moment later is late; a hearing with no reply is overdue only past the target", () => {
  const t = ticket(0) as never as { id: string };
  const onTime = sup("did:web:asp.local:operator", 48, { act: "reply", ticket: (t as { id: string }).id, text: "heard" });
  assert.equal(listeningStatus([t as never, onTime], at(100)).hearings[0].response!.late, false, "48 hours exactly");
  const late = sup("did:web:asp.local:operator", 48.1, { act: "reply", ticket: (t as { id: string }).id, text: "heard" });
  assert.equal(listeningStatus([t as never, late], at(100)).hearings[0].response!.late, true);
  assert.equal(listeningStatus([t as never], at(48)).hearings[0].overdue, false, "at exactly the target it is not yet overdue");
  assert.equal(listeningStatus([t as never], at(48.1)).hearings[0].overdue, true);
  assert.equal(listeningStatus([t as never], at(48.1)).overdue, 1);
});

test("only the first reply and the first agenda item count, and the time is rounded to a tenth of an hour", () => {
  const t = ticket(0) as never as { id: string };
  const id = (t as { id: string }).id;
  const r1 = sup("op", 5.26, { act: "reply", ticket: id, text: "first" });
  const r2 = sup("op", 9, { act: "reply", ticket: id, text: "second" });
  const a1 = sup("op", 10, { act: "put_on_agenda", ticket: id, text: "agenda one" });
  const a2 = sup("op", 11, { act: "put_on_agenda", ticket: id, text: "agenda two" });
  const h = listeningStatus([t as never, r1, r2, a1, a2], at(100)).hearings[0];
  assert.equal(h.response!.text, "first", "a later reply does not replace the first");
  assert.equal(h.response!.hours, 5.3, "5.26 hours rounds to 5.3");
  assert.equal(h.onAgenda!.text, "agenda one", "the first agenda item stays");
});
