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

## 3. A backup bucket in your own account (45 minutes)

Why: `/var/backups/asp` is on the machine that fails. The retention rule (docs/legal/retention-and-erasure.md) says backups clear within 35 days, so the bucket's lifecycle says the same (30 days for live objects, 5 for non-current ones).

**What is already done (yours, 2026-11-22).** The bucket `gs://agent-social-511217-asp-backups` exists in ASIA-SOUTH2 with versioning on, public access prevention enforced and a lifecycle of 30 days for live objects and 5 days for non-current ones (35 days in all, as the retention rule says). The service account `asp-backup-writer@agent-social-511217.iam.gserviceaccount.com` has a custom role (`aspBackupWriter`: `storage.objects.create`, `storage.objects.list`, `storage.buckets.get`) on that bucket only, and its key is on the server at `/etc/asp-backup/key.json` (root, mode 600). The server's own scope is read-only for storage, so that key is the only way for the server to write to the bucket.

**Why `age`, and not a passphrase on the server.** A backup that the server encrypts with a passphrase needs the passphrase on the server, which defeats the point. With `age` the server holds only your **public** key (`/etc/asp-backup/age-recipient.txt`, one line starting `age1`), so it can encrypt and can never decrypt: the **private** key is yours, in your password manager, and is never on the server. The copy script refuses to run if that file holds a private key.

The exact commands, in order, are step 3 of [deployment-plan.md](deployment-plan.md) (and of [deployment-walkthrough.md](deployment-walkthrough.md)); the script is `docs/deploy/backup-offsite.sh`, tested in `packages/asp-cli/test/backup-offsite.test.ts`. In short:

1. Make an `age` key pair on your own machine; the private key goes into your password manager and nowhere else.
2. On the server, install `age` and `rclone`, write `/etc/asp-backup/rclone.conf` (the service account's key is already at `/etc/asp-backup/key.json`) and the public key into `/etc/asp-backup/age-recipient.txt`.
3. Install `docs/deploy/backup-offsite.sh` as `/usr/local/bin/asp-backup-offsite` and add it as the last line of `/usr/local/bin/asp-backup`, so that the job fails (non-zero exit) if the offsite copy fails.
4. **Check that passes:** the restore drill (`docs/deploy/restore-drill.sh`) run on a file that you fetched from the bucket with your own read access and decrypted with the private key, ending `DRILL PASSED`. Record the date and the object name.

**What the monitor does not see.** The monitor's check "Last night's backup is there" reads `/var/backups/asp` only, so it does not see the offsite copy. If the offsite copy fails, `asp-backup` exits non-zero and says why on standard error (read it in the system log with `journalctl -t CRON`), but the monitor stays green until a check for the offsite copy is built (register row DK1804). Until then, look at the bucket's listing once a week.

## What I need from you

The three account names you want used (the monitor service, the cloud provider and region, the domain), and a yes to each section. I will then write the exact unit files and the one-line rclone configs for those names; I will not create any account myself.
