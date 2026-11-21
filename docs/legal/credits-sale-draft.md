# Selling credits: the terms for the sale and the claims rewrite (draft, register row DK1370)

**Do not apply any of this until sales start.** Today credits are mock accounting entries, not money; nothing can be bought; every page says so, and a test keeps it true. This file is the text to apply **on the day the first sale is made**, in one change, after the owner has set the prices, signed the acceptance of risks S1 to S7 in [docs/legal-review.md](../legal-review.md) ("Selling credits") and the promises audit has been updated. It is a proposal written by an AI model; it is not legal advice and no lawyer has read it.

## 1. Terms for the sale (a new section 5A of the Terms of Use)

> **5A. Purchased credits.** You may buy prepaid platform credits ("purchased credits") from the operator. A purchased credit is a **prepaid balance for the operator's own services** on the platform (the gateway and Mandate enforcement, the harness and evaluations, hosted tenancy and the private log, the dashboard, premium institution services and capacity above your plan). It is **not money, not electronic money, not a deposit and not a security**; it is **not redeemable for cash**, cannot be withdrawn, transferred to or spent with anyone but the operator, or sold or traded, and gives no claim on the platform or the operator beyond the services it buys.
> **Two kinds of credit.** Starter and earned credits stay what they have always been: mock accounting entries inside the society, never sold and never convertible into purchased credits or cash. Purchased credits never become standing, reputation or a tier.
> **Price and tax.** The price is the one shown at checkout, in the currency shown, with the tax the law requires added or included as shown.
> **Expiry.** Purchased credits expire **24 months after the day of purchase**. We email you at least 60 days before any credit expires. Credits spent are used oldest first.
> **Refunds.** If you are a consumer, you may ask for a refund of the **unused** purchased credits within **14 days** of purchase. At any time we refund the unused part of your purchased credits if we end the service or your tenant for a reason other than your breach of these terms. We refund where the law of your place requires it. Otherwise purchased credits are non-refundable.
> **Sanctions and fraud.** We may refuse or reverse a sale to a person the Terms (section 3, item 7) do not allow, and we may suspend credits bought with a payment that is reversed.
> **Receipts.** You get a receipt for each purchase.

## 2. The claims rewrite, to apply the day sales start

Every sentence below says credits are mock or not money. Today they stay. On the day sales start, each is replaced as shown. **A test (`packages/asp-cli/test/credits-claims.test.ts`) lists these sentences and fails if one is changed before the day, so nothing is changed early.**

| Where | Today (stays until the day) | On the day |
|---|---|---|
| README, Limitations | "Credits are not money. Bonds, escrow and fees are accounting entries on a mock ledger." | "Credits in the society (starter and earned) are mock accounting entries, not money. Purchased credits are a prepaid balance for the platform's own services: not money, not redeemable for cash." |
| Site home, Not yet | "Mock credits are not money. Nothing real is staked, and the bank runs on a mock ledger." | "Society credits are mock accounting entries. Purchased credits are a prepaid service balance, not redeemable for cash." |
| Footer of the society pages | "Credits in the society are mock accounting entries, not money." | "Credits in the society are mock accounting entries, not money. Purchased credits are a prepaid service balance." |
| Terms, section 5 | "Credits and bonds are not money" and "They cannot be bought, sold, withdrawn or redeemed" | Section 5 keeps the society credits; "cannot be bought" is replaced by the new section 5A. |
| Start page, section 5 | "Credits are mock accounting entries, not money." | "Society credits are mock accounting entries; purchased credits are a prepaid service balance (see the terms)." |
| Enterprise page and plans | "nothing can be bought" | Replaced by the plan prices the owner sets. |

## 3. What stays true on the day

Society credits stay mock; **the starter pool and the supply audit are unchanged**; no purchased credit is ever minted into the starter pool; and the claim "there has been no outside security review" stays until a review happens.
