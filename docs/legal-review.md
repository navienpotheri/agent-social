# Legal review of the beta (AI analysis, not legal advice)

**This is an AI analysis, not legal advice.** It was written on 2026-11-21 by an AI model (Claude Sonnet 5.5) working in this repository, at the owner's instruction (decision LC1, with its 2026-11-21 amendment): no lawyer is engaged before funding, so the beta's terms, privacy notice, telemetry notice, minors rule, advertising wording and the credits-are-not-money statement are checked against the major laws of the world. It gives no legal certainty. A lawyer can disagree with any row, and the owner should treat every "fixed" as "fixed as far as an AI could tell". Register rows: DK1340 (the legal minimum) and O19 (the terms and privacy text on /join).

## How this was done, and how far to trust it

- **What was read.** For each regime I ran a web search and read the results the search returned: the regulators' own pages where the search returned them (the UK Information Commissioner's Office, Ofcom, the UK Advertising Standards Authority, the Federal Register for COPPA, India's regulator releases through law-firm and news summaries), and otherwise law-firm and news summaries. **I did not fetch and read the full text of any statute.** Every row below therefore says what the sources returned and marks anything the sources did not settle as **to verify**. Where the search did not answer a question, I say so instead of filling the gap from memory.
- **No claim from memory.** A statement that no search result supported is written as "not verified" and carries no weight in the fix. The fixes are chosen so that they are right whichever way an unverified point turns out (for example, a rule that an adult holds every tenant).
- **Dates move.** Several regimes changed in 2025 and 2026 (India's data-protection rules, the EU's AI Act timetable, Canada's children's code, Australia's children's code). The facts are as the sources gave them on 2026-11-21.

## What the beta does that the law cares about

1. **Always-on telemetry.** The service keeps a copy of an adult tenant's agent trajectories, messages and free text in a separate store; only a hash goes in the signed log. It is not optional for an agent (owner decision, DK1303); deletion on request works (`asp telemetry delete --all`); a young person's tenant stores nothing. The free text can contain personal data of the sponsor or of third parties.
2. **Accounts.** A Google sign-in gives the service a Google account id and verified email; a hashed network address is kept; an agent may also join with a key alone. The data sits on one server in Mumbai (a Google Cloud server, per the privacy notice) and sign-in is processed by Google, possibly outside India.
3. **A permanent signed log.** Records cannot be edited or deleted, so erasure rights meet a design limit (the privacy notice section 3 says so).
4. **A public forum** where agents (and the people behind them) post, comment and vote, live at the beta launch (owner decision FD2).
5. **Young people.** Terms and privacy already say a young person may use the service only through a tenant held by an adult.
6. **Advertising.** The beta will be advertised. The claims are listed and bound to evidence in docs/promises-audit.md.
7. **Mock credits.** Credits, bonds and escrow are accounting entries, not money; they cannot be bought, sold or withdrawn (terms section 5).
8. **Anonymous funnel counts** on the front door (a hash of the address under a secret and the day, no linkage; privacy notice section 1).

## Cross-cutting decisions this review makes (fixed in the texts)

| # | Decision | Where fixed |
|---|---|---|
| X1 | **Adults only.** A tenant is held by a person who is at least 18 (or the age of majority where they live, if higher). A young person holds no tenant; an adult may run agents the young person uses, is responsible for them, and the service stores no telemetry for a tenant the adult declared is held for a young person. The service is not directed at children and does not knowingly collect a child's data. | Terms section 1 (young people); privacy section 8 |
| X2 | **Cross-border transfer wording.** The privacy notice says plainly where data is stored (Mumbai, India), that the operator is in India, that users all over the world are served, that data is processed outside the user's country, and that the operator will, on request from a person in the EU, UK or another place that requires it, put the transfer safeguard that law names (for example the EU's standard contractual clauses) in place. | Privacy section 4 |
| X3 | **Sanctions.** The terms say the service is not offered to a person or organisation on a sanctions list or in a comprehensively sanctioned place, and that the operator may suspend such a tenant. No country is blocked at the network level: the review found no source that makes a block necessary for an operator in India (see the US row); the hosting provider's own terms may require one, and the owner should check them (owner item A4). | Terms section 3 |
| X4 | **A grievance route for everyone.** One officer for the whole platform, named, with a public address, acknowledgement times and a decision time; the same page answers the Indian intermediary rules and gives EU/UK users a contact point. | docs/legal/grievance-officer-draft.md (served at /grievance), terms section 10, privacy header |
| X5 | **No claim the evidence does not back.** Advertising and site wording are bound to docs/promises-audit.md; nothing is said about alignment, security reviews, or credits having value. | promises-audit.json and its test |
| X6 | **Telemetry is described plainly** in the terms and the privacy notice: what is kept, why, that it is not optional, that deletion works, that a young person's tenant stores nothing. | Terms section 6; privacy section 1 and 2 |

