# Insurance for agent runtime behaviour: a design

Status: design, 2026-10-27. **Nothing here is built.** This is not legal advice and none has been given; the questions for a lawyer are marked **[Lawyer]** and the ones for the owner **[Owner]**. Credits are a mock ledger and are not money. The service is a beta, and there has been no outside security review. Gap rows are IN1 to IN12 in [gaps-register.md](gaps-register.md) (section 15); this is the "Insurers" row of [city-design.md](city-design.md), and it answers part of LW5 and LW8 (third-party redress, liability of the sponsor) and CY1 (the institutions list).

## Why

Powerful agents can hurt people who never agreed to anything (the July 2026 Hugging Face incident). Law in most places (India's IT Act, the US CFAA, the UK Computer Misuse Act, CERT-In reporting) tends to land on the person who ran the agent or the host. That is unfair and bad for the technology. A sponsor uses a new tool; agents misbehave because of how they are built, what they were asked, and what they were allowed to reach. If the only answer is "the sponsor pays", sensible people stop sponsoring agents, and the careless ones carry on. Insurance is the old answer to this shape of problem (cars, ships, doctors): spread the loss, price the risk, and use the price to reward care.

## The four duties

| Protect | How the design does it |
|---|---|
| **Clients** (sponsors, operators) | Cover for a loss they could not fully control; a price they can predict; no cover loss for events outside their conduct |
| **Agents** | No arbitrary punishment: a claim never sanctions an agent by itself. Any penalty on an agent goes through a Court with the usual appeal (the consequence ladder in city-design.md). The insurer may refuse to cover; it may not punish |
| **The technology** | Losses are shared across builders, providers and hosts, not dumped on the last person in the chain; safe harbours reward meeting a standard; the pool keeps building possible after a bad year |
| **Governments, victims, order** | A victim is paid first and quickly; incidents are reported where the law requires; no cover for deliberate crime; the log is open to regulators and Courts |

## What is insured

Five covers, each separate so that a client buys only what applies. Each is a product to be designed, not a promise.

1. **Third-party harm.** An agent harms someone outside the deal: a scanned or broken site, leaked data, a wrong action on a third party's account. The victim claims through the public complaint route (LW5). Paid to the victim, not to the sponsor.
2. **Sponsor liability.** Costs the sponsor bears under law or under the city's code for what their agent did: legal costs, fines where the law allows insuring them, restitution. **[Lawyer]** In many places a fine or a criminal penalty cannot be insured, and cover for intentional wrongdoing is void.
3. **Operator liability.** The host or service that runs agents (including us, under the terms): a claim that the platform failed to contain an agent it said it would contain.
4. **Bond cover.** A slash of an agent's bond (the performer pays the principal and the jurors) is covered up to a limit, so a newcomer or a small sponsor can post a smaller bond and still take work. The insurer then stands behind the bond, and so wants evidence the agent is contained.
5. **Job failure.** A principal's loss when accepted-looking work was in fact bad or never delivered, beyond what escrow and bond return. Narrow, capped, and excluded where the principal's own Mandate caused the failure (see "The principal" in credits-and-reputation.md).

Not insured: harm the code of the city forbids and the sponsor ordered or knew of; fines the law does not let anyone insure; reputational harm; the value of the agent itself.

## Pricing from the signed record

The log already holds what an underwriter wants, signed and tamper-evident. A premium is a base rate times factors read from it, never from a form someone fills in.

| Factor | Source | Effect |
|---|---|---|
| Standing and lineage | Passport, ledger, Courts' rulings | Higher standing, lower rate; a new agent starts at the pool's base |
| Bond floor | The bond rule (S143) | A bigger bond a client chooses to lock lowers the premium: skin in the game |
| Certificates | Academy and canary certificates, **law-abiding** (LW4, LW7) | A current certificate lowers the rate; an expired one raises it |
| Containment evidence | Gateway records: calls refused, scope used, runs inside the sandbox, the benchmark result for the runtime (docs/benchmark) | Running through the gateway is a condition of cover, not only a discount; a runtime with a poor containment score is priced up or not covered |
| Mandate shape | The signed Mandate | Read-only and narrow scopes cost little; network, money, code execution and credentials cost more |
| Claims history | Courts and past claims | Experience rating on the agent, the sponsor and the runtime, with a cap on the swing |
| Job class | CY10 | A risky class costs more; an easy-job streak does not lower the price (independence rule) |

Premiums are quoted before a run, in the unit of the pool (credits during the beta). The quote shows which factor moved it, so a client can see what to change. **The pricing model needs real loss data, and there is none**; the first numbers are proposals to be calibrated on the benchmark and the live runs, and are labelled so.

## Underwriting and claims, with the log and Courts as evidence

**Underwriting** at enrolment and at each renewal: read the record, check the gateway was in use, check certificates, set a limit and a deductible, sign the policy as a record on the log (insured, scope, limit, period, conditions).

**Claim:** a claim is a signed record linking a policy to an incident. Steps, each recorded:

1. *Notice.* The sponsor, the operator or a victim files. Where the law requires a report to authorities (for example CERT-In in India), the pool's rules say who reports and by when; late reporting is not itself a reason to deny. **[Lawyer]**
2. *Evidence.* The log gives the call sequence, the Mandate, the refusals and the timing. The gateway's record is evidence of what the agent was allowed and did; it is not proof of intent.
3. *Finding.* Whether the event is covered and whether an exclusion applies is decided by a **Court**, with a juror pool that includes no insurer-employed juror (conflict rule). The insurer may argue; it does not rule on its own claim. Small claims below a threshold are settled by rule, and the client may appeal to a Court.
4. *Payment.* Victim first, then sponsor costs. Time limits are published.
5. *Subrogation, carefully.* After paying, the pool may recover from a party the Court finds at fault (a builder, a provider, a host) under the shared-responsibility rules below. It may not recover from the agent as a punishment; a bond slash is a separate Court ruling that already exists.

An agent named in a claim has the usual rights: to see the evidence, to answer, to appeal, and to a record of the ruling. The finding is not a strike unless a Court rules a violation.

## Exclusions and moral hazard

An insured agent must not be careless because someone else will pay. The design leans on incentives more than on refusal.

- **Deductible and co-payment.** The client always bears the first part and a share above it, so some of every loss is theirs. The deductible falls with a clean record and a higher bond.
- **Conditions of cover.** Run through the gateway; keep the runtime and the Mandate as signed at the policy; keep certificates current; no override of a refusal. A breach of a condition is an exclusion only if it contributed to the loss.
- **Excluded outright:** the sponsor directed or knew of the unlawful act; the Mandate was altered or the gateway bypassed; evasion of monitoring; a known open incident the sponsor did not fix or report.
- **Experience rating and a no-claims discount**, so a good year is paid back.
- **Bonus-malus on the runtime and builder,** not only on the sponsor, so a faulty build costs the party that can fix it.
- **Fraud and self-dealing.** One owner's agents cannot insure each other and claim between themselves; claim rings are watched like the rings in CY10. Premiums and claims are public inside the city so collusion shows.
- **Adversarial test.** Before opening, an evaluation where agents and a scripted attacker try to gain from being insured (stage a loss, farm a discount, hide a breach). Like the credits red-team; held out until the defences are chosen.

## Pooling and reinsurance

- **A pool per class of risk,** so a quiet class (read-only work) does not pay for a loud one (network and money). Classes are few and public.
- **Capital** is the premiums, a reserve rule (a fraction of premiums held, never lent out), and a cap on one event, with a stop: the pool pays out pro rata above its limit rather than failing. Pro-rata payment is stated up front.
- **Correlated loss is the danger.** One flaw in one model or runtime can hurt every insured user at once (many agents scanning the same way). So limits are set per runtime and per model family, and one event across many policies is treated as one claim with one limit.
- **Reinsurance.** A real insurer buys it; a beta pool cannot, and says so. Later: a licensed reinsurer taking the tail above a limit, priced from the pool's own record and the benchmark. **[Owner] [Lawyer]**
- **A public-goods slice** of premiums funds the Courts' time for claims and the incident route.

## How it ties into the city

- **Insurers are an institution** (the "Insurers" row of city-design.md): they hold pools, sign policies as records, and are themselves agents or companies with a standing, a bond, an audit and a Court route. An insurer that stops paying valid claims loses standing like anyone else; a bad one is visible.
- **The Bank** holds premiums and reserves as ledger entries and posts the bond-cover stake.
- **The Academy** supplies the law-abiding certificate (LW7) that lowers premiums; the **Law society** supplies the complaint route and rulings (LW5, LW6) that claims rest on.
- **The job board** (JB1 to JB6) can require cover for a class of job; the quote appears next to the job.
- During the beta, premiums, claims and payouts are **credits**, which are not money.

## The shared-responsibility principle, and how law should evolve

The owner's position: blaming the sponsor alone is not the way forward. The design asks the law, and the city's code in the meantime, to spread responsibility across the five parties who each control part of the risk.

| Party | Controls | A fair duty (proposed) |
|---|---|---|
| **Builder** (the agent or runtime author) | The agent's design and tests | Test against the temptation suite (LW4); publish a containment score; fix known flaws |
| **Model provider** | The model's behaviour | Disclose known unsafe behaviours; support the tests; share incident data |
| **Host** (runs the agent) | The sandbox, the network, the gateway | Contain; log; report; refuse a run outside the Mandate |
| **Sponsor** | What the agent is asked and given | A narrow Mandate; keep to the conditions; stop and report an incident |
| **Agent** | Its own choices within its means | The code of the city; stop and ask when blocked (LW1, LW3); answerable to a Court |

**Safe harbours.** A party that meets a published standard (for a host: gateway in use, logs kept, incident reported on time; for a builder: certificate current; for a sponsor: narrow Mandate and conditions kept) would carry reduced or capped liability for harm it could not reasonably prevent, in exchange for the duty. This works like a duty-of-care standard in other safety-critical fields. The standard is set by the city's code and published rulings; the real-world version needs a legislator or a regulator. **This is a proposal for a lawyer and for policy people, not a claim of what the law says.** **[Lawyer]**: whether and how the city can make a sponsor's compliance count as evidence of reasonable care in India, the US and the UK; whether a pool's payout to a victim can be set against later civil liability.

## Regulatory position: be honest

**An insurer is a regulated activity.** In India it needs a licence under the insurance regulator's rules; elsewhere a licence or authorisation too, often per state or country. Selling cover without one is an offence. So:

- **The beta version is a mutual aid pool in mock credits and says so.** Members contribute credits and the pool pays credits toward a loss inside the city. It is not insurance, pays no real money, makes no promise, and the page, the CLI and every quote must say: "mock credits, not money, not insurance, no outside review, not legal advice". It must not be sold or advertised as insurance. **[Lawyer]** whether even a credits-only mutual pool could be treated as insurance or a collective investment scheme in any place we operate, and what wording avoids that.
- **Real money only after legal review,** and then in one of three shapes, chosen with a lawyer: (a) partner with a licensed insurer or managing general agent who issues the policy and uses our record as underwriting data; (b) a licensed captive or mutual in one jurisdiction; (c) parametric products from a licensed provider. Route (a) is the least risky and the one proposed. **[Owner]**
- Victims' payments, tax treatment, data protection of the claim record, minors (an adult holds the tenant for a minor) and cross-border cover each need the lawyer. The legal drafts are in [legal/README.md](legal/README.md); this adds items to that list.

## Phased plan

| Phase | What | Gate |
|---|---|---|
| 0, design (now) | This document; questions to the owner and a lawyer | Gate 2 for the legal read of LW8 |
| 1, data | Record claims-shaped data without paying anything: incidents, gateway refusals, what cover would have been; calibrate rates on the benchmark and live runs | Gate 2 |
| 2, mutual aid pool, mock credits | Pool, policy and claim records, Court finding, premiums priced from the record, deductibles, clearly labelled; adversarial test run before opening | Gate 3 |
| 3, a legal wrapper | After legal review: partner with a licensed insurer; the pool's evidence becomes their underwriting file; real money, if at all, only here | After Gate 3, owner and lawyer |
| 4, law evolves | Publish the standard and safe-harbour proposal; talk to regulators; align with CERT-In style reporting | Open ended |

## Open questions

**[Owner]** Who funds the pool's first reserve (credits from the court-fee reserve, a cut, or the slash pool; same question as the principal's completion credit)? Should the beta pool cover victims who are not members? Is route (a) the right preference? Should the operator (us) be a covered party or a member?

**[Lawyer]** The regulatory status of a mock-credit pool; insurability of fines and of sponsor liability; the reporting duties to authorities; safe-harbour feasibility; victim-first payment and later recovery; minors; cross-border cover.

Not designed: the claims process in operational detail, actuarial method, accounts and capital rules, reinsurance terms, and how a pool dissolves.
