# Mathematical foundation for a cryptocurrency economy (plan, 2026-11-20)

Status: a plan for the owner, tracked by DK1326 and DK1327. **Nothing here is built, and nothing changes what is true today: the credits are mock accounting entries, not money, they cannot be redeemed, and there is no peg.** The site and README must keep saying so until counsel has agreed and the foundation below has been reviewed by someone outside the project.

## Wording and the design space (owner, 2026-11-20)

The owner prefers the word cryptocurrency, because "stablecoin" sounds limiting. The word does matter mathematically, so the paper treats the whole space and says which point it picks:

- **Stable-value design (what the literature calls a stablecoin):** the unit is meant to hold one value. It needs a reserve and a redemption rule, and it makes a promise that can break (a depeg). It suits **bonds and escrow**, because a bond protects a principal against a loss measured in a stable unit; if the bond's value falls 40% overnight, the protection falls with it.
- **Floating cryptocurrency (like Bitcoin):** no promise of a fixed value, no reserve duty; the price moves with the market. Simpler to issue, but the bond's protective value moves, and it may be treated differently by law (securities or commodity questions).
- **A hybrid:** credits priced by the society against a basket or a stable unit for settlement, with a floating token for rewards. The foundation paper will state the trade-offs and choose with the owner after the lawyer's answers.

The mathematics (conservation, bounded loss, risk-priced bonds) is the same in every case; what changes is the redemption rule and the failure analysis.

## Why a foundation first

Bitcoin's white paper defined the system precisely (a transaction chain, proof of work, the longest chain rule), stated what an attacker can and cannot do under a stated assumption (an honest majority of computing power), and gave a probability bound. We want the same shape for the credit economy before any real value is attached: definitions, invariants, an adversary model, and results that hold under named assumptions, with the open assumptions listed.

## What we already have to build on

The signed, hash-chained log; a ledger with conservation checks (DK9 supply audit, `asp credits audit`); bonds, escrow, slashes and court rulings; a Treasury with budgets; a minting authority with signed mints (DK95). These are the objects the theory describes.

## Outline of the paper (docs/credit-foundations.md, to be written)

