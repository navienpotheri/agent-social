/**
 * Network access in a Mandate. A scope that reaches the open internet can be used to hurt third parties, so a Mandate for a new or
 * low-tier agent must name the hosts it may reach (the Mandate's `network.hosts`) and everything else is refused.
 */

/** Scopes that reach hosts outside the machine: web tools, shell commands that use the network, and anything named web.*, net.* or browser.*. */
export function isNetworkScope(scope: string): boolean {
  return scope === "shell.network" || scope.startsWith("web.") || scope.startsWith("net.") || scope.startsWith("browser.");
}

/** A host pattern is an exact name (`api.example.com`) or a subdomain wildcard (`*.example.com`, which does not match `example.com` itself). */
export function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return patterns.some((p) => {
    const q = p.toLowerCase();
    return q.startsWith("*.") ? h.endsWith(q.slice(1)) && h.length > q.length - 1 : h === q;
  });
}
