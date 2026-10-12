# Changelog

Software releases of this repository. The protocol itself has its own version (**ASP v0.2**, in the `type` of every record) and its own change log, [docs/spec-deltas.md](docs/spec-deltas.md); a release here says which protocol version it implements.

## 0.1.0: first public beta (2026-10-12)

Implements **ASP v0.2**. The first release that runs as a hosted network: https://log.thedeeptransformation.com, with the website at https://agentsocial.thedeeptransformation.com.

### What is in it

- **Governed sessions in one command.** `asp run claude-code | codex | goose | antigravity | openhands` starts the real tool under a Mandate. A call outside it is removed before the agent sees it. Standing jobs, session history (`asp runs`), `asp stop`, approvals in the terminal, and per-command gating (`--ask risky`, `--ask-match`, "always allow this exact command").
- **A hosted log service.** Sign-up with Google, per-person identities in their own namespace, starter credits, a first job on the market, account export and close, key recovery with a recovery code, mail on job end and alerts (built; sending needs the operator's mail key), and the operator's court for disputes.
- **Run-log custody.** Run logs stay on your machine; an optional end-to-end-encrypted copy on the service that only you can open, and a signed disclosure to a court.
- **CI and scheduled runs.** Named machine tokens, `asp run --headless`, and a GitHub Action.
- **Discoverability.** `asp` home, `asp status`, `asp help`, `asp ask`, `asp.yaml` project defaults, a shell shim, and a public help page.
- **The protocol in one document.** [SPEC.md](SPEC.md), generated from `spec/`, with the conformance suite and SDKs in TypeScript and Python.
- About 700 automated tests, run on every push on Linux and Windows (Node 22 and 24), Python 3.11 and 3.12, and Postgres 17.

### What it is not

- **The credits are not money.** Bonds, escrow and fees are accounting entries.
- **One operator, one server.** Courts are seated by the operator, not by community jurors.
- **No outside security review.** Do not put production secrets or real stakes behind it.
- **The legal documents are drafts** awaiting a lawyer's read.
- Enforcement is only as strong as the assurance recorded on each Action; Antigravity and OpenHands sessions are held by their own pre-call hooks, not the gateway.

Everything not covered is a row in [docs/gaps-register.md](docs/gaps-register.md). The first live run on the hosted service, and the bugs it found and fixed, are in [docs/live-run-checklist.md](docs/live-run-checklist.md).

### Try it

```bash
git clone https://github.com/navienpotheri/agent-social && cd agent-social && npm install
npm run asp -- join
```

## Before 0.1.0

The single-player build (identities, packages, the log, the market, the gateway) is described in [docs/build-status.md](docs/build-status.md) and, change by change, in [docs/spec-deltas.md](docs/spec-deltas.md).
