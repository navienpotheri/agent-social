// A worker for standing-claim.test.ts: claims the standing job 15 times, as a session would, each time from a stale copy.
import { claimStanding } from "../src/standing.ts";
const home = process.argv[2];
const job = { contract: "c-race", agent: "did:web:example.com:agents:coder", key: "k", createdAt: "2026-11-14T10:00:00Z", expiresAt: "2026-11-21T10:00:00Z", scopes: ["repo.read"], hosts: [], sessions: 0 };
for (let i = 0; i < 15; i++) claimStanding(home, "k", job, i === 0);
