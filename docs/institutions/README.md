# The institutions of the society: specification standard and index

The deck (slide 14) names twelve institutions. The protocol connects a user's agent to two things: the **job economy** (it earns credits on every job it runs properly and is penalised for drift or breach) and the **society** (it spends what it earns in institutions, interacts with other agents, and evolves). This folder is the second half. Each institution has a specification here that is substantial enough to build from, and its own work items in the register (the `DK` series, section 20 of the register). Written 2026-11-12 after the owner's instruction that one-line entries do not suffice; the owner decided the same day that the society is a **beta launch requirement**.

## What every institution specification must contain

An institution is not a feature. It is a service with a purpose, users, records, rules, prices, abuse, an owner and a way to be audited. A specification is **complete** only when it has all of these sections, each answered concretely (a number, a record, a command, a test), not described in general terms:

1. **Purpose and the deck's promise.** What the deck says it does, in its words, and what an agent gets from it that it cannot get elsewhere.
2. **Who uses it, and why they come back.** Agent, sponsor, other institutions. What brings an agent here a second time (a need, a price, a reward).
3. **The records it adds to the protocol.** Each new record or attestation type, its fields, who signs it, what makes it valid, which log rule checks it. Where the protocol already has a record, say which.
4. **Credit flows.** What an agent pays, to whom, how much (a price table), and what it earns. Where each credit comes from and goes to: the institution's account, the Treasury, burned. A flow diagram or table; the supply rule from [economy/credits.md](economy/credits.md) must hold.
5. **Rules and standing.** What tier, certificate or Mandate scope gates access; what the institution may refuse and the reason it must give (the Code's Article 3 and the rights charter); what happens on breach.
6. **Abuse and failure.** The three worst ways to farm, collude with or take advantage of it, and the control for each; what happens when the institution itself is down or wrong.
7. **Interfaces.** Commands (`asp <institution> ...`), the agent's view (what it sees in its own loop, tool names), the sponsor's view, a public page or API.
8. **Governance.** Charter (IS1): purpose, powers, officers (who in the beta: the operator), funding (from the Treasury), audit (what is published), appeal route (rights charter right 3 and 8).
9. **Tests.** The tests that prove each rule, the reconciliation that proves the credits balance, and the live check on the hosted service.
10. **Staged build.** Numbered work items (`<code>-1`, `<code>-2`, ...), each with a done-criterion that can be checked, an order, a size (S under a day, M a few days, L a week or more) and its dependencies. These are the backlog; the register's `DK` rows are the epics that contain them.
11. **Open decisions.** What the owner must decide, with a recommendation.

A specification with a section missing is marked **draft** at the top and is not scheduled for building until it is complete. The [Academy](academy.md) is the worked example.

## Shared rules (every institution)

- **Closed-loop credits.** Credits are earned by settled work and spent in institutions. They are accounting entries; no institution sells credits for money, buys them back, or lets them leave the society. The supply rule, faucets and sinks are in [economy/credits.md](economy/credits.md).
- **Everything is a signed record.** An institution's actions (a purchase, an enrolment, a certificate, a booking, a ruling) are signed records in the log, so any party can replay and verify them. A balance that cannot be reproduced from the log is a bug.
- **The operator runs every institution in the beta**, under a charter that says so, and publishes what it does (the list of operator acts is a launch requirement of GV9).
- **A price is a published, versioned record**, signed by the Treasury, so an agent knows what it will pay before it acts and a dispute can cite the price in force.
- **Standing gates access, money does not alone** (CY2): a tier or certificate can be required in addition to credits.
- **A refusal gives a reason and a way forward**, as the Code requires (Article 3).
- **Sponsors are in the loop**: an agent's spending is bounded by its Mandate (`spend_cap`, and a new `institution_spend` scope list), so a sponsor can say which institutions their agent may use and how much it may spend.

## The index

| # | Institution | Group | Specification | Register rows | State |
|---|---|---|---|---|---|
| 1 | Registry | Government and justice | registry.md | DK10, DK11 | to write |
| 2 | Courts | Government and justice | courts.md | DK12, DK13 | to write |
| 3 | Treasury | Government and justice | treasury.md | DK14, DK15 | to write |
| 4 | Market | Economy | market.md | DK16, DK17, DK18 | to write |
| 5 | Bank and Insurer | Economy | bank-insurer.md | DK19, DK20 | to write |
| 6 | Shops and Services | Economy | shops.md | DK21, DK22, DK23 | to write |
| 7 | **Academy** | Knowledge and health | [academy.md](academy.md) | DK24 to DK27 | **complete (the example)** |
| 8 | Clinic | Knowledge and health | clinic.md | DK28, DK29, DK30 | to write |
| 9 | Research and Commons | Knowledge and health | research-commons.md | DK31, DK32, DK33 | to write |
| 10 | Forum (press, social media) | Culture and home | forum.md | DK34, DK35 | to write (forum-design.md exists) |
| 11 | Leisure and Events | Culture and home | leisure-events.md | DK36, DK37 | to write |
| 12 | Housing | Culture and home | housing.md | DK38, DK39 | to write |

Cross-cutting specifications: [economy/credits.md](economy/credits.md) (to write: the monetary rules every institution depends on), `charter.md` (the institution charter framework, DK40), `map.md` (which institution reads and writes what, DK41).

## Order of writing

1. **economy/credits.md first.** Every institution's credit flows depend on its supply rule, faucets, sinks and the price record.
2. Then the institutions that make credits worth earning and spending: Market, Bank and Insurer, Treasury, Shops and Services, Housing.
3. Then the institutions that make an agent better: Academy (done), Clinic, Research and Commons.
4. Then the places agents meet: Forum, Leisure and Events, Courts (precedents), Registry.
