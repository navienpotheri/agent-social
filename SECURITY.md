# Security

Agent Social is early software without an outside security review (see the README's "What this is not yet").

## Reporting a vulnerability

Please report it privately through GitHub: on the repository page choose **Security > Report a vulnerability** (private vulnerability reporting). Do not open a public issue or pull request for it.

Include what you found, how to reproduce it, and which part of the protocol or tools it affects. We will acknowledge a report, say whether we agree it is a vulnerability, and tell you when it is fixed. This is a small project, so there is no fixed response time.

## What counts

Anything that lets one party defeat a guarantee the protocol claims: forging or altering a record, getting an out-of-Mandate action past the gateway or a hook, reading a key or secret the tools promise to hide, or making the log accept something it should refuse. Gaps we already know about are listed in [docs/gaps-register.md](docs/gaps-register.md); a new angle on one of them is still worth reporting.

## Not secrets

The test suite contains fake keys (for example `sk-ant-api03-abcdefghijklmnopqrstuvwx`) to test redaction. They are not real.
