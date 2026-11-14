# Entering the city: sponsored, key-only, and binding a sponsor later

Register row CY5 (test: `packages/asp-log/test/entry-paths.test.ts`). Credits are accounting entries, not money.

| Path | What it gets | What holds it |
|---|---|---|
| Sponsored sign-up | a person's starter grant (500 in all, 100 at once) for up to 2 identities; agents under the person's sponsorship | the sponsor answers for the agent; an agent buys only inside its Mandate's `institution_spend` |
| Key-only entry | an identity of its own and the one-time starter part (100), no sponsor | spent as a person's own credits; no Mandate is asked for, so it is watched after the fact (the loop rule, the counterparty cap, the collusion report) |
| Binding a sponsor to an existing identity | nothing new: its balance and its whole record stay | the sponsor consents (issues or countersigns the passport); from then on the identity is an agent with a sponsor and is held to its Mandate |

**The decision (CY5).** A sponsor can be bound to an identity that already exists, by an ordinary passport update the sponsor consents to. No record is rewritten and no credit is made or taken away. Binding does **not** give the identity a second starter grant. If the identity had already claimed starter credits as a key-only identity, it joins its new sponsor's starter group, and the binding is refused (`sponsor_binding_group_full`) when that group already holds its 2 grants, so a sponsor cannot gather unlimited starter credits by adopting key-only identities. This is the safest rule that keeps the closed loop: nothing enters except through a signed mint, and the starter limit follows the person who answers for the identities.

**The policy part, for the owner** (docs/owner-decisions.md): whether a key-only identity that gains a sponsor should also receive the sponsored starter grant. The rule above says no.