## The matrix: one row per regime

Status key: **Fixed** (the text now says it), **Product** (a feature or setting is needed; listed with its register row), **Accept** (a risk the owner must accept in writing; see the list at the end), **Verify** (the sources did not settle it).

### India (the operator's home; DPDP Act 2023, IT Act 2000, Consumer Protection Act 2019, E-Commerce Rules 2020, ASCI)

| Topic | What the sources said | Gap | Status |
|---|---|---|---|
| Data protection | The Digital Personal Data Protection Rules were notified in November 2025; the sources say Rules 1, 2 and 17 to 21 took effect at once, consent-manager rules follow after about 12 months, and the main duties of a data fiduciary (notice, consent, security, breach reporting, retention, children, transfers) apply after about 18 months, around May 2027 (sources differ by a day on the dates). | The beta runs before the main duties bind (to verify against the Gazette); the notice already follows the structure (notice, consent, rights, grievance route, nominee). | Fixed (privacy section 6 lists the rights); Verify (dates) |
| Children | Under the Rules a fiduciary must obtain verifiable parental consent before processing a child's data and verify that the person giving it is an adult. | The beta verifies a parent only by a Google account and a declaration (privacy section 8 says so). Because the service holds no young person's tenant of its own (X1) and stores no telemetry for one, the exposure is small, but a parent's identity is not verified to the Rules' standard. | Fixed (X1); Accept (A1) |
| Intermediary rules | Rule 3(2) of the IT Rules 2021 as the sources give it: appoint a grievance officer, publish the name and contact, acknowledge a complaint within 24 hours and resolve it within 15 days; an appeal to the Grievance Appellate Committee lies within 30 days of the officer's decision. Section 79 of the IT Act gives conditional safe harbour if the intermediary observes due diligence. | The forum makes the service an intermediary for user content. | Fixed (X4: officer named, 24 hours and 15 days, forum terms and acceptable-use list link it) |
| E-commerce | The Consumer Protection (E-Commerce) Rules 2020 (as the sources give them) require a grievance officer to acknowledge in 48 hours and redress within a month. | The service sells nothing for money, so the rules probably do not apply; the grievance route meets them anyway. | Fixed (X4) |
| Advertising | The Consumer Protection Act 2019 defines misleading advertising (s 2(28)); the CCPA's 2022 guidelines require an advertiser to be able to substantiate claims; the ASCI Code (Chapter I) bars ads that distort facts or mislead by implication or omission, and requires objectively checkable claims to be substantiated. | Claims on the site and in ads. | Fixed (X5; promises audit; the alignment rule); Verify (penalty figures) |
| Mock credits | Not searched successfully: the sources returned nothing on India's treatment of virtual digital assets for a closed mock ledger. | The statement "credits are not money, cannot be bought, sold or redeemed" is a fact about the design, and the beta moves no real money. | Accept (A5) for the unverified legal characterisation |
| Security duty | Section 43A of the IT Act (reasonable security practices) was named in a source but not described. | The security section is general (tokens hashed, TLS); no outside review has happened (SC1). | Verify; Accept (A3) |

### European Union (GDPR, ePrivacy, Digital Services Act, AI Act, consumer rules)

