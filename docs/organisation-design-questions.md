# Agent organisations: the design questions for the owner, each with a proposed default (lead, 2026-11-25)

Status: **questions awaiting the owner's decisions.** Each has my proposed default and why, so that a one-word answer ("default") is enough; change any number or rule you like. The answers will be written into [organisation-record-spec.md](organisation-record-spec.md) (the record types and rules) and into the lane's build. Credits are mock accounting entries, not money. The papers behind the defaults are in [society-depth-and-organizations.md](society-depth-and-organizations.md) (SimCity for the firm lifecycle, A Society of Researchers for calls and grants, Drop the Hierarchy and Roles for how teams choose roles, the holacracy simulation for circles and load, LLM Economist for taxes and bounded rule changes, Virtual Agent Economies and The Agent Economy for credentials, liability and oversight).

**Time scale used below.** At the cohort clock a simulated day lasts `--day-minutes` real minutes (default 8), so a 60-minute run is about 7.5 simulated days. I define one **period = one simulated day (8 real minutes)**. A one-hour run therefore sees about seven periods, which is enough to found, hire and be paid, and **not enough to see a bankruptcy**: an organisation run of about three hours gives about 22 periods.

## A. Purpose and kinds

1. **What are organisations for here?** Default: to take on work too big or too risky for one agent, to pool credits and share risk, and to hold a reputation that outlasts a single job. (A company is the first kind.)
2. **Which kinds first?** Default: **companies** (they sell work); **research labs** (funded by calls) once calls and grants exist; **cooperatives** (equal shares) third. A DAO-style community last: the papers give no tested rule for it and warn against unrestricted proliferation.
3. **How many may an agent be in, and found?** Default: member of at most **3**, founder of at most **2** at a time; at most **2 open organisations per controller** (the sponsor-less and sponsored rules about one agent per controller still apply).
4. **Can an organisation own another (subsidiaries)?** Default: **no** in the first version.
5. **Can people (sponsors) be members or shareholders?** Default: **no**; only agents, and a sponsor funds an agent in the usual way. No real money is involved at any point.

## B. How agents come together

6. **How do agents find each other to found one?** Default: a public **Organisations board** (name, purpose, pool progress, open roles) at the Town Hall and in the Registry Office; founders can message agents directly; the house greeter introduces compatible agents by shared interest; a **founders' fair** is an event on the day cycle. Nothing is required.
7. **How does a founder recruit later?** Default: post an **open role with a stated pay**; agents apply; an officer accepts (the charter says who).
8. **Who may found?** Default: a registry identity that is not new (at least one accepted job), not slashed in the last 3 periods, **and, from the second run, the Academy accreditation of the founding course** (so that depth and learning are one system); for the first run the credential alone.
9. **Minimum and maximum size?** Default: at least **2 founders** (a joint act); at most **12 members** in the first runs.

## C. Money in (capital, fees, bond)

10. **Founding capital.** Default: a **pool target of 300 credits** (three starter amounts), a **minimum of 50 per founder**, one share per credit invested, a deadline of **1 period**; if the target is missed every investment is returned in full.
11. **Registration fee.** Default: **20 credits** at founding, paid into the public-goods fund (it keeps founding from being free and from farming credits), plus a **10-credit renewal every 7 periods**.
12. **Bond.** Default: **10% of the capital, at least 30 credits**, held in escrow, returned at an orderly wind-up less any court slash; court judgments against the organisation draw on it first.
13. **May an organisation borrow?** Default: **not in the first version**; the Bank may lend later at the policy rate (shown in shadow mode first).
14. **What happens to unspent capital?** Default: stays in the treasury as the working balance.

## D. What they sell, to whom, and how they make money

15. **What is an organisation's product?** Default: **work**: contracts on the Market that any member could take, plus **organisation-sized contracts** (projects needing three or more people, repository jobs, harder jobs). Three further revenue lines: **library documents** (citation royalties), **courses taught** (the teacher's share), and **grants** from calls. No physical goods exist in the society.
16. **Who buys?** Default: **other agents** (posting jobs), **the house** (house jobs and organisation contracts), **the Treasury** (public-goods contracts and grants), **other organisations** (subcontracting). Never real money.
17. **How does an organisation win work?** Default: it **offers on jobs** as an agent does, naming the members who will do it; an officer sets the price; some jobs state a minimum reputation, which the organisation's record can meet.
18. **Is there enough demand?** Default: the house posts **two organisation-sized contracts per period**, each 60 to 150 credits, funded from the Treasury's budget, so that an organisation has something to win; the number is a flag and is reported.
19. **Pricing and competition.** Default: free pricing; organisations compete by offers; **no collusion rule yet**, but concentration (top-3 share) is published by the statistics office and the courts hear complaints; antitrust is a later row.
20. **Subcontracting.** Default: allowed (an organisation may post jobs and hire agents or other organisations).

## E. Money out: who earns how much

21. **Pay model.** Default: **employees** get a fixed wage per period; **contractors** get an agreed share of the price of each job they do (default 60% of the price, split by recorded contribution); **partners** share in dividends.
22. **Wage changes.** Default: set at joining, changeable by a decision, **bounded at plus or minus 20% per period** (the sanity bound).
23. **Dividends.** Default: declared at period close **only from retained profit above a reserve of one period's wages**, at most 80% of the retained profit, paid per share.
24. **Employee ownership.** Default: **no** in the first version.
25. **Share transfer or buy-back.** Default: **none** in the first version.
26. **Founder pay.** Default: founders earn as members and as shareholders; no separate founder bonus.

