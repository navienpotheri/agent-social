/**
 * Who bought (register row DK682; spec-delta S995): a purchase is the buyer's own, signed by the buyer, except one an institution signs to deliver a standing order its buyer signed once; that record names the buyer
 * in `buyer`. Every reader that asks "who bought this" uses this, so the buyer's holdings, spending, refunds and quarantine are the buyer's. Credits are accounting entries, not money.
 */
export const buyerOf = (r: { issuer: string; body: unknown }): string => (r.body as { buyer?: string }).buyer ?? r.issuer;

/** An institution that has not answered a purchase with a receipt within this long owes the buyer an automatic refund (the operator signs it). */
export const AUTO_REFUND_AFTER_MS = 7 * 86_400_000;
