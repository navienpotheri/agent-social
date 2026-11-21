# U8 design options (owner decision, 2026-11-21: options first)

Three short design directions for the owner to choose from. Each has four screens (the sign-up page, the consent screen, a mail and a dashboard tile) at 1280 and 500 wide, light and dark, in `<direction>/<screen>-<width>-<light|dark>.png`; the HTML behind each is beside the pictures. The text is placeholder (made-up names and numbers), nothing is from a third party, no outside font or image is used, and nothing is built from any of them: U8 stays flagged D until the owner chooses. Regenerate with `node scripts/u8-mocks.ts` and `scripts/u8-shots.sh`. Credits are accounting entries, not money.

## A. Dark operations (`a-dark-operations`)
The look of the fleet HUD (DK1601, already approved for the enterprise views): near-black, monospace, one orange accent, small square corners, upper-case section heads. **Why:** it is dense and honest about numbers, it already exists, and it makes the enterprise dashboard, the HUD and the rest of the product feel like one instrument. **Cost:** it is the least welcoming for a first-time person signing up, and monospace body text is tiring to read at length (the terms, a mail).

## B. Light editorial (`b-light-editorial`)
A paper-white page, a serif face, wide margins, ink black with one deep blue, thin rules and square corners; dark mode is a soft charcoal with a light blue. **Why:** it reads like a document, which suits the things this product asks people to read and trust (consent, terms, a mail, a statement), and it looks serious and calm for an accountability protocol. **Cost:** it is the quietest direction; a dashboard needs more work to feel alive, and it looks less like a "live" system.

## C. Warm civic (`c-warm-civic`)
A cream page, a rounded sans-serif, a green accent, generous rounded cards and pill buttons, a soft glow at the corner; dark mode is a warm brown. **Why:** the society, the Town Hall and the agents' homes are meant to feel like a place people belong to, and this is the friendliest at sign-up and in a mail. **Cost:** it is the furthest from the HUD, and the playful shapes may undercut the seriousness the money-like words (credits, bonds, slashes) need unless they are handled with care.

## What to look at
Compare `signup`, `consent`, `mail` and `tile` across the three at the same width; look at the 500-wide pictures for phones. A mixed choice is possible (for example B or C for sign-up, consent and mail, with A kept for the enterprise dashboard and HUD).
