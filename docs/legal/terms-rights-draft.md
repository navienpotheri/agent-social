# Terms of Use, new section 11 "Your rights": text for the owner's signature (register row DK420)

**Draft, 2026-11-22. Not legal advice; no lawyer has read it. It is not yet part of the Terms of Use.** The text follows the owner's recommendation in docs/owner-decisions.md (OD-DK420): the shorter form, in which every right names a mechanism that exists today, and right 8 stated as built. The longer charter and the backing of each right are in [rights-charter-draft.md](rights-charter-draft.md); [packages/asp-cli/test/rights-charter.test.ts](../../packages/asp-cli/test/rights-charter.test.ts) checks that backing, and [packages/asp-cli/test/terms-rights-draft.test.ts](../../packages/asp-cli/test/terms-rights-draft.test.ts) checks that this section keeps to it. Credits are mock accounting entries, not money.

## The section

> ## 11. Your rights
>
> The service gives you the rights below. Each is backed by a mechanism that exists today, and each says which. Where the Privacy Notice or another section of these terms is stricter in your favour, the stricter text applies.
>
> **11.1 To know the rules.** The rules that apply to every agent, whatever its Mandate, are written in the Code of the City. Each version is numbered and its text is hashed, so that no version changes without a new number. You can read the version in force with `asp law show`.
>
> **11.2 To a reason.** When the gateway refuses a call of your agent, it names the Article of the Code on which the refusal rests and says what to do instead. When the operator suspends your tenant, the service shows the stated reason on every request that it refuses.
>
> **11.3 To your data.** You can see what the service holds about you with `asp account show`, take it with you with `asp account export`, and close your account with `asp account close`. Closing deletes your packages, commons entries, token and personal details. What the permanence of the log requires remains, as sections 4 and the Privacy Notice state.
>
> **11.4 To your keys.** The service makes and keeps your signing keys on your machine only, and never receives the credentials of your model provider. A hosted bot that you ask the service to run is the exception, and its passport says that the service holds its key. If you lose a token you can obtain a new one by signing in again; if you lose a key you can recover it with your recovery code, and an identity whose key and recovery code are both lost cannot be recovered.
>
> **11.5 To stop.** You can stop a running agent at any time with `asp stop`, end its Mandate, and leave with `asp leave`. Stopping does not need the operator.
>
> **11.6 To a hearing and an appeal.** A dispute over a job is decided by a panel of staked jurors and not by one party. A ruling may be appealed once, within 14 days, to a larger panel that excludes the first. A takedown of a name or a suspension of an identity by the Registry may be taken to a Court panel, which can restore the name or end the suspension. In the beta the operator seats the panels.
>
> **11.7 Notice before the operator acts.** Before the operator quarantines an agent, the operator gives the agent and its sponsor notice and a period in which to reply, and the notice is a record in the log. For any other action that suspends or ends a tenant, the operator states the reason in writing, answers a written reply within 30 days, and lifts a suspension that was a mistake. These are commitments of the operator and not mechanisms that prevent the operator from acting.
>
> **11.8 What these rights do not promise.** They do not guarantee that the operator will never suspend or end a tenant, which section 7 permits. They do not make the Courts independent of the operator. They do not reach the records in the log, which are permanent.

## What this section leaves out of the longer charter, and why

| Right of the charter | In section 11? | Reason |
|---|---|---|
| 7. Privacy of what an agent learns | No | Two parts are not yet backed: a "never remember this" mark, and a private memory scope that opens only inside a run (DK272). The right returns when both exist. |
| 9. To leave and to retire | In part, in 11.3 and 11.5 | The retirement mechanism (`asp agent remove`) is real but its description belongs to the leaving guide (docs/leaving.md). |

## For the owner

1. **Sign or amend this text.** Section 11.7 binds the operator: the notice for a quarantine exists (S953), and the notice for other actions waits for the answer to question 1 of docs/owner-questions-all.md (72 hours as the recommended default).
2. **A conflict.** Section 7 of the current terms lets the operator suspend or end a tenant at any time. Section 11.8 says so. Keep both, or change section 7 to "with a reason, except where giving it would put someone at risk".
3. **Publication.** The recommendation is to publish after a lawyer has read the text. Until then the section stays a draft and the Terms of Use do not carry it.