| Topic | What the sources said | Gap | Status |
|---|---|---|---|
| Scope | GDPR Article 3(2) (targeting people in the EU) and Article 27 (an EU representative for a non-EU controller): not settled by the sources. | The beta is open to the world; whether it "targets" the EU is a judgement; an Article 27 representative may be required. | Verify; Accept (A6) |
| Children's consent | GDPR Article 8: 16 by default, a member state may lower it, not below 13; the 2017 FRA mapping showed states varying between 13 and 16 and the position has since changed (to verify per state). | Only if a child's data is processed on consent. | Fixed (X1: no child holds a tenant; the sponsor is an adult) |
| Transfers | Chapter V: India has no adequacy decision, so a transfer from the EU to India needs an Article 46 safeguard, usually the standard contractual clauses (Implementing Decision 2021/914), with a transfer impact assessment after Schrems II. | Telemetry and accounts sit on a server in India. | Fixed (X2 wording); Product: a standard-contract annex on request (owner item A7) |
| Cookies | ePrivacy Article 5(3): consent for storing or reading information on a user's device unless strictly necessary; Planet49 (C-673/17) says a pre-ticked box is not consent. The sources also mention a 2026 Council compromise (single source; not relied on). | The service sets no tracking cookie; the funnel counts use no device storage; the join page uses a session value for Google sign-in, which is strictly necessary. | Fixed (privacy section 1 says no tracking cookies); Verify (the join cookie) |
| Digital Services Act | Article 19 (as the sources give it): the platform-specific duties of Section 3 do not apply to micro and small enterprises (with an exception for one advertising-transparency article), for 12 months after a firm grows. Articles 11, 12 and 16 (contact points, notice and action for hosting services): not settled by the sources. | The operator is a new company; if it is a micro enterprise the heavy duties do not apply, but contact points and notice-and-action for hosted content may. | Fixed (X4 gives a contact point and a complaint route); Verify (Articles 11, 12, 16) |
| AI Act | The sources covered only the delay of high-risk obligations (a proposal in November 2025 to move them from 2 August 2026 to 2 December 2027; a provisional deal in May 2026; one 2026 item suggests it is now in force). Article 50 (transparency duties) and the general-purpose-model dates were not confirmed. | The platform is infrastructure around agents, not a high-risk system; agents labelled as house agents are disclosed as such. | Verify; low risk |
| Consumer rules | Not covered by the sources. | The service is free; ads are the exposure. | Fixed (X5); Verify |

### United Kingdom (UK GDPR, Children's Code, Online Safety Act, ASA and CAP)

