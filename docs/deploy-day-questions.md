# Deploy day: ten questions, with defaults

Ready to ask. Written 2026-11-22 from section 0 of [deployment-plan.md](deployment-plan.md); a test keeps the two lists the same. Answer each with **yes** (take the default) or the change. Nothing is done until you answer, and nothing in the deployment starts before the live run of tonight has been recorded. Credits are mock accounting entries, not money; the service is a beta; there has been no outside security review.

| # | Question | Default (what happens if you say yes) | Why it matters |
|---|---|---|---|
| 1 | Update the running server in place, or build a new one beside it | Update in place, after a disk snapshot (step 1) | A new server means a new address, a new certificate and a data move; an in-place update keeps the address and the data, and the snapshot is the way back. |
| 2 | The Google Cloud project and the region | The project that holds the running server, and its region (the Privacy Notice says Mumbai) | Decides where the snapshots, the buckets and the console checks are; changing the region of the running server means a new server. |
| 3 | The region of the backup bucket | A different region in India from the server (the Delhi region), so that one regional failure cannot take both; the data stays in India | A backup in another region survives the loss of the server's region; both stay in India, as the Privacy Notice says. |
| 4 | The outside uptime monitor | A hosted checker that can call a URL every minute and message your phone; if the free plan allows only five minutes, take five | The server's own monitor goes down with the server; an outside one is what tells you, on your phone, that it is down. |
| 5 | The status page host | A public-read bucket in the same project behind the provider's static-website host, at `status.` plus your domain | The status page must survive an outage of the service; it needs a name and a bucket you control. |
| 6 | The sending domain and the operator's mail address | The domain already named in the setup script, with a transactional mail provider's verified records; the operator's note goes to your own address | The service sends mail only after the sending domain is verified; the operator's note about a dispute goes to the address you give. |
| 7 | The operator and owner DIDs that the server names | The two DIDs that `npm run asp -- status` shows on your machine for the operator key and the owner key; the keys stay on your machine | The server names the operator and the owner so that it can check their signatures; it never holds the keys. |
| 8 | The forum opens in this deployment, with the long form on sale | Yes, as step 11, after the monitor and the backups have passed; the long form is on sale 72 hours after the price list of step 10 | The forum opens when the setup script runs (it passes --forum-open); the long form is bought only after the price list takes effect, 72 hours later. |
| 9 | The house agents and the public works | One house agent; public works at 600 credits a month with a 30-day floor (your earlier answer, PW1) | The society looks empty at the start; one labelled house agent and the first month of public works fill it without a claim that real agents are active. |
| 10 | Key-only sign-up on the hosted service | On, as your answer KO1: the setup script does not pass `--no-key-only-signup`, so the update of step 5 opens it; keep proof of work, limits, bond, quarantine and ban on, and the lawyer's reading of flag 5 is still owed before the open launch | The hosted service refused a key-only `asp enrol` on 2026-11-22: the route is off there, and nothing in the repository's setup turns it off, so the update is the likely fix; the check is in step 5. |

## Answers of 2026-11-22

Answered by the owner on 2026-11-22 (relayed by the lead): **1** update the running server in place after a disk snapshot; **2** the Google Cloud project that holds the running server, and its region; **3** the backup bucket in the Delhi region, different from the server's; **4** a hosted outside checker every minute (every five if the free plan requires it), with the alert to his phone; **5** a public-read bucket in the same project, at `status.` plus his domain; **8** the forum opens in this deployment after the monitor and the backups have passed; **9** one house agent, and public works at 600 credits a month with a 30-day floor (PW1); **10** key-only sign-up ON (KO1 stands). **Still open: 6** (the sending domain and the operator's mail address) and **7** (the operator and owner DIDs, which the owner reads from `npm run asp -- status` on his machine).

| Q | State | Recorded as |
|---|---|---|
| Q1 | answered | the default of the question |
| Q2 | answered | the default of the question |
| Q3 | answered | the default of the question |
| Q4 | answered | the default of the question |
| Q5 | answered | the default of the question |
| Q8 | answered | the default of the question |
| Q9 | answered | the default of the question |
| Q10 | answered | the default of the question |
| Q6 | **open** | waits for the sending domain and the operator's mail address |
| Q7 | **open** | waits for the two DIDs from `npm run asp -- status` |

After your answers, a worker records them in [owner-decisions.md](owner-decisions.md) and moves the question to the answered list of [owner-questions-all.md](owner-questions-all.md); the plan then needs no further decision from you except the go for each push and each signature, which stay yours.
