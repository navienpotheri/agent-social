def edit(p, pairs):
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf8').write(s)

# fleets.ts: persona and node on members and on the mark
edit('packages/asp-log/src/fleets.ts', [
    ('export interface FleetMark { id: string; name: string }', 'export interface FleetMark { id: string; name: string; /** The persona the agent plays in the fleet (its passport\'s `persona`), when it has one (DK1353, DK1366). */ persona?: string }'),
    ('export interface FleetMember { did: string; name: string; joined: string; house: boolean }', 'export interface FleetMember { did: string; name: string; joined: string; house: boolean; persona: string | null; node: string | null }'),
    ('const NOT_YET = ["personas (a role such as developer or project manager within a fleet): DK1353, DK1366", "the fleet\'s spending caps and freeze switch: DK1361"];', 'const NOT_YET: string[] = [];'),
    ('  const latestPassport = new Map<string, { fleet?: string; joined: string; house: boolean }>();', '  const latestPassport = new Map<string, { fleet?: string; joined: string; house: boolean; persona?: string; node?: string }>();\n  const moved = new Map<string, string>();'),
    ('      const b = s.record.body as { did: string; kind: string; fleet?: string; house?: boolean };\n      if (b.kind !== "agent") continue;\n      if (!firstSeen.has(b.did)) firstSeen.set(b.did, s.record.issued_at);\n      latestPassport.set(b.did, { ...(b.fleet ? { fleet: b.fleet } : {}), joined: firstSeen.get(b.did)!, house: !!b.house });\n    }',
     '      const b = s.record.body as { did: string; kind: string; fleet?: string; house?: boolean; persona?: string; node?: string };\n      if (b.kind !== "agent") continue;\n      if (!firstSeen.has(b.did)) firstSeen.set(b.did, s.record.issued_at);\n      latestPassport.set(b.did, { ...(b.fleet ? { fleet: b.fleet } : {}), joined: firstSeen.get(b.did)!, house: !!b.house, ...(b.persona ? { persona: b.persona } : {}), ...(b.node ? { node: b.node } : {}) });\n      moved.delete(b.did);\n    } else if (s.record.type === T("fleet_move")) { const b = s.record.body as { member: string; to: string }; moved.set(b.member, b.to); }'),
    ('    byAgent.set(did, { id: p.fleet, name });', '    byAgent.set(did, { id: p.fleet, name, ...(p.persona ? { persona: p.persona } : {}) });'),
    ('    list.push({ did, name: fleetNameOf(did), joined: p.joined, house: p.house });', '    list.push({ did, name: fleetNameOf(did), joined: p.joined, house: p.house, persona: p.persona ?? null, node: moved.get(did) ?? p.node ?? null });'),
])

# ui-kit: the badge shows the persona
edit('packages/asp-log/src/ui-kit.ts', [
    ('export const fleetBadge = (m: { id: string; name: string }): string => `<a class="fleet" href="/society/fleets/${encodeURIComponent(m.id)}" title="${esc(`A member of the fleet ${m.name}`)}">fleet: ${esc(m.name.length > 24 ? `${m.name.slice(0, 23)}\\u2026` : m.name)}</a>`;',
     'export const fleetBadge = (m: { id: string; name: string; persona?: string }): string => `<a class="fleet" href="/society/fleets/${encodeURIComponent(m.id)}" title="${esc(`A member of the fleet ${m.name}${m.persona ? `, playing the persona ${m.persona}` : ""}`)}">fleet: ${esc(m.name.length > 24 ? `${m.name.slice(0, 23)}\\u2026` : m.name)}${m.persona ? ` &middot; ${esc(m.persona)}` : ""}</a>`;'),
])

# types that carry the mark
edit('packages/asp-log/src/journey.ts', [('  fleet?: { id: string; name: string };', '  fleet?: { id: string; name: string; persona?: string };')])
edit('packages/asp-log/src/society-map.ts', [('fleet?: { id: string; name: string }; /** The fleet', 'fleet?: { id: string; name: string; persona?: string }; /** The fleet') if False else ('/** The fleet the agent belongs to (DK1367): its mark, so the map can stand it in the fleet\'s district. */ fleet?: { id: string; name: string };', '/** The fleet the agent belongs to (DK1367): its mark, so the map can stand it in the fleet\'s district. */ fleet?: { id: string; name: string; persona?: string };')])
edit('packages/asp-log/src/society-story.ts', [('/** The fleet of the agent in this row (DK1367). */ fleet?: { id: string; name: string } }', '/** The fleet of the agent in this row (DK1367). */ fleet?: { id: string; name: string; persona?: string } }')])

# fleet page: persona and node columns; the map tip shows the persona
edit('packages/asp-package/src/fleet-pages.ts', [
    ('<thead><tr><th>Agent</th><th>Joined</th><th>Story</th></tr></thead>', '<thead><tr><th>Agent</th><th>Persona</th><th>Node</th><th>Joined</th><th>Story</th></tr></thead>'),
    ('${m.house ? ` <small>(house agent)</small>` : ""}</td><td>${esc(m.joined.slice(0, 10))}</td>', '${m.house ? ` <small>(house agent)</small>` : ""}</td><td>${m.persona ? esc(m.persona) : "&ndash;"}</td><td>${m.node ? esc(m.node) : "root"}</td><td>${esc(m.joined.slice(0, 10))}</td>'),
    ('      + `<h2>Not on this page yet</h2><div class="note"><ul class="plain">${f.not_yet.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`,', '      + (f.not_yet.length ? `<h2>Not on this page yet</h2><div class="note"><ul class="plain">${f.not_yet.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""),'),
])
edit('packages/asp-package/src/society-map-page.ts', [('f.textContent = " Fleet: " + best.fleet.name;', 'f.textContent = " Fleet: " + best.fleet.name + (best.fleet.persona ? " (" + best.fleet.persona + ")" : "");')])

# job board: the poster's persona
edit('packages/asp-log/src/log.ts', [
    ('  posterFleet?: { id: string; name: string };', '  posterFleet?: { id: string; name: string; persona?: string };'),
    ('      if (posterFleetRow) entry.posterFleet = { id: posterFleetRow.did, name: posterFleetRow.name };', '      if (posterFleetRow) { const persona = posterPass ? ((await this.store.getRecord(posterPass.head))?.record.body as { persona?: string } | undefined)?.persona : undefined; entry.posterFleet = { id: posterFleetRow.did, name: posterFleetRow.name, ...(persona ? { persona } : {}) }; }'),
])
