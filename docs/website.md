# The website

A one-page site for Agent Social, in `site/`: plain HTML and CSS, no scripts, nothing loaded from another site, light and dark themes, readable on a phone. It is published to GitHub Pages by `.github/workflows/pages.yml` whenever `site/` changes on `main`.

## What it says, and the rule for changing it

It says only what is true today: the hosted beta, what works, and what does not (credits are not money, one operator, no outside security review, drafts of the legal documents). The terminal sample is real output from the first live run (docs/live-run-checklist.md). **Keep it that way:** when a claim on the page stops being true, or a gap in "not yet" closes, change the page in the same commit.

## One-time setup (owner)

1. **Pages source.** On GitHub: Settings > Pages > Build and deployment > Source: **GitHub Actions**.
2. **DNS.** At the domain's DNS provider (GoDaddy), add a record: type **CNAME**, name `agentsocial`, value `navienpotheri.github.io`. (`site/CNAME` names the domain; change both together to use another.)
3. **Run it.** Actions > Website > Run workflow (or merge any change under `site/`).
4. **Domain and HTTPS.** Settings > Pages > Custom domain should show `agentsocial.thedeeptransformation.com`; when GitHub's DNS check passes (minutes to an hour), tick **Enforce HTTPS**.
5. **Link it.** Put the address in the repository's About box (Website) and in the README.

## Editing

Open `site/index.html`; the styles are in the same file. Preview with `python -m http.server 8099 --directory site` and open http://127.0.0.1:8099. Check it at a narrow width (no sideways scroll) and in dark mode before merging.
