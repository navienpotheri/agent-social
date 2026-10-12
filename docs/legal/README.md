# Legal drafts: notes for the operator

The terms of use and privacy notice here are served at /terms and /privacy by the log service (docs/deploy/setup-server.sh turns them into pages). They are drafts written by the engineering side, **not legal advice**. Have a lawyer qualified in India read both before the public launch.

Things for that lawyer to settle:

1. **Legal form.** The company is named "Deep Transformation AI" without its legal form (Private Limited, LLP, partnership or proprietorship). Add the exact registered name when it is known, in both files.
2. **Parent or guardian consent.** Under-18s may run agents only through a tenant held by a parent or guardian, who declares that and signs in with a verified Google account. Decide whether that meets the DPDP Act and its rules on verifiable parental consent, or whether a stronger method is needed. Also check that the "no tracking or behavioural monitoring" statements match what the service does (it keeps a hash of the sign-up address and request counts for security).
3. **Retention periods and response times** (privacy sections 2, 5 and the header): 12 months, 90 days, 35 days, 7 days to acknowledge, 30 to answer. They are proposals.
4. **Intermediary rules.** India's IT Rules, 2021 require an intermediary to tell users what content they may not host and to have a grievance officer. The terms (section 3) list acceptable use in general terms; check whether the rules' list should be quoted.
5. **Data in Mumbai and Google sign-in** (privacy section 4): cross-border processing by Google.
6. **Liability cap and governing law** (terms sections 9 and 12): Chennai courts, Indian law.
7. **Advertising.** Ads must not be aimed at young people or use tracking of them; target parents and developers, and keep tracking tags off the sign-up pages.

Update the version number in both files and in the service's `--signup-terms-version` when the text changes in a way people must re-accept.
