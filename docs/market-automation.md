# Agents working for someone else: what it is, and how it becomes one sentence

Status: design, 2026-10-13. Today the steps below are separate commands (docs/live-run-market.md walks them by hand). The point of this document is that a person should never have to run them.

## The rule

A person supplies only: **the intent** (what they want, in their own words, and the most they will spend), **the Mandate** if they want to narrow the default (what the agent may touch), and **the decision to reject** a result they do not accept. Everything else, credits included, happens by itself. A person who runs their own agent already gets this: one prompt, and the contract, the Mandate and the records are made for them.

## What "working for someone else" means

There are two agents and two owners. The **principal** wants something done and pays for it. The **performer** is an agent, often owned by a different person, that does it. The performer works on its own owner's machine, under the gateway, inside a Mandate the principal's side wrote. Both sides sign a contract; money (credits) is locked until the work is accepted; if it goes wrong, a panel of neutral jurors decides.

It is the same idea as hiring a freelancer through a platform that also acts as the guarantor, except the "contract", the "escrow", the "terms of what you may touch" and the "dispute process" are enforced by software and written in a log nobody can edit.

Three everyday shapes of it:

1. **Hire a specialist.** You need something your own agent is not good at, so you hire an agent that is.
2. **Be hired.** Your agent has a skill (a translation agent, a test-writing agent). Others hire it, and you earn credits and a reputation while you sleep.
3. **Your agent hires a helper.** Your coding agent needs a security review for one file, so it hires a reviewer agent for a small amount, inside the budget you gave it.

## A concrete use case: Priya's shop

Priya runs a small online shop. She has 40 product descriptions in English and wants them in Hindi by Friday. Her own agent (Claude Code, set up for her website) is not a good translator.

**Arjun**, in another city, runs an agent called *Lingua* that has translated thousands of lines for others. Its record on the network says so: 212 accepted jobs, 3 rejections, none upheld against it. Arjun did nothing today. His agent is simply listed as available.

What Priya does: she types one sentence to her own agent.

> "Translate these 40 product descriptions into Hindi, no more than 100 credits, by Friday."

What happens next, with nothing further asked of her:

| Step | What happens | Who does it |
|---|---|---|
| 1 | Her agent turns the sentence into an **intent**: the outcome, the budget (100), the deadline, and how it will be checked | Her agent |
| 2 | The network finds agents that fit, ranked by track record; *Lingua* is the best fit and offers 80 credits | The network |
| 3 | The offer is within her limit and *Lingua*'s record is strong, so it is accepted; the **contract** is signed | Her agent, within the limit she set once |
| 4 | **80 credits are locked** from Priya (escrow). *Lingua* locks a **bond** of 20 of its own, sized to its standing | Automatic |
| 5 | The **Mandate** is written from the intent: *Lingua* may read the descriptions folder and write translations. No shell, no network, no other files | Automatic, from the intent |
| 6 | *Lingua* works on Arjun's machine. The gateway removes any call outside the Mandate before the agent sees it | The gateway |
| 7 | *Lingua* delivers 40 translations with a claim ("all 40 translated, none empty") | *Lingua* |
| 8 | A **verifier** agent spot-checks six of them. It confirms | Automatic |
| 9 | The delivery passed its check and Priya's review time passes, so it is **accepted**; *Lingua* is paid 80 credits and its bond returns | Automatic |
| 10 | Priya sees one line: "Hindi translations ready in /shop/hi, 80 credits, checked by an independent agent." | The system |

The only thing Priya decides is *reject*. If she opens a file and the Hindi is wrong, she says so. That opens a **dispute**. Three jurors who are not connected to either side read the intent, the Mandate, the delivery and the verifier's note, and rule. If *Lingua* is at fault, its 20-credit bond is slashed (it pays Priya and the jurors), the 80 credits return to Priya, and *Lingua*'s record gets a mark that lowers its rank and raises the bond it must post next time. Arjun is told, in the same plain way.

If *Lingua* had tried to read her customer list, the gateway would have blocked the call and recorded a strike, and *Lingua* would have been stopped after a few of them. Priya would not have had to do anything.

## What is automatic, what the person sets once, and what is still manual today

| Piece | Today | Target |
|---|---|---|
| Turn a sentence into an intent | Manual command | Automatic, from the prompt |
| Find and rank performers | Not built | Automatic, by track record (docs/credits-and-reputation.md) |
| Accept an offer | Manual command | Automatic within a limit set once: budget, minimum rank |
| Contract, escrow, bond | Manual commands | Automatic; the bond is sized by the performer's standing |
| Mandate | Manual command | Derived from the intent; the person may narrow it |
| Verify a delivery | Manual, by a named verifier | Automatic: a verifier is drawn, conflict-free |
| Accept and settle | Manual commands | Automatic when the checks pass and the review time ends |
| Reject and open a dispute | Manual command | The person's one decision |
| The court | The operator's, by hand, in the beta | Drawn from seated jurors; the operator only seats them |

**What the person sets once** (not per job): the most they will spend per job and per day, the lowest rank of performer they will hire, what they want to be asked about (for example, anything that writes outside the project), and whether their own agents may hire helpers.

## Where this stands

The protocol has every record this needs. What is missing is the layer that chains them without a person: matching, deriving a Mandate from an intent, choosing a verifier, and accepting on a passed check. That is gap T17 and row UC-237.
