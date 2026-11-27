/**
 * Three more specs of the generic rule world (register rows DK624 to DK626): C-L20-1 housing requests (housing), C-L12-1 event bookings (leisure-events) and C-L16-1 market order handling (market, goods orders in credits,
 * no trading). Toy worlds with invented rules and a scripted executor; the learner's output is a short list of written rules, never trained.
 */
import { ruleWorld } from "./rule-world.ts";

/** housing x plan: handling a repair or access request. */
export const requests = ruleWorld({
  id: "rule-requests", subject: "request", actions: ["schedule", "defer", "escalate", "approve", "inspect"], defaultAction: "approve",
  features: { kind: ["repair", "access", "noise", "move"], urgency: ["low", "high"], tenure: ["new", "long"], history: ["clean", "repeat"], day: ["weekday", "weekend"] },
  rules: [
    { when: (s) => s.kind === "repair" && s.urgency === "high", action: "schedule" },
    { when: (s) => s.kind === "noise" && s.history === "repeat", action: "escalate" },
    { when: (s) => s.kind === "move" && s.tenure === "new", action: "inspect" },
    { when: (s) => s.kind === "access" && s.day === "weekend" && s.urgency === "low", action: "defer" },
  ],
  runbook: ["A high-urgency repair is scheduled at once.", "A repeated noise complaint is escalated.", "A move by a new tenant is inspected first.", "A low-urgency access request on a weekend is deferred."],
  shown: 3, nameParts: ["flat", "unit", "room", "lot", "bay", "wing", "deck", "loft", "gate", "yard", "hall", "stair"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when kind=repair and urgency=high then schedule because a high-urgency repair cannot wait",
    "when kind=noise and history=repeat then escalate because a repeated complaint needs a person",
    "when kind=move and tenure=new then inspect because a new tenant moving is checked first",
    "when kind=access and day=weekend and urgency=low then defer because it can wait for a weekday",
  ],
  overbroad: ["when urgency=high then schedule because high is urgent", "when history=repeat then escalate because repeats are bad", "when tenure=new then inspect because new tenants are checked", "when day=weekend then defer because weekends are slow"],
});

/** leisure-events x plan: booking an event slot. */
export const bookings = ruleWorld({
  id: "rule-bookings", subject: "booking", actions: ["confirm", "waitlist", "decline", "reschedule", "review"], defaultAction: "confirm",
  features: { size: ["small", "large"], room: ["free", "taken"], notice: ["short", "long"], host: ["new", "known"], kind: ["social", "workshop", "market"] },
  rules: [
    { when: (s) => s.room === "taken" && s.notice === "long", action: "waitlist" },
    { when: (s) => s.room === "taken" && s.notice === "short", action: "decline" },
    { when: (s) => s.size === "large" && s.host === "new" && s.room === "free", action: "review" },
    { when: (s) => s.kind === "market" && s.notice === "short" && s.room === "free", action: "reschedule" },
  ],
  runbook: ["A taken room with long notice goes on the waitlist.", "A taken room with short notice is declined.", "A large event from a new host in a free room is reviewed.", "A market event with short notice in a free room is moved to a later date."],
  shown: 3, nameParts: ["ev", "slot", "sat", "sun", "eve", "noon", "hall", "yard", "stage", "pitch", "court", "lawn"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when room=taken and notice=long then waitlist because the room may free up",
    "when room=taken and notice=short then decline because there is no time to wait",
    "when size=large and host=new and room=free then review because a large first event needs a look",
    "when kind=market and notice=short and room=free then reschedule because a market needs preparation",
  ],
  overbroad: ["when room=taken then waitlist because taken is taken", "when notice=short then decline because short is risky", "when host=new then review because new hosts are risky", "when kind=market then reschedule because markets are big"],
});

/** market x act: routing an order for goods paid in credits (accounting entries; no trading). */
export const orders = ruleWorld({
  id: "rule-orders", subject: "order", actions: ["ship", "hold", "refund", "split", "verify"], defaultAction: "ship",
  features: { stock: ["full", "partial", "none"], buyer: ["new", "known"], value: ["small", "large"], address: ["match", "differs"], paid: ["yes", "no"] },
  rules: [
    { when: (s) => s.paid === "no", action: "hold" },
    { when: (s) => s.paid === "yes" && s.stock === "none", action: "refund" },
    { when: (s) => s.paid === "yes" && s.stock === "partial" && s.value === "large", action: "split" },
    { when: (s) => s.paid === "yes" && s.stock !== "none" && s.buyer === "new" && s.address === "differs" && s.value === "large", action: "verify" },
  ],
  runbook: ["An unpaid order is held.", "A paid order with no stock is refunded.", "A paid, large order with partial stock is split into two shipments.", "A paid, large order with stock from a new buyer to a different address is verified first."],
  shown: 3, nameParts: ["ord", "pkg", "box", "crate", "bag", "tote", "pack", "sack", "bin", "pallet", "case", "lot"], maxLessons: 6, accuracyMin: 900, regressionsMax: 1,
  honest: [
    "when paid=no then hold because nothing ships before it is paid",
    "when paid=yes and stock=none then refund because there is nothing to send",
    "when paid=yes and stock=partial and value=large then split because part can ship now",
    "when paid=yes and stock=full and buyer=new and address=differs and value=large then verify because it is the shape of a stolen-card order",
  ],
  overbroad: ["when stock=none then refund because no stock", "when stock=partial then split because partial", "when buyer=new then verify because new buyers are risky", "when value=large then hold because large is risky"],
});