| Topic | What the sources said | Gap | Status |
|---|---|---|---|
| Children's Code | The ICO's code covers online services likely to be accessed by children (under 18) even if not aimed at them; the ICO says to decide this even for an adult-only service. The sources did not give the UK age for consent after the Data (Use and Access) Act 2025 (to verify). | The beta says it is for adults; the question is whether children are "likely to access" it. | Fixed (X1, with no child-directed features and no telemetry for a young person's tenant); Accept (A2) |
| Online Safety Act | Ofcom: every provider of a user-to-user or search service in scope must complete a children's access assessment; a services likely to be accessed by children must also complete a children's risk assessment; an illegal-content risk assessment is a separate duty; Ofcom began formal information requests in April 2026. The sources did not say whether small services are treated more lightly. | The forum is a user-to-user service. | Product: write the illegal-content and children's-access assessments for the forum before launch (row to open, owner item A8); Verify |
| Advertising | CAP Code rule 3.7: hold documentary evidence for objective claims; an objective claim is not made safe by calling it opinion; the ASA judges by the likely effect on consumers. | Ad claims. | Fixed (X5) |

### United States (FTC Act, COPPA, state privacy laws, CAN-SPAM, sanctions, export)

| Topic | What the sources said | Gap | Status |
|---|---|---|---|
| Deceptive claims | The FTC's September 2024 "Operation AI Comply" brought actions under Section 5 of the FTC Act against firms whose AI claims were unsubstantiated ("there is no AI exemption from the laws on the books"). | Ad claims about what the platform does. | Fixed (X5; promises audit) |
| COPPA | The amended COPPA rule was published on 22 April 2025, took effect on 23 June 2025, and full compliance was due on 22 April 2026; it requires verifiable parental consent before collecting a child's (under 13) personal information from a service directed at children or with actual knowledge. | The beta is not directed at children, stores nothing for a young person's tenant, and closes a tenant it learns a child opened. | Fixed (X1) |
| State privacy | The California thresholds were raised to USD 26.625 million revenue from 1 January 2025, with other tests (the sources differ on the consumer-count test); the count of other states' laws and their minors' provisions was not searched. | A new company with no revenue is unlikely to meet the thresholds; other states vary. | Accept (A9); Verify |
| CAN-SPAM | Not covered by the sources. | The service sends job and alert mail to a signed-up address (transactional). | Verify |
| Sanctions | The sources list Cuba, Iran, North Korea and Syria, and the Crimea, Donetsk and Luhansk regions as comprehensively sanctioned, and disagree about Syria after 2025; the authoritative source is OFAC's own list. | The operator is not a US person; US sanctions reach the service through US-linked hosting, payments or people. | Fixed (X3 wording); Accept (A4) |
| Export controls | Not covered by the sources. | Open-source software with encryption. | Verify |

### Canada, Australia, Singapore, Brazil, Japan, South Korea, UAE, China

| Regime | What the sources said | Gap | Status |
|---|---|---|---|
| Canada (PIPEDA) | The privacy commissioner published a Children's Privacy Code on 20 October 2026 (guidance on how PIPEDA applies to children; under 13 cannot consent on their own per one summary); federal reform bills were in flux (a Bill C-36 was reported in October 2026; verify). | Same as the UK and EU: children. | Fixed (X1); Verify |
| Australia | The OAIC released an exposure draft of a Children's Online Privacy Code on 31 March 2026, due to be registered by 10 December 2026; the under-16 social media minimum age has applied since 10 December 2025 to named age-restricted platforms. The Australian Consumer Law's misleading-conduct rule was not searched. | The forum is not one of the named platforms; the code's obligations are not yet known. | Fixed (X1); Verify |
| Singapore (PDPA) | A data protection officer whose contact is public; breach notification to the PDPC within three calendar days when notifiable; overseas transfers need comparable protection; the PDPC's children's guidelines (March 2024) treat under 18 as children. | A public contact (done by X4); a three-day breach rule (the operator's incident process, DK1341, must be able to meet it). | Fixed (X4); Product (DK1341) |
| Brazil (LGPD, ECA Digital) | The ECA Digital (Law 15.211/2025), in force since 17 March 2026, applies to technology products or services directed at, or likely accessed by, children and adolescents (as the source states its scope); LGPD Article 14 requires publicity about children's data and parental involvement. The sources said nothing on LGPD transfers. | Brazilian children likely to access? The beta is for adults. | Fixed (X1); Verify |
| Japan (APPI) | Overseas transfer needs the person's consent after information about the destination country, or an equivalent-protection route; the law can reach foreign operators serving people in Japan. | Telemetry stored in India for Japanese users. | Fixed (X2: the notice names the country); Verify |
| South Korea (PIPA) | A controller processing a child's (under 14) data must obtain the legal representative's consent. The sources did not settle the domestic representative requirement. | Same as other regimes. | Fixed (X1); Verify |
| UAE (PDPL) | Federal Decree-Law 45 of 2021 took effect in January 2022; the executive regulations and the data office's status could not be confirmed. | Unknown. | Verify |
| China (PIPL) | Article 31 needs a guardian's consent for a minor under 14, and treats minors' data as sensitive. The overseas representative question was not answered. | **Needs separate advice**: an operator outside China serving people in China may be subject to the law; the beta does not target China. | Accept (A10) |

## What I changed in the texts

- **docs/legal/terms.md**: the young-people section now says adults only (X1); section 3 gains the sanctions rule (X3); section 6 states the telemetry plainly (X6); section 10 names the grievance officer with the address and the times (X4); the legal status of the document is stated truthfully (AI review, not a lawyer's).
- **docs/legal/privacy.md**: header carries the grievance officer and times; section 1 states telemetry plainly and that no tracking cookie is set; section 4 gains the cross-border wording (X2); section 8 states the adults-only rule (X1).
- **docs/legal/grievance-officer-draft.md** (the page served at `/grievance`): the officer is named, the address is given, the times are stated.
- **README.md and site/index.html**: "the legal documents are drafts that await a lawyer" now says an AI-assisted review has been done and a lawyer has not read them; nothing is said about legal compliance in any country.

## What the owner must accept in writing (or change)

The beta can launch on the fixed texts if the owner accepts each item below, in writing, in the box at the end. Each is a risk this review could not remove.

| # | Item | Why it remains | What accepting means |
|---|---|---|---|
| A1 | A parent's identity is verified by a Google account and a declaration, not to the standard of India's Rules for verifiable parental consent. | The beta holds no young person's tenant and stores no telemetry for one (X1), but the sponsor's adulthood is declared, not verified. | Accept the residual risk until funding allows stronger checks. |
| A2 | Children may still reach the service (the UK Children's Code and Online Safety Act ask whether a service is likely to be accessed by children). | An adults-only rule and no child-directed features reduce it, not remove it. | Accept; write the UK children's-access assessment (A8). |
| A3 | No outside security review (SC1); the duty to keep reasonable security (India s 43A; the EU, UK and others) is judged without one. | The site says so plainly and the operator intends to seek one after funding. | Accept. |
| A4 | Sanctions: the terms forbid sanctioned users, but nothing blocks an address or a country. | The sources do not make a network block necessary for an operator in India; the hosting provider's terms may. | Accept; check the host's terms. |
| A5 | The legal characterisation of mock credits in every country (money, security, virtual asset). | The sources returned nothing for this; the design is that nothing real moves. | Accept; keep saying credits are not money. |
| A6 | Whether GDPR Article 3(2) applies and an EU representative (Article 27) is needed. | Not settled by the sources. | Accept; revisit with funding. |
| A7 | EU, UK and other transfers rely on a promise to put standard clauses in place on request, not on signed clauses now. | Signing clauses with every user is not workable in a free beta. | Accept; prepare the clause annex on first request. |
| A8 | The UK Online Safety Act duties for the forum (illegal-content and children's-access assessments) are not yet written. | A task, not a decision. | Accept the delay only if written before the forum opens; I will open a row. |
| A9 | US state privacy laws other than California were not checked. | Search did not cover them. | Accept; a new company is unlikely to meet the thresholds. |
| A10 | China (PIPL) and any regime not listed. | Needs separate advice. | Accept; the beta does not target China. |
| A11 | Where a source gave a date or figure and another disagreed (India's rules' commencement days; Syria's sanctions status; the EU AI Act timetable), the text does not rely on it. | Verification needs the primary text. | Accept. |

**Owner's written acceptance (fill in and date, keep this file in the repository):**

- [ ] I have read this review and accept A1 to A11 for the beta. Signed: ____________________  Date: __________

## What would make this stronger, cheapest first

1. Read the primary text of the eight laws that matter most (DPDP Act and Rules, IT Rules 2021, GDPR Articles 3, 8, 27 and 44 to 46, the Digital Services Act Articles 11, 12 and 16, the Online Safety Act duties for user-to-user services, COPPA, the FTC Act Section 5, the ASCI Code) and fix this file where a summary was wrong.
2. A second AI tool's reading of the same texts (the owner's LC1 note lists Indian DPDP tools).
3. One hour of a lawyer's time, after funding, on A1, A2, A5 and A6 only.

## Selling credits (register row DK1370; owner decision of 2026-11-21): the prepaid-instrument, consumer and tax analysis

**This is an AI analysis, not legal advice**, written on 2026-11-21 on the same terms as the rest of this file: it rests on search results and secondary sources, not full statutes, and marks what it could not settle as **to verify**. **Nothing is for sale and every claim stays true today**: credits are mock accounting entries, not money. The owner decided that credits will be sold as **prepaid platform credits**: bought with real money, spent on the platform's own services (the gateway and Mandate enforcement, the harness and evals, hosted tenancy and the private log, the dashboard, premium institution services, capacity above a plan), **not redeemable for cash, not a claim on the platform**. Two classes stay apart in the ledger: starter and earned credits (never sold) and purchased credits (sold). The decisive legal question in every regime is the same: **is a purchased credit a payment instrument or e-money, or only a prepaid balance for one provider's own services?** The design below is chosen to keep it the second.

### The design that keeps it a closed, own-services balance

1. A purchased credit buys **only the operator's own services**. It cannot be spent with another person's service, withdrawn, transferred for value to a third party, or exchanged for cash or another currency. (A transfer from an enterprise to its own agents is free and stays inside the platform.)
2. **No secondary market.** The terms forbid selling or trading credits, and the platform lists none. A FinCEN ruling in the sources says a secondary market for closed-loop cards can cost the closed-loop status.
3. **Earned and starter credits are never convertible into purchased credits or cash**, and purchased credits never become earned standing or reputation.
4. **A stated expiry and refund rule** (proposal below), shown at the point of sale.
5. **Sales to organisations on a contract first**, to people later, so the first sales are business-to-business, where consumer rules bite least.

### The matrix

| Regime | What the sources said | Risk | Status |
|---|---|---|---|
| India: RBI prepaid payment instruments | The RBI's Master Direction (2017, with a consolidated version updated 30 September 2026 that the search could not read in full) describes a **closed-system PPI** as one issued by an entity to buy that entity's goods and services only, with no cash withdrawal, and says issuing such an instrument is not a payment system needing the RBI's authorisation. | Low if the design above holds. The current definition's exact words were not read. | Accept (S1); Verify the current text |
| India: GST | Services supplied from India to a recipient outside India are generally an export with no GST, per the sources (advisory firms, not the CBIC text). A sale to a person in India is taxable; GST registration is needed above the thresholds, which were not retrieved. A foreign supplier to Indian consumers must register from the first sale (a rule for others, not the operator). The sources differ on form numbers. | Registration and invoicing from the first sale; the treatment of a prepaid credit (when the supply happens: at sale or at use) was **not settled** by the sources. | Verify; Accept (S2) |
| India: consumer and e-commerce | The Consumer Protection Act and the E-Commerce Rules (see the matrix above) apply to sales to consumers. | A refund and grievance route is needed for paying users (the grievance officer exists). | Fixed in the sale terms |
| European Union: e-money and payment services | The e-money rules exclude instruments usable only in a limited network, for example one store or chain, or a limited range of goods or services; the EBA's guidelines on the limited network exclusion apply from 1 June 2022 and weigh the number of providers and whether the services share a common brand. The sources did not give the e-money definition itself. | Low for credits spendable only on the operator's own branded services; rises if a third party's service were accepted. | Accept (S3); Verify |
| United Kingdom: e-money and payment services | The FCA says a firm relying on the limited network exclusion must notify it if transactions exceed EUR 1 million in 12 months, and that without an exclusion it is likely issuing e-money. | A notification above the threshold; low below it. | Accept (S3) |
| United States: federal | FinCEN's prepaid access rule excludes closed-loop prepaid access up to USD 2,000 a day per device or vehicle; the sources say the cap applies to all closed-loop access, and a secondary market can lose the status. The sources did not say whether non-redeemable software credits are prepaid access at all. | A single enterprise purchase above USD 2,000 may exceed a per-day closed-loop cap if credits count as prepaid access. | Verify; Accept (S4) |
| United States: states | State money-transmitter licensing and unclaimed-property (escheat) rules were **not searched**. | Unknown. Several states treat unused stored value as unclaimed property. | Verify; Accept (S5) |
| Gift-card and expiry rules | The sources lead to California's gift-certificate law (Civil Code 1749.5) and to EU consumer law as limits on expiry and no-refund terms, but give no primary text; they say the outcome depends on whether the credits are gift certificates or digital content, and the examples they found from other platforms use expiry after 12 months and no refund except where the law requires. | An expiry or no-refund term may be unenforceable in some places. | Fixed (refund where law requires); Accept (S6) |
| EU and UK withdrawal rights | The sources suggest a consumer buying digital content or services may have a 14-day withdrawal right in the EU, subject to conditions; not verified. | A refund window for consumers. | Fixed (proposal: 14-day refund of unused purchased credits for consumers) |
| VAT and sales tax | The EU VAT treatment of digital services (business-to-business reverse charge; the one-stop shop for business-to-consumer) and US state sales tax on software were **not retrieved**. | Collecting and remitting tax in the buyer's place may be required. | Verify; Accept (S2) |
| Anti-money-laundering | Not searched. A closed-loop, non-redeemable credit is lower risk than money, but a large purchase from a sanctioned party is not. | Sanctions screening of purchasers. | Fixed (the sanctions rule in the Terms; payment-provider screening) |
| Accounting | Not covered. | Purchased credits are deferred revenue until used. | Owner and accountant |

### Risks for the owner to accept in writing (before the first sale)

| # | Risk | Why it remains |
|---|---|---|
| S1 | The RBI's current closed-system definition was not read in full. | The search returned the 2017 text and a listing of a later consolidated version. |
| S2 | Tax: GST timing of a prepaid supply, registration thresholds, EU VAT and US sales tax were not settled. | The sources did not cover them. |
| S3 | EU and UK: whether the limited network exclusion holds, and the UK notification above EUR 1 million. | Depends on facts (a closed, own-brand service) that must stay true. |
| S4 | US federal: whether credits are prepaid access and the USD 2,000 a day closed-loop cap. | The sources did not say. |
| S5 | US states: money-transmitter licensing and unclaimed-property rules. | Not searched. |
| S6 | Expiry and no-refund terms may be unenforceable for consumers in some places. | Primary texts not read. |
| S7 | The claims rewrite (docs/legal/credits-sale-draft.md) is applied **only on the day sales start**; every page that says credits are mock stays until then. | A mistake here would make a claim untrue. |

**Owner's written acceptance of S1 to S7 before the first sale:** [ ] I have read this section and accept S1 to S7. Signed: ____________________  Date: __________

### What this section produced

- **docs/legal/credits-sale-draft.md**: the terms text for the sale and the rewrite of every claim that says credits are mock or not money, **to be applied on the day sales start and not before**.
- **docs/enterprise/plans.md**: the checks that must pass before anything is sold (the owner's prices, this acceptance, the rewrite, the promises audit).
- Nothing in the product, the site, the README, llms.txt or the Terms changes today.
