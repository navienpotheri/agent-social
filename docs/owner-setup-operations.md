# Owner setup: an outside monitor, a status page host and an off-machine backup bucket (a proposal for you to approve)

**Status: a proposal. Nothing here is set up, and no page, README line or mail may say it is until each step's check below has passed and been recorded in docs/live-run-checklist.md (DK1341, DK293).** It needs your accounts, so it is written as steps for you, in the order to do them. Credits and every figure in this repository are mock accounting entries; the only money here is what the cloud provider charges your account, which the steps keep to a few dollars a month (check your provider's price list: no price is stated here because none was measured).

What exists already (built, tested on stand-ins, not yet pointed at your accounts): `asp monitor check|run` (up, the credit ledger balances, society health alarms quiet, last night's backup is there, the company compute ceiling), the status page as two static files the monitor writes, the nightly `asp-backup` job that keeps 35 days on the server's own disk, and the restore drill (docs/operator-runbook.md section 5). What is missing is what survives the server: a monitor that is not on the server, a status page that is up when the server is down, and a copy of the backup somewhere else.

## 1. An outside uptime monitor (10 minutes)

Why: a monitor running on the same machine goes down with it.

1. Pick any hosted uptime checker that can call a URL every minute and message you (UptimeRobot, Better Stack, a cloud provider's own). Make an account with an address you read on your phone.
2. Add an HTTPS check on `https://<your service host>/health` (it answers `{"ok":true}`) every 1 minute, alert after 2 failures, to your phone and email.
3. Add a second check on `https://<your service host>/economy/supply` (public, shows the credit supply audit) every 5 minutes, expecting an answer 200.
4. **Check that passes:** stop the service on purpose for three minutes (`sudo systemctl stop asp-log`), see the alert arrive, start it, see the recovery message. Write the date in docs/live-run-checklist.md. Nothing may be claimed before this.

## 2. A status page that survives the server (20 minutes)

Why: the monitor already writes `/status` and `/status.json` as static files, but they are served by the same Caddy, so they vanish in an outage.

1. Create a storage bucket for static files at your cloud provider (public read for this one bucket only, no write for the public), and put it behind a CDN or the provider's static-website host on a name such as `status.<your domain>` (one CNAME record).
2. Give the monitor a credential that can write only to this bucket (not your account).
3. On the server, after each `asp monitor run` pass, copy the two files to the bucket (`rclone copy <the folder the monitor writes the two files to> status:<bucket>` with an rclone remote set up with that credential; the folder is the one given to `asp monitor run`; add it to the monitor's systemd unit as `ExecStartPost` or run it from a one-line timer every minute).
4. **Check that passes:** open `https://status.<your domain>/status` with the service stopped for three minutes: it shows the outage, and after recovery shows it recovered. Record the date.

## 3. A backup bucket in your own account (30 minutes)

Why: `/var/backups/asp` is on the machine that fails. The retention rule (docs/legal/retention-and-erasure.md) says backups clear within 35 days, so the bucket's lifecycle must say the same.

1. Create a private bucket in a region you choose, versioning on, public access blocked, **lifecycle: delete versions older than 35 days**.
2. Create a credential that can only write and list this bucket (not read old objects, not delete, not touch anything else). Keep the read credential for yourself, in your password manager, never on the server.
3. On the server, add a step at the end of `/usr/local/bin/asp-backup`: copy the day's two files to the bucket (`rclone copy /var/backups/asp/ backup:<bucket> --max-age 26h`) and fail the job if the copy fails, so the monitor's "last night's backup is there" check turns red.
4. **Encrypt before it leaves the machine:** use rclone's `crypt` remote with a passphrase that is stored with the read credential and not on the server, so the provider holds ciphertext only (the backup holds every tenant's records and packages).
5. **Check that passes:** the restore drill (`deploy/restore-drill.sh`) run against a file fetched from the bucket with your read credential, ending `DRILL PASSED`. Record the date and the object name.

## What I need from you

The three account names you want used (the monitor service, the cloud provider and region, the domain), and a yes to each section. I will then write the exact unit files and the one-line rclone configs for those names; I will not create any account myself.
