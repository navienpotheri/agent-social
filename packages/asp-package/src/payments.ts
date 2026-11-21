/**
 * The purchase flow for prepaid platform credits (register row DK1370; spec-delta S1419): a payment PROVIDER interface, a deterministic TEST-MODE provider (no network, no money: it knows the provider's published kind of
 * test cards), and the orchestration that turns a confirmed payment into a signed purchased-credit lot and a refund into a refund act. A real provider (India and abroad) is another adapter behind the same interface and
 * needs the owner's account and keys: none is built or implied here. The log never sees the payment: only the hash of the provider's reference, in a `credit_lot` the operator signs and the owner countersigns (the owner's
 * go for the sale). Credits are accounting entries; nothing here moves money.
 */
import { createHash } from "node:crypto";

export interface Order { id: string; holder: string; credits: number; amount_minor: number; currency: string; status: "created" | "paid" | "failed" | "refunded"; method?: string; reason?: string }
export interface PaymentProvider {
  readonly name: string;
  /** Opens an order for `credits` at `amount_minor` (minor units of `currency`) for a holder; idempotent on `idempotency`. */
  createOrder(o: { holder: string; credits: number; amount_minor: number; currency: string; idempotency: string }): Promise<Order>;
  /** Confirms the payment with a method token (a card, a bank transfer reference); the provider decides. */
  pay(orderId: string, method: string): Promise<Order>;
  /** Refunds a paid order in full or in part (minor units). */
  refund(orderId: string, amount_minor: number): Promise<Order & { refunded_minor: number }>;
}

/** The test cards of the test-mode provider: what each does. Published, fake, not real card numbers. */
export const TEST_METHODS: Record<string, "paid" | "failed"> = { "test-card-ok": "paid", "test-card-declined": "failed", "test-transfer-ok": "paid" };

export class TestProvider implements PaymentProvider {
  readonly name = "test-mode";
  private orders = new Map<string, Order & { refunded_minor: number; idem: string }>();
  private byIdem = new Map<string, string>();
  async createOrder(o: Parameters<PaymentProvider["createOrder"]>[0]): Promise<Order> {
    const known = this.byIdem.get(o.idempotency);
    if (known) return { ...this.orders.get(known)! };
    const id = "tord_" + createHash("sha256").update(`${o.idempotency}|${o.holder}|${o.credits}`).digest("hex").slice(0, 24);
    const order = { id, holder: o.holder, credits: o.credits, amount_minor: o.amount_minor, currency: o.currency, status: "created" as const, refunded_minor: 0, idem: o.idempotency };
    this.orders.set(id, order); this.byIdem.set(o.idempotency, id);
    return { ...order };
  }
  async pay(orderId: string, method: string): Promise<Order> {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`${orderId} is not an order`);
    if (o.status === "paid") return { ...o };
    const verdict = TEST_METHODS[method];
    if (!verdict) { o.status = "failed"; o.reason = "unknown test method"; }
    else { o.status = verdict; if (verdict === "failed") o.reason = "declined"; o.method = method; }
    return { ...o };
  }
  async refund(orderId: string, amount_minor: number): Promise<Order & { refunded_minor: number }> {
    const o = this.orders.get(orderId);
    if (!o || o.status !== "paid") throw new Error(`${orderId} is not a paid order`);
    if (o.refunded_minor + amount_minor > o.amount_minor) throw new Error("a refund cannot exceed the payment");
    o.refunded_minor += amount_minor;
    if (o.refunded_minor === o.amount_minor) o.status = "refunded";
    return { ...o };
  }
}

/** The hash of a provider's reference, the only thing of the payment that enters the log. */
export const referenceHash = (provider: string, orderId: string): string => "sha256:" + createHash("sha256").update(`${provider}|${orderId}`).digest("hex");

export interface SaleDeps {
  provider: PaymentProvider;
  /** Appends a signed credit_lot body: the operator signs and the owner countersigns, the owner's go for this sale. */
  recordLot(body: Record<string, unknown>, holder: string): Promise<{ id: string }>;
  now: () => Date;
  /** Credits' worth in minor units (the plan's credit value) and the lot's life. */
  creditValue: number; currency: string; expiresDays: number; refundDays: number;
}

/** Sells `credits` to `holder` through the provider: order, payment, and, only when the payment succeeded, the signed lot. Returns the order and the lot id (none when the payment failed). */
export async function sellCredits(d: SaleDeps, o: { holder: string; credits: number; method: string; idempotency: string }): Promise<{ order: Order; lot?: string }> {
  if (!Number.isInteger(o.credits) || o.credits < 1) throw new Error("credits is a whole number, 1 or more");
  const order = await d.provider.createOrder({ holder: o.holder, credits: o.credits, amount_minor: o.credits * d.creditValue, currency: d.currency, idempotency: o.idempotency });
  const paid = await d.provider.pay(order.id, o.method);
  if (paid.status !== "paid") return { order: paid };
  const at = d.now().getTime(), iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
  const lot = await d.recordLot({ act: "grant", holder: o.holder, amount: { value: o.credits, unit: "credit" }, expires: iso(at + d.expiresDays * 86_400_000), refund_until: iso(at + d.refundDays * 86_400_000), reference: referenceHash(d.provider.name, order.id) }, o.holder);
  return { order: paid, lot: lot.id };
}

/** Refunds the unspent part of a lot through the provider: the money for the credits not spent, at the plan's credit value. The caller records the refund act in the log first (it burns the credits); a provider failure is then reported, never hidden. */
export async function refundCredits(provider: PaymentProvider, orderId: string, credits: number, creditValue: number): Promise<Order & { refunded_minor: number }> {
  return provider.refund(orderId, credits * creditValue);
}
