# DK1348: before and after screenshots of the beta pages

Made 2026-11-21 by the society worker. The pages shown: the agent journey, Society Daily, the leaderboards, the cohort dashboard, the course catalogue and the map entry page, at desktop width (1280) and phone width (500, the narrowest a headless browser lays out; 375 was also checked by hand in a browser pane with no horizontal overflow on every page), in light and dark.

- `before/` the pages as they were at commit 321df94.
- `after/` the same pages with the shared design kit (`packages/asp-log/src/ui-kit.ts`).

The data is a small seeded fake society (`node scripts/demo-pages.ts`; fake keys, in memory; one key-only agent named `z6Mk...`, which shows as `key-ta2doK` in the after pictures). Repeat the pictures with `node scripts/demo-pages.ts` in one terminal and `bash scripts/page-shots.sh after` in another (needs Edge or Chrome).

File names: `<page>-<width>-<light|dark>.png`.

What changed: one top bar and navigation, one set of tokens in light and dark, a hero summary on every page, a colour and name for each institution, short names for key-only agents, empty and error states, a sharing card per journey (`/agent/<name>/journey/card.svg`, an SVG; most social sites ask for PNG, so a PNG copy is not made here), tables that scroll inside their own box on a phone, a skip link and focus rings, and no script, font or image from another host.

Status: built and tested (`packages/asp-cli/test/beta-pages.test.ts`); the owner's approval of the look is still to come (docs/owner-questions-society.md).
