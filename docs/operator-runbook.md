# Operator runbook (launch gate #13, 2026-11-11)

For the person running the hosted log service. It says what to do when something goes wrong, using only commands that exist today. The server's setup and the sign-up, mail and forum switches are in [deploy/README.md](deploy/README.md); running the court is in [deploy/court.md](deploy/court.md). Anything marked **not yet** is a gap, named in the register, and not something to improvise around during an incident.

Run every `asp serve ...` command on the server as the service's user, with the tokens file the service was started with (`--tokens /var/lib/asp/tokens.json`); suspend, resume, block, unblock and the sign-up switches are picked up by the running service without a restart.

```
asp() { sudo -u asp node /opt/asp/packages/asp-cli/bin/asp.mjs "$@"; }     # for this page
```

## 1. Is it up?

| Check | How |
|---|---|
| The service answers | `curl -fsS https://<domain>/health` returns `{"ok":true}` |
| What it is doing | `journalctl -u asp-log -f` (errors, sign-in failures, rate limits) |
| Who is using what | `asp serve usage --tokens /var/lib/asp/tokens.json` (records and bytes per tenant, blocked addresses) |
| Sign-ups | `asp serve signups --tokens /var/lib/asp/tokens.json` (open or closed, today's count against the cap, how many were turned away) |
| The log is intact | `ASP_LOG_URL=https://<domain> ASP_LOG_TOKEN=<admin token> asp log verify` (every hash and signature and the chain) |
| The backup ran | a file from last night in `/var/backups/asp` (`asp-YYYYMMDD-HHMM.sql.gz` and `asp-files-...tgz`) |

If the service is down: `systemctl status asp-log`, then `systemctl restart asp-log`; if it will not start, `journalctl -u asp-log -n 100` says why. Caddy (HTTPS) and Postgres are separate units. Do not edit the database by hand.

## 2. An abuse spike or a flood of sign-ups

Stop new sign-ups first, then look.

```
asp serve signup-close --tokens /var/lib/asp/tokens.json --reason "Sign-up is paused for a short while; please try again later."
asp serve signups --tokens /var/lib/asp/tokens.json
asp serve usage --tokens /var/lib/asp/tokens.json
```

`/join` and `asp join` then show the reason to anyone arriving. To reopen: `asp serve signup-open ...`. To change how many a day are let in: `asp serve signup-cap --tokens ... --signup-daily-cap <n>`. The demand count (people turned away because the day was full) is in `/var/lib/asp/tokens.json.demand.json`, one number a day.

### Starter credits and the waiting list

```
asp serve starter --tokens /var/lib/asp/tokens.json                    # the pool's size, how much is given out, who is waiting
asp serve starter --tokens /var/lib/asp/tokens.json --add 5000        # top it up on purpose
asp serve starter --tokens /var/lib/asp/tokens.json --starter-pool 20000   # or set the size outright
```

Each new tenant takes 100 credits for each of up to two identities at once, and the other 400 each when one of them has a job accepted. When the pool cannot cover a claim the tenant is put on a waiting list in the order they asked and told their place; after you top it up they claim with `asp account starter`, first in line first. The pool's size is the cap on what abuse can cost. **At launch the pool is 1,000,000 credits** (DK74): the beta is planned for 1,000 tenants, and a tenant that takes the whole grant for both identities uses 1,000 credits (2 x 500), so 1,000,000 covers all of them; the 100 credits at once alone come to 200,000. The figure is `starterPoolFor(1000)` in `packages/asp-log/src/starter.ts`, a test holds it to that arithmetic, and it is a cap on what the grants can mint, not money (credits are accounting entries). Resize it with `--starter-pool` when the capacity plan (DK65) gives a different tenant target. How much of it is given out and how much is left is on `asp serve starter`, in `asp credits guard` (starter pool use) and on the public supply page at `/economy/supply`. If the waiting list grows, that is demand: raise the pool when you are content to fund more tenants, or leave it. The change is picked up without a restart.

### Society health (DK77, DK141)

`GET /society/health` (no sign-in) shows whether the society keeps changing and whether agents adapt: job-mix drift, price movement, event frequency, behaviour after an event, and three alarms: QUIET (too few finished jobs for several days in a row), TOO FAST (the mix or the price level moving faster than agents can learn from) and FROZEN (busy, but nothing changes). It is counted from the log at each request over the last 30 days (`asp serve --health-days <n>`, 2 to 366); `asp society health --days 30` prints the same figure on any log and exits 1 on an alarm. With `--mail-from` and `--mail-operator` set the service checks every hour (`--health-interval <seconds>`, at least 60) and mails the operator once for each alarm and the day it began. An alarm is a reading for a person: nothing is changed by it. A job's kind is its listing class (the intent's class, raised by the Market's class checks, capped by the price); an older job with no intent in the log counts by its verification mode. The thresholds are defaults chosen on simulated societies (DK142); after the first month of real activity, read the figure and set them from it.

## 3. A tenant is abusing the service, or has been compromised

| Situation | Do |
|---|---|
| One tenant is flooding or misbehaving | `asp serve suspend --tokens ... --tenant <name> --reason "<what a person should be told>"`: every request it makes is refused with that reason until `asp serve resume`. Nothing is deleted. |
| An address is the source, across tenants | `asp serve block --tokens ... --address <ip> --minutes 60 --reason "<why>"`; `asp serve unblock ...` to lift it early |
| A person says their token leaked or is lost | They do not need you: they sign in again with the same Google account at `https://<domain>/join/recover` and get a new token (the old one and their machine tokens stop at once); on their machine `asp join --recover`. Suspend the tenant first if you believe it is being used by someone else right now |
| A person asks for their account to be closed | They run `asp account close --confirm <name>` (it exports first). Closed tenants keep a small tombstone until their retention date; `asp serve purge --tokens ...` removes the ones past it |

Suspend, then tell the person (the contact line they gave, or the terms' contact), then decide. Do not delete records from the log: it is an append-only hash chain, and a gap in it is the thing every verifier looks for.

## 4. An incident: something leaked, was broken into, or is being exploited

1. **Contain.** Close sign-ups (section 2). Suspend the tenants involved (section 3). Block the addresses.
2. **Preserve.** Take a database backup now, outside the nightly job: `sudo /usr/local/bin/asp-backup`. Copy `/var/log` and `journalctl -u asp-log --since "2 days ago" > incident.log` somewhere off the server. Change nothing else until that is done.
3. **Find the scope.** Which tenants, which records, since when. `asp log verify` says whether the chain is intact; the usage listing and the journal say who did what.
4. **Rotate secrets** that may have been exposed: the Google client secret (`/etc/asp/asp.env`, then rerun the setup script, see deploy/README.md), the mail key, and any admin token in the tokens file (remove the tenant's entry and make a new one with `asp serve token --tokens ... --tenant <name> --role admin`). A tenant's own token is replaced by the person through `/join/recover`.
5. **Tell people.** The privacy notice and the terms say what the operator owes users when their data was involved: say what happened, what was affected and what they should do, to the contact address each gave and on the site. A report from outside arrives through the repository's private vulnerability reporting; acknowledge it, fix it, say so.
6. **Afterwards.** Write what happened and what changed in docs/live-run-checklist.md style (what, when, what found, what fixed), add a gap row for anything the incident showed was missing, and add a test where the bug was code.

**Not yet:** a city-wide emergency stop with an expiry, a published incident log of operator acts, and a written succession plan if the operator is unavailable (GV6, GV9). Until they exist, section 2 and section 3 are the whole emergency toolkit, and the site says the operator is one person.

## 5. Restore from a backup

The nightly job (`/usr/local/bin/asp-backup`, 02:17) writes a database dump and a tarball of the files (`tokens.json packages runlogs commons known-bad forum`) to `/var/backups/asp`, kept 35 days. Take a Google Cloud disk snapshot on a schedule as well.

**Prove it works before you need it.** [deploy/restore-drill.sh](deploy/restore-drill.sh) restores the newest dump into a scratch database, starts a throwaway copy of the service on port 18787 with its own token file, runs `asp log verify` against it, prints the record count and head, and removes everything it made. It does not touch the live database. Run it once now and after any change to the backup job:

```
sudo bash /opt/asp/docs/deploy/restore-drill.sh
```

A passing drill ends `DRILL PASSED`. Record the date, the backup file and the output line in docs/live-run-checklist.md. **This drill has been written and checked for syntax; it has not been run against the production server.** That run is the gate item.

**To actually restore** (the live database is lost or damaged): stop the service (`systemctl stop asp-log`), keep the damaged database aside (`ALTER DATABASE asp RENAME TO asp_damaged_<date>`), create an empty `asp` owned by the `asp` role, load the newest dump the way the drill does (`gunzip -c <file> | sudo -u postgres psql -d asp`), unpack the files tarball into `/var/lib/asp`, start the service, and run `asp log verify`. What was written after the backup is lost from the log: say so to users, and ask clients to resend (a person's own run logs and package history are on their machines and can be re-reported).

## 6. Routine

| When | Do |
|---|---|
| Daily | the checks in section 1; the court's docket if the beta has disputes (`asp court docket`) |
| Weekly | `asp serve purge` (closed accounts past retention); read the sign-up demand count and set the daily cap from it |
| Monthly | the restore drill; apply updates by rerunning the setup script (it updates the code and restarts the service and does not recreate the database or secrets) |
| After any change to the backup job | the restore drill |
