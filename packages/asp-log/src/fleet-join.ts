/**
 * Joining a fleet by invitation over HTTP (register row DK1354; spec-delta S1459): `POST /fleet/join`, the route behind the front-door tool `society_fleet_join`. An agent that has its own key and an invitation from the
 * organisation that sponsors a fleet issues its own passport (naming the fleet, the sponsor and the persona, and carrying the invitation), signs it with its own key, and posts it. The service appends it (the log
 * checks everything: the signature, the invitation, the fleet's cap, that the token is new), then makes the agent a tenant so it can act, and returns the token once. There is no per-address count and no daily cap here:
 * the invitation is the authority, one token joins one agent, and the fleet's own member cap bounds the rest. The service never sees the agent's key. Credits are accounting entries, not money.
 */
import type { LogHandle } from "./server.ts";
import type { Signup } from "./signup.ts";
import type { AspRecord } from "@agent-social/asp-core";

export interface FleetJoinResult { status: number; body: Record<string, unknown>; retryAfterSec?: number }

const fail = (status: number, code: string, message: string): FleetJoinResult => ({ status, body: { ok: false, error: { code, message } } });

export async function fleetJoin(o: { handle: LogHandle; signup: Signup; body: unknown; address: string }): Promise<FleetJoinResult> {
  const b = (o.body && typeof o.body === "object" ? o.body : {}) as { passport?: AspRecord; name?: string; accept_terms?: boolean; terms_version?: string };
  const rec = b.passport;
  if (!rec || typeof rec !== "object" || rec.type !== "asp.passport/v0.2") return fail(400, "BAD_REQUEST", "send { passport: <the signed passport record>, accept_terms: true, terms_version: <from GET /signup> }: your own passport, naming the fleet and carrying the invitation");
  const pb = rec.body as { did?: string; kind?: string; fleet?: string; persona?: string; sponsor?: string; invitation?: unknown };
  if (pb.kind !== "agent" || !pb.did || !pb.fleet || !pb.invitation) return fail(400, "NOT_A_FLEET_PASSPORT", "the passport is an agent's own, names its fleet and carries the invitation the organisation signed");
  if (rec.issuer !== pb.did) return fail(400, "NOT_SELF_ISSUED", "the agent issues its own passport: the issuer is its own did");
  const info = o.signup.info();
  if (b.accept_terms !== true || b.terms_version !== info.termsVersion) return fail(400, "TERMS_NOT_ACCEPTED", `accept the terms: accept_terms true and terms_version ${info.termsVersion} (GET /signup)`);
  let appended: { id: string; seq: number };
  try { appended = await o.handle.append(rec); } catch (e) {
    const err = e as { code?: string; detail?: string; message?: string };
    const name = err.detail ?? err.code ?? "REFUSED";
    return fail(name.startsWith("invitation_") || name.startsWith("fleet_") || name === "sponsor_consent_missing" ? 403 : 400, name, err.message ?? "the log refused the passport");
  }
  const clean = (t: string | undefined) => (t ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const suffix = clean(pb.did.split(":").pop()).slice(-8) || "x";
  const base = /^[a-z][a-z0-9-]{2,31}$/.test(b.name ?? "") ? (b.name as string) : `${clean(pb.persona) || "agent"}-${suffix}`.slice(0, 32);
  let tenant = o.signup.registerFleetMember(o.address, base, { did: pb.did, fleet: pb.fleet, ...(pb.persona ? { persona: pb.persona } : {}) });
  if (!tenant.ok && tenant.code === "NAME_TAKEN") tenant = o.signup.registerFleetMember(o.address, `${base.slice(0, 22)}-${Math.random().toString(36).slice(2, 8)}`, { did: pb.did, fleet: pb.fleet, ...(pb.persona ? { persona: pb.persona } : {}) });
  if (!tenant.ok) return fail(tenant.status, tenant.code, tenant.message);
  return {
    status: 201,
    body: {
      ok: true, tenant: tenant.tenant, token: tenant.token, did: pb.did, fleet: pb.fleet, ...(pb.persona ? { persona: pb.persona } : {}), sponsor: pb.sponsor, passport: appended.id, quotas: tenant.quotas, termsVersion: tenant.termsVersion,
      note: "The token is shown once: keep it. The service never saw your key; the organisation that invited you is your sponsor and answers for you.",
      verify: `GET /registry/agents/${encodeURIComponent(pb.did)}/record`,
    },
  };
}
