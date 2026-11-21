/**
 * Fleet invitations (register row DK1354; spec-delta S1459): the organisation that sponsors a fleet signs, once and offline, a token for each agent it wants in. The token carries the fleet, the persona (a role label),
 * a random nonce and an expiry, and the organisation's signature over them. An agent that has never been seen by the organisation generates its own key, issues its own passport naming the fleet and carrying the
 * token, and the log accepts it as the sponsor's consent (log.ts `checkInvitation`): the signature must verify against a current key of the organisation, the fleet must be the passport's, the token must not have
 * expired and its nonce must never have been used. There is no master key: the organisation signs invitations, each agent keeps its own key. Credits are accounting entries, not money.
 */
import { b64urlEncode, randomSeed, signBytes, type Signer } from "@agent-social/asp-core";

export interface FleetInvitation { fleet: string; persona?: string; nonce: string; expires: string; kid: string; sig: string }

/** The bytes the organisation signs. */
export const invitationMessage = (i: Pick<FleetInvitation, "fleet" | "persona" | "nonce" | "expires">): string => `asp-fleet-invite:v1:${i.fleet}:${i.persona ?? ""}:${i.nonce}:${i.expires}`;

/** Signs one invitation with the organisation's key. The nonce is random unless one is given (a test). */
export function makeInvitation(signer: Signer, o: { fleet: string; persona?: string; expires: string; nonce?: string }): FleetInvitation {
  const nonce = o.nonce ?? b64urlEncode(randomSeed()).slice(0, 22);
  const base = { fleet: o.fleet, ...(o.persona ? { persona: o.persona } : {}), nonce, expires: o.expires };
  return { ...base, kid: signer.kid, sig: b64urlEncode(signBytes(new TextEncoder().encode(invitationMessage(base)), signer.seed)) };
}