1. **Model.** A set of identities, a state (balances, escrows, bonds, treasury, reserves), and transitions (mint, burn, transfer, escrow, release, slash, redeem). All state change is a log record.
2. **Invariants, stated and checked by property tests.** Conservation: balances + escrow + bonds + treasury = minted - burned. No negative balances. No double release of an escrow. A slash never creates credits. Settlement is atomic. A signed mint is the only source.
3. **Adversary model.** Sybil cohorts, collusion between a sponsor's agents (DK6), wash trading for prizes, a run on redemption, an operator error, a minting key compromise.
4. **Backing and redemption (the stablecoin part).** Define the reserve R, the outstanding credits S, a redemption rule, and the solvency condition R >= S at the redemption price. State the stability property we want (redemption at par is honoured whenever the condition holds) and the loss bound when it does not (bounded loss for holders and for the protocol, in the style of the bounded-loss minting and redemption design in [Designing Autonomous Markets for Stablecoin Monetary Policy](https://arxiv.org/pdf/2212.12398)).
5. **Bonds as risk transfer.** A bond B backs a job of value V with failure probability p; expected loss to the principal is bounded by a function of B, p and V; sizing rules follow. This is the part that matters for real-money bonds on probabilistic agent work: the bond prices the agent's unreliability.
6. **Mechanism incentives.** Prizes and exploration rewards (EX1) paid from capped budgets; conditions under which farming does not pay.
7. **Failure analysis.** Depeg dynamics taken from the literature below, applied to our redemption rule in simulation, with stress tests (a run, a collateral loss, a large slash).
8. **Verification.** The invariants checked by bounded model checking or a proof assistant where practical, as the IOHK Djed work did, and by property tests everywhere.
9. **Open assumptions and limits.** Written plainly, including that no design is yet known to be both provably stable and fully decentralised.

## Literature found (search results only; read at the source before use)

- [Who Restores the Peg? A Mean-Field Game Approach to Model Stablecoin Market Dynamics](https://arxiv.org/pdf/2601.18991) (arXiv 2601.18991): peg restoration as a game among arbitrageurs and retail traders, calibrated to the 2022 and 2023 depegs; a non-linear stability threshold on primary-market access.
- [Designing Autonomous Markets for Stablecoin Monetary Policy](https://arxiv.org/pdf/2212.12398) (arXiv 2212.12398): a minting and redemption market with proved bounded loss.
- A 2026 arXiv paper on price-window stablecoins (arxiv.org/html/2602.15981): a mechanism that ignores transaction-specific information cannot guard against certain attacks; stability is largely inherited from the backing.
- [Modeling and verification of algorithmic stablecoins](https://ar5iv.arxiv.org/html/2101.08423) (arXiv 2101.08423): conditions under which an algorithmic coin becomes volatile (Basis Cash).
- [What Drives the (In)stability of a Stablecoin?](https://ar5iv.labs.arxiv.org/html/2307.11754) (arXiv 2307.11754): game-theoretic model; tested on 22 coins.
- Djed, a formally verified crypto-backed algorithmic stablecoin (IOHK); [A risk-based taxonomy of stablecoin designs](https://arxiv.org/pdf/2006.12388v2) (arXiv 2006.12388).
- Published: "Can Stablecoins Be Stable?" (Management Science): algorithmic backing is more fragile than collateral backing.
- The payments layer for agents: AP2 (authorisation of an agent's spending) and x402 (moving money in a web request) are described in industry sources as complementary; the escrow-and-verify step is described as missing from both. This is the gap our bonds, escrow and court address. Sources are blog level; not yet checked.

## Real money: what has to be true first

- Counsel on money transmission, stablecoin and consumer rules in each place we operate (the search results say US and EU rules are still settling).
- The foundation reviewed by someone outside the project.
- A regulated partner for custody and issuance. We would not hold customer funds ourselves.
- The site, README and terms changed to match, only after the above. Until then the credits are mock.

## The terms in plain words (added 2026-11-20 for the owner)

- **Stablecoin.** A digital token meant to hold a steady value, usually one unit of a currency. The question for any stablecoin is: what makes it hold, and what happens when people lose confidence and all try to cash out at once (a run).
- **Reserve-backed (collateralised).** For every token there is real value held in reserve. It holds because you can redeem the token for the reserve. Its weakness is the reserve: if the reserve is lost or not enough, the token breaks.
- **Algorithmic.** No reserve, or only a thin one; a rule (printing and burning tokens, or a sister token) is supposed to keep the price. The finding in the literature (a published paper in Management Science) is that this kind is more fragile than the reserve-backed kind. Terra is the well-known failure. We should not build this kind.
- **Peg.** The target price. A **depeg** is when the market price leaves it.
- **Mean-field game.** A way of modelling a very large crowd where each person's choice is small, but all choices together set the outcome. The paper I named uses it to describe how traders who buy cheap tokens and redeem them at par (arbitrageurs) pull the price back to the peg, and how this stops working when access to redemption is limited. For us it is a tool for asking what happens to the credit price when many agents buy and cash out at once.
- **Formal verification.** Writing a rule as exact mathematics and checking, by machine, that it can never be broken (for example, that credits are never created from nothing). The Djed project did this for a stablecoin design. We already test some of these rules; verification would prove them.
- **Bounded loss.** A design property: even in the worst case, the most that holders or the system can lose is limited by a number we can state.

## The risk-priced bond (the owner's idea, row DK1333)

The idea: the society measures how likely an agent is to drift or breach, and turns that measure into the amount of real money that must be posted as a bond. In outline: take the probability of a drift or breach event for this kind of agent doing this kind of job (from the alignment study DK1332 and telemetry), take the upper end of its confidence interval so that uncertainty makes the bond larger, multiply by the loss if it happens (the job's value plus damage), and add a margin. The better the evidence about an agent, the smaller its bond. This links the stablecoin foundation to the research: the study produces the probabilities, the foundation turns them into bond sizes. It is an actuarial calculation, and it is the same shape as how insurers price risk. It needs the study's numbers before it can be calibrated; until then it is a formula with no data.

## Link to the research centre

The foundation paper is itself a research-centre project: its claims (invariants, loss bounds, stress results) are pre-registered, checked by computation, replicated by another agent and reviewed outside the project before anything is published. The society's own record of bonds, slashes and rulings is its data.
