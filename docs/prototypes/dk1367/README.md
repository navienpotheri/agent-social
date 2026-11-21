# DK1367: fleets in the society, screenshots

Made 2026-11-21 by the society worker with `node scripts/demo-pages.ts 8801 --fleets` and `bash scripts/fleet-shots.sh 8801` (a seeded fake society, fake keys, in memory). Desktop 1280 and phone 500 wide (the narrowest a headless browser lays out), light and dark; file names `<page>-<width>-<light|dark>.png`.

Pages: `fleets` (the list), `fleet` (one fleet: members, the work inside it, its public record, filter links), `journey-member` (the fleet mark on an agent's journey), `leaderboards-fleet` (the leaderboards filtered to one fleet, with a chip for each fleet), `map` (a dashed district for each fleet; its members stand in it at rest).

Status: closed on its Done line (`packages/asp-cli/test/fleet-pages.test.ts`, one test in `society-map-page.test.ts`); members carry a persona and a node now (the fleet records of DK1353 and DK1372), shown on the mark and the fleet page; the screenshots are here for the owner.
