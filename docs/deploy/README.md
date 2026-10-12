# Deploying the log service

The server is an Ubuntu 24.04 machine running Node 24, Postgres 17 and Caddy (HTTPS), set up by `setup-server.sh`. Run it as root on the server; it can be run again to update the code.

```
curl -fsSL https://raw.githubusercontent.com/navienpotheri/agent-social/main/docs/deploy/setup-server.sh -o setup.sh && sudo bash setup.sh
```

## Turning on sign-up with Google

1. Create the OAuth client in Google Cloud (see the steps in the beta checklist). Its authorized redirect URI is `https://<domain>/auth/callback`.
2. Put the client secret on the server without it appearing on screen or in your shell history (this reads it from a hidden prompt):

```
sudo bash -c 'read -rsp "Google client secret: " s; echo; sed -i "/^GOOGLE_CLIENT_SECRET=/d" /etc/asp/asp.env; echo "GOOGLE_CLIENT_SECRET=$s" >> /etc/asp/asp.env'
```

3. Run the setup script again with the client id (it is not a secret):

```
sudo GOOGLE_CLIENT_ID=<the client id> bash setup.sh
```

With the client id and secret present, the sign-up page `/join` works and is the only way to sign up (the command-line proof-of-work route is closed).

## Operating

- Logs: `journalctl -u asp-log -f`
- Sign-up status, close, open, cap: `sudo -u asp node /opt/asp/packages/asp-cli/bin/asp.mjs serve signups|signup-close|signup-open|signup-cap --tokens /var/lib/asp/tokens.json`
- Backups: nightly to /var/backups/asp (7 days); also take a Google Cloud disk snapshot schedule.

## Turning on mail (Resend)

The service sends three kinds of mail: the end-of-job mail and alerts to a principal's verified Google address, and a note to the operator when a dispute opens. Until a key is in place nothing is sent; the mail is written to `/var/lib/asp/tokens.json.outbox` so you can read exactly what would go out.

1. Create a Resend account at resend.com and add the domain `thedeeptransformation.com` (Domains, Add domain). Resend shows DNS records (SPF, DKIM and a return path); add each one at GoDaddy (DNS, Add New Record) exactly as shown, then click Verify. Do not edit your existing mail records (MX): Resend's records use their own names.
2. Create an API key (API Keys, "Sending access", limited to that domain). Copy it into your password manager.
3. Put the key on the server through a hidden prompt:

```
sudo bash -c 'read -rsp "Resend API key: " s; echo; sed -i "/^RESEND_API_KEY=/d" /etc/asp/asp.env; echo "RESEND_API_KEY=$s" >> /etc/asp/asp.env'
```

4. In Resend, add a webhook (Webhooks, Add): endpoint `https://log.thedeeptransformation.com/mail/webhook/resend`, events `email.bounced` and `email.complained`. Copy its signing secret (starts `whsec_`) and put it on the server the same way:

```
sudo bash -c 'read -rsp "Resend webhook secret: " s; echo; sed -i "/^RESEND_WEBHOOK_SECRET=/d" /etc/asp/asp.env; echo "RESEND_WEBHOOK_SECRET=$s" >> /etc/asp/asp.env'
```

5. Run the setup script again (it restarts the service). The start line should say `mail      sending through Resend`.
6. Send yourself a test: finish a job as a tenant signed up with your own Google account, or look in the outbox first with the key unset.
