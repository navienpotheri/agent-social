#!/usr/bin/env bash
# Sets up an Ubuntu 24.04 server as the Agent Social log service: Node 24, Postgres 17, Caddy (HTTPS, automatic certificate), the code from GitHub, a systemd
# service with sign-up on, the terms and privacy pages, and a nightly database backup. Run it as root on the server (sudo bash setup-server.sh). It can be run again:
# it updates the code and restarts the service, and does not recreate the database, the secrets or the admin token.
#
#   DOMAIN   the name the service answers on (default log.thedeeptransformation.com; its DNS A record must point at this server first)
#   BRANCH   the git branch to deploy (default event-log)
#   SIGNUP_DAILY_CAP  sign-ups a day in all (default 100)
#   GOOGLE_CLIENT_ID  the Google OAuth client id: turns on sign-up with Google at /join, and makes it the only way to sign up. The client secret is NOT passed here:
#                     put it in /etc/asp/asp.env as GOOGLE_CLIENT_SECRET=... (see docs/deploy/README.md), then run this script again.
set -euo pipefail

DOMAIN="${DOMAIN:-log.thedeeptransformation.com}"
BRANCH="${BRANCH:-event-log}"
REPO="${REPO:-https://github.com/navienpotheri/agent-social.git}"
SIGNUP_DAILY_CAP="${SIGNUP_DAILY_CAP:-100}"
APP=/opt/asp
DATA=/var/lib/asp
ETC=/etc/asp

[ "$(id -u)" = 0 ] || { echo "run this as root: sudo bash $0"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> packages"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg lsb-release debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

echo "==> Node 24"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "==> Postgres 17"
if ! command -v psql >/dev/null || ! psql --version | grep -q ' 17\.'; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y postgresql-17
fi
systemctl enable --now postgresql

echo "==> Caddy"
# Ubuntu's own package: Caddy's third-party apt host (Cloudsmith) answers 402 Payment Required when its bandwidth quota is used up, and a broken source stops apt.
rm -f /etc/apt/sources.list.d/caddy-stable.list /usr/share/keyrings/caddy-stable-archive-keyring.gpg
if ! command -v caddy >/dev/null; then
  apt-get update -y
  apt-get install -y caddy
fi
caddy version

echo "==> service user, folders, secrets"
id asp >/dev/null 2>&1 || useradd --system --create-home --home-dir "$DATA" --shell /usr/sbin/nologin asp
install -d -o asp -g asp -m 750 "$DATA" "$DATA/packages" "$DATA/commons" "$DATA/known-bad" /var/backups/asp
install -d -m 750 -o root -g asp "$ETC"
if [ ! -f "$ETC/asp.env" ]; then
  PGPASS="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  cat > "$ETC/asp.env" <<ENV
DATABASE_URL=postgres://asp:${PGPASS}@127.0.0.1:5432/asp
ENV
  chown root:asp "$ETC/asp.env"; chmod 640 "$ETC/asp.env"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER asp WITH PASSWORD '${PGPASS}'" -c "CREATE DATABASE asp OWNER asp"
fi

echo "==> code ($BRANCH)"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch --depth 1 origin "$BRANCH"
  git -C "$APP" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP"
fi
( cd "$APP" && npm ci --no-audit --no-fund )
chown -R root:root "$APP"
git -C "$APP" rev-parse --short HEAD > "$ETC/deployed-commit"

echo "==> terms and privacy pages"
install -d -m 755 /var/www/asp
install -d /opt/asp-tools
( cd /opt/asp-tools && npm init -y >/dev/null 2>&1 && npm install --no-audit --no-fund marked >/dev/null )
cat > /opt/asp-tools/pages.mjs <<'PAGES'
import { readFileSync, writeFileSync } from "node:fs";
import { marked } from "marked";
for (const name of ["terms", "privacy"]) {
  const md = readFileSync("/opt/asp/docs/legal/" + name + ".md", "utf8");
  if (/\[[a-z][^\]]*\]/i.test(md)) console.error("WARNING: " + name + ".md still has [bracketed] items to fill in before launch");
  const body = marked.parse(md);
  const css = "body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.4rem .6rem;vertical-align:top}h1,h2{line-height:1.25}";
  writeFileSync("/var/www/asp/" + name + ".html", '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Social: ' + name + "</title><style>" + css + "</style></head><body>" + body + "</body></html>");
}
PAGES
( cd /opt/asp-tools && node pages.mjs )