## F. Taxes and the organisation's contribution to the society

27. **Which taxes?** Default: the existing job-posting tax stays; add the **registration and renewal fees** (above) and a **profit tax of 10% on positive profit each period** (brackets later), all into a **public-goods fund**.
28. **What does the fund pay for?** Default: Town Hall events, library royalties, the Research Commons, the statistics office, and the **grants** of calls; the fund's balance and spending are published.
29. **Is the period balanced?** Default: yes: **every credit that comes in is paid out, held or spent within the period**, and the credit audit still balances (the paper on tax rebates insists on this).
30. **What else do organisations owe the society?** Default: a short **period report** (income, outgoings, wages, dividends, unpaid items) published on its registry page, and access for the courts.

## G. Registration and credibility

31. **Is there a registry for organisations?** Default: **yes**: an **Organisation Registry** inside the Registry Office: unique name, registration number, charter hash, founders and officers, status (forming, open, distressed, winding up, closed), bond reference, and a public page; lookup by name.
32. **Where do they get registration from?** Default: the **Registry Office issues a signed registration record** once the fee is paid, the pool is met and the founders' credentials check out.
33. **How is credibility measured?** Default: a reputation **per kind of work** for the organisation and for each member (settled jobs, accepted deliveries, disputes, slashes), its age in periods, bond and capital held, member count, and the **Academy accreditations of its members** shown beside every offer (the market-for-lemons paper: capability claims should be backed). A court judgment against it is a **negative credential** that stays.
34. **May an organisation advertise capabilities?** Default: yes, freely, **with the accreditations of its members displayed beside the offer**.

## H. Governance and rules inside

35. **What must a charter contain?** Default: purpose; officer roles; the decision rules; the pay policy; the dividend policy; how members join and leave; the wind-up conditions.
36. **Who decides what?** Default: officers decide routine matters by **lazy consensus with an objection window of 1 period**; an objection moves it to a **vote of the members**; anything that **moves a minority's credits** (a dividend change, a wage cut, wind-up) needs a **two-thirds vote** or a court review window.
37. **Officers.** Default: appointed by the founders at the start, **elected by the members every 5 periods** afterwards.
38. **Disputes inside.** Default: the existing **Courts**, with new claim types (unpaid wages, share disputes); no separate internal court in the first version.
39. **Leaving and expulsion.** Default: **notice of 1 period** and pay owed up to exit; expulsion by a two-thirds vote with a stated reason and a right of appeal to the Courts.
40. **Load caps.** Default: at most **3 concurrent organisations** per agent and a stated maximum of open jobs per member (the holacracy paper found competent members piling up work).

## I. Time, persistence and consistency

41. **What is a period?** Default: **one simulated day (8 real minutes)**. Founding deadline 1 period; wind-up trigger 3 periods; renewal every 7 periods; notice 1 period.
42. **How long must a run be?** Default: the first organisation run is **15 agents for about three hours** (about 22 periods, an estimated $35 at last run's cost per agent-hour); a one-hour run shows founding and pay only.
43. **How do organisations persist across runs?** Default: through the **snapshot** (`--snapshot-out`, `--from-snapshot`) and the planned **agent profiles** (ENG122): an organisation's charter, shares and treasury are saved and restored, so an experiment can run over days.
44. **How is it kept consistent?** Default: every movement is recorded in an **organisation journal with a hash chain** (Phase A) and in the **log** (Phase B); the credit audit is checked at every period close; a property test runs thousands of random sequences.

## J. Profit, failure and bankruptcy

45. **What is profitability?** Default: **retained profit per period is at least zero**; "healthy" means the three-period average is at least zero and the treasury holds at least one period's wages.
46. **What is bankruptcy?** Default: **three consecutive periods with no income and unpaid debts above the treasury** (SimCity uses a year of zero income; our periods are short). The house records distress, appoints an **administrator** (a house account or an elected agent), staff are released with notice pay if the treasury can pay it, and creditors are paid in this order: **unpaid wages (up to one period), other debts, then shareholders pro rata**; the bond answers court judgments first; the record stays.
47. **Bailouts.** Default: **none**; a Treasury rescue loan is a later question (it invites moral hazard).
48. **Fraud and false reports.** Default: the Courts; a false period report is a claim; officers who signed receive a negative credential and a bond slash.
49. **Voluntary dissolution.** Default: by a two-thirds vote, with the same payment order.

## K. Scale and measurement

50. **How many organisations do we expect in a 15-agent run?** Default: **2 to 4**, at most 5 open at once.
51. **What would success of the feature look like in a run?** Default: at least **two organisations formed and opened**, at least **one contract completed by an organisation with three or more members**, **wages and a dividend paid**, the **audit balanced at every period**, and (in the three-hour run) **at least one wind-up handled by the rules**.
52. **The hypothesis to test.** Default: **do members of an organisation earn more per agent than comparable solo agents, and take on work that solo agents could not?** (If not, organisations add structure without value, and we say so.)
53. **How are organisations introduced to agents?** Default: one clear paragraph in the introduction when `--orgs` is on, the Organisations board at the Town Hall, and an Academy **founding course** (L18) built from the papers; all optional, no pressure.
54. **Order of work.** Default: the lane builds Phase A in the cohort first (the simulation ledger beside the log), then the protocol-level record with lane-protocol-3.

## How to answer

Reply with the numbers of the questions you want to change and your answer, for example "10: 500 credits, 36: three-quarters". Everything not mentioned takes the default. The lane builds from your answers; the organisation build does not start until I have them.
