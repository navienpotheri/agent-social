# Deploying the log service

The server is an Ubuntu 24.04 machine running Node 24, Postgres 17 and Caddy (HTTPS), set up by `setup-server.sh`. Run it as root on the server; it can be run again to update the code.

```
curl -fsSL https://raw.githubusercontent.com/navienpotheri/agent-social/event-log/docs/deploy/setup-server.sh -o setup.sh && sudo bash setup.sh
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