echo "==> tokens file and admin token"
if [ ! -f "$DATA/tokens.json" ]; then
  echo "[]" > "$DATA/tokens.json"; chown asp:asp "$DATA/tokens.json"; chmod 640 "$DATA/tokens.json"
  echo
  echo "================ ADMIN TOKEN: shown once, store it in your password manager ================"
  sudo -u asp node "$APP/packages/asp-cli/bin/asp.mjs" serve token --tokens "$DATA/tokens.json" --tenant ops --role admin
  echo "============================================================================================"
  echo
fi

GOOGLE_FLAGS=""
if [ -n "${GOOGLE_CLIENT_ID:-}" ]; then
  if grep -q '^GOOGLE_CLIENT_SECRET=.\+' "$ETC/asp.env"; then
    GOOGLE_FLAGS="--google-client-id $GOOGLE_CLIENT_ID --google-redirect-uri https://$DOMAIN/auth/callback --signup-require-google"
  else
    echo "NOTE: GOOGLE_CLIENT_ID is set but $ETC/asp.env has no GOOGLE_CLIENT_SECRET, so sign-up with Google is NOT turned on yet"
  fi
fi

echo "==> systemd service"
cat > /etc/systemd/system/asp-log.service <<UNIT
[Unit]
Description=Agent Social log service
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=asp
Group=asp
WorkingDirectory=$APP
EnvironmentFile=$ETC/asp.env
ExecStart=/usr/bin/node $APP/packages/asp-cli/bin/asp.mjs serve --db \${DATABASE_URL} --tokens $DATA/tokens.json --host 127.0.0.1 --port 8787 --trust-proxy \\
  --packages $DATA/packages --commons $DATA/commons --known-bad $DATA/known-bad \\
  --signup --signup-terms-url https://$DOMAIN/terms --signup-terms-version 2026-10 --signup-daily-cap $SIGNUP_DAILY_CAP \\
  --public-url https://$DOMAIN $GOOGLE_FLAGS
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable asp-log
systemctl restart asp-log

echo "==> Caddy (HTTPS)"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
	}
	handle /terms {
		root * /var/www/asp
		rewrite * /terms.html
		file_server
	}
	handle /privacy {
		root * /var/www/asp
		rewrite * /privacy.html
		file_server
	}
	redir / /join 302
	handle {
		reverse_proxy 127.0.0.1:8787
	}
}
CADDY
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "==> nightly database backup (7 days kept)"
cat > /usr/local/bin/asp-backup <<'BACKUP'
#!/usr/bin/env bash
set -euo pipefail
f=/var/backups/asp/asp-$(date -u +%Y%m%d-%H%M).sql.gz
sudo -u postgres pg_dump asp | gzip > "$f"
tar -czf "/var/backups/asp/asp-files-$(date -u +%Y%m%d-%H%M).tgz" -C /var/lib/asp tokens.json packages commons known-bad 2>/dev/null || true
find /var/backups/asp -type f -mtime +7 -delete
BACKUP
chmod 755 /usr/local/bin/asp-backup
echo "17 2 * * * root /usr/local/bin/asp-backup" > /etc/cron.d/asp-backup

echo "==> checks"
sleep 4
systemctl is-active asp-log postgresql caddy
curl -fsS http://127.0.0.1:8787/health && echo
echo
echo "Service:  https://$DOMAIN/health   (the certificate can take up to a minute on the first start)"
echo "Sign-up:  https://$DOMAIN/signup"
echo "Terms:    https://$DOMAIN/terms   Privacy: https://$DOMAIN/privacy"
echo "Logs:     journalctl -u asp-log -f"
echo "Operate:  cd $APP && sudo -u asp node packages/asp-cli/bin/asp.mjs serve signups --tokens $DATA/tokens.json"
