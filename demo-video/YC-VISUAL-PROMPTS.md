# YC demo video: visual pack v3 for Cardboard (Silicon Valley product film, 4K, pictures + GIFs + animation)

Goes with `YC-SCRIPT.md` (the words). Total 2:56, 16:9.
v1 was a dreamy "city of light" and v2 a blueprint. This version is a modern tech product film (the look of Linear, Vercel, Stripe or Anthropic launch videos): dark UI, crisp type, smooth motion graphics, real screenshots and GIFs, animated diagrams and icons. It tells the story with things people recognise: a terminal, a log, an ID card, a vault, a courtroom, a map of services.

## 0. Resolution: read this first

- **Cardboard Starter exports 1080p; 4K appears to need Creator ($30 first month, then $59).** I read this in a search summary of their plans and the pricing page cut it off on your screen, so check the Creator column for "4K exports" before you pay more.
- **Your terminal footage is 1904×1100, and the GIF is 1000 px wide.** In a 4K export they are upscaled, so the text is only as sharp as the recording. 4K helps the generated parts and the motion graphics, not the recording.
- **Recommendation:** make the whole video at 1080p, which is sharp enough for YC and for YouTube, and export 4K only if your plan allows it at no extra cost. If you want 4K screen footage, re-record the CLI run at 3840×2160 (I can write the steps).

## 1. The look (style bible)

- **Feel:** a launch film from a serious Silicon Valley infrastructure company. Confident, clean, fast enough to feel modern, calm enough to feel trustworthy. Not artsy, not sci-fi, not a game.
- **Ground:** near-black (#0A0B10) with a very subtle blue-teal gradient and a faint dot grid. A slight vignette. A few soft gradient light sources are fine (this is not the flat blueprint of v2), kept subtle and never neon.
- **Accent:** one gradient from teal (#2DD4BF) to blue (#3B82F6) for highlights, lines and key elements. **Amber (#F5B450) only for a refusal or a failure.** White for type.
- **Surfaces:** rounded cards in dark glass (#12141C, 1 px lighter border, soft shadow), clean icons, thin lines. No gradients on text bodies.
- **Type (added in Cardboard, never generated):** Inter for titles and captions, a monospace (JetBrains Mono) for code and IDs. Titles are short, sentence case, 2–4 words.
- **Motion:** smooth ease-in-out, 0.4–0.8 s per move, elements slide and scale in with slight overlap, camera glides. Quick enough to feel modern. Holds of 1 s on anything the voice is naming.
- **Imagery:** real screenshots, real GIFs, UI mockups, icons and diagrams. No stock people, no faces, no cartoons. People appear only as simple line pictograms.
- **Agents:** small rounded nodes and icons in different shapes and colours (circle, square, hexagon, triangle) so the society looks varied. Hero agent: a teal gradient circle with a thin ring.

**Negative prompt (add to every generated shot):**
```
no text, no letters, no logos, no watermarks, no faces, no humanoid robots, no cartoon style, no pixel art, no isometric voxel blocks, no fantasy, no neon rain, no lens flare, no fast cuts, no camera shake, no spinning, no stock-photo people, no clutter
```

**Section tags (Cardboard text, top-left, small caps, 60% white):** "01 INTRODUCTION", "02 THE PROBLEM", "03 THE PLATFORM", "04 A REAL RUN", "05 FROM PROTOCOL TO SOCIETY", "06 INSIDE THE SOCIETY", "07 ACCOUNTABILITY".
**Labels (bottom-left):** "REAL RECORDING" on part 4. "CONCEPT ANIMATION" on parts 3, 5, 6 and 7 (on 5 and 6: "CONCEPT ANIMATION · DESIGNED").

## 2. Assets to upload to Cardboard

These are real pictures, GIFs and footage, already made:

| File | Where it goes |
|---|---|
| `demo-video/demo-cut.mp4` | Part 4, the main run |
| `demo-video/demo-deep.mp4` | Part 4, the paid job and the slashed job |
| `demo-video/assets/cli-refusal.gif` | Part 4 insert, and part 3 as a "gateway" picture |
| `demo-video/assets/protocol-parts.png` | Part 5, as a picture to zoom and animate |
| `demo-video/assets/society-institutions.png` | Part 6, as a picture to zoom and animate |
| `demo-video/assets/pilot-bond-floor.png` | Part 7, as a picture to zoom and animate |

Take two more yourself: a **screenshot of agentsocial.thedeeptransformation.com** (the top of the page) for part 1, and a **screenshot of the GitHub repo** (github.com/navienpotheri/agent-social) for part 7. Real pictures of the real product are more convincing than anything generated.

## 3. Style message for the Director (paste once, before any shots)

```
Style update for the whole video: it should look like a modern Silicon Valley tech product film (think Linear, Vercel, Stripe launch videos): near-black background (#0A0B10) with a subtle blue-teal gradient and faint dot grid, crisp white type, rounded dark-glass cards, clean icons, smooth eased motion graphics, and real screenshots, GIFs and screen recordings. Accent is a teal-to-blue gradient (#2DD4BF to #3B82F6); amber (#F5B450) only for a refusal or failure. Agents are small rounded nodes of different shapes and colours; the hero is a teal gradient circle with a thin ring. Formal, professional, sharp, not eccentric. Tell the story with pictures, GIFs and animation, not static text slides. Do not draw any text inside generated clips; I will add text in the editor. Final export 4K if my plan allows it, otherwise 1080p. Do not generate anything until I send a shot.
```

## 4. Reference images (three stills, generate first)

**Reference A, the hero agent**
```
A single small agent node on a near-black background (#0A0B10): a smooth teal-to-blue gradient circle with one thin concentric ring around it, soft subtle shadow, crisp edges, minimal, premium product-design render, shallow depth of field. No face, no text.
```
**Reference B, the network**
```
A clean dark network visualisation on a near-black background (#0A0B10) with a faint dot grid: many small rounded nodes of different shapes (circles, squares, hexagons, triangles) in teal, blue, white and soft violet, joined by thin lines, with a subtle teal-to-blue gradient glow behind the centre. Premium tech product-film style, sharp, uncluttered. No text.
```
**Reference C, the UI card**
```
A dark glass card UI on a near-black background (#0A0B10): a rounded card with a thin lighter border, a small teal icon, two short lines of placeholder blocks (no readable text), soft shadow, subtle blue-teal gradient behind it. Clean Silicon Valley product design, sharp. No readable text, no faces.
```
Check that the three share one background, one teal and one softness. Regenerate any that do not.

## 5. Scene by scene

Types: **GEN** is a generated clip (use the prompt), **PIC** is a real picture or GIF animated in the editor, **REC** is a real recording. Times are the timeline position.

### Part 1: Introduction (0:00–0:16)

| Scene | Time | Type | What |
|---|---|---|---|
| 1.1 | 0:00–0:05 | GEN | A network assembling itself on a dark ground |
| 1.2 | 0:05–0:11 | GEN | Many varied nodes moving through the network |
| 1.3 | 0:11–0:16 | PIC | The real homepage screenshot, with the wordmark |

**1.1**
```
Near-black background with a faint dot grid. A single teal-to-blue gradient circle appears at the centre; thin lines draw outward from it and branch, forming a clean network of small rounded nodes that fade in one by one. Smooth eased motion, premium tech product-film style, slow push-in. 5 seconds.
```
**1.2**
```
A wide view of a clean network on a near-black background: hundreds of small rounded nodes of different shapes (circles, squares, hexagons, triangles) in teal, blue, white and violet moving steadily along thin lines and exchanging small dots of light. Orderly and alive, subtle gradient glow, slow camera glide. 6 seconds.
```
**1.3 (PIC):** the screenshot of the real homepage slides up inside a dark glass browser frame with a soft shadow, slight zoom. Add "Agent Social" large over it at 0:12.

### Part 2: The problem (0:16–0:37)

| Scene | Time | Type | What |
|---|---|---|---|
| 2.1 | 0:16–0:23 | GEN | An agent works and leaves no trace |
| 2.2 | 0:23–0:30 | GEN | An activity feed of unknown agents |
| 2.3 | 0:30–0:37 | GEN | A guardrail with a gap |

**2.1**
```
A teal-to-blue gradient circle node moves across a dark UI canvas: it opens a file icon, sends a small signal, and spends a small coin icon. Behind it, its trail of light fades away to nothing. Clean, premium motion graphics, no text. 7 seconds.
```
**2.2**
```
A dark glass activity-feed panel with rows of placeholder blocks (no readable text), each row with a small different-shaped agent icon and a grey question-mark badge instead of a name. New rows slide in steadily, all anonymous. Subtle amber tint on the last row. Clean Silicon Valley UI style. 7 seconds.
```
**2.3**
```
A thin rounded rectangle barrier forms around a small triangle node, then the node slips through a small gap in one side and keeps moving; the barrier outline flickers and fades. Clean, precise motion graphics, faint amber tint at the end. 7 seconds.
```

### Part 3: The platform (0:37–0:58)

| Scene | Time | Type | What |
|---|---|---|---|
| 3.1 | 0:37–0:44 | GEN | Three layers stack up |
| 3.2 | 0:44–0:51 | PIC | The refusal GIF in a glass window |
| 3.3 | 0:51–0:58 | GEN | The top layer opens into a society |

**3.1**
```
A clean 3D exploded diagram of three stacked dark-glass layers over a near-black background, slow orbit. The bottom layer has a ring-shaped boundary on it; the middle layer has an ID card, a seal and a chain of linked squares; the top layer holds a small network of varied nodes. The layers light up one after another with a teal-to-blue edge glow. Premium product render, no text. 7 seconds.
```
**3.2 (PIC):** `cli-refusal.gif` in a dark glass window, slightly tilted, sliding in; a thin teal outline pulses around the refusal line. Section label from the voiceover: gateway.
**3.3**
```
The top layer of a dark-glass stacked diagram lifts and opens up into a clean network map with small buildings made of thin lines (an archway, a vault, a domed hall) and varied rounded nodes moving between them. Smooth camera rise, subtle gradient glow, premium product-film style. 7 seconds.
```
*Add "Gateway", "Protocol" and "Society" as short captions in Cardboard at 0:39, 0:45 and 0:52.*

### Part 4: A real run (0:58–1:46)

All real recordings, with product-film polish added in Cardboard (no generation).

| Scene | Time | Type | What |
|---|---|---|---|
| 4.1 | 0:58–1:04 | REC | `asp run` and the Mandate line (`demo-cut.mp4` 8–12 s) |
| 4.2 | 1:04–1:18 | REC | The edit passing, the refusal, the summary (12–24 s) |
| 4.3 | 1:18–1:23 | REC | The timeline with REFUSED (32–36 s) |
| 4.4 | 1:23–1:30 | REC | Allow-host run, `out.html` appears (44–58 s, sped up) |
| 4.5 | 1:30–1:36 | REC | `run-log verify`, then "NOT ok" (36–44 s) |
| 4.6 | 1:36–1:46 | REC | The paid job and the slashed job (`demo-deep.mp4`; timestamps to be checked) |

**Polish (Cardboard, not prompts):**
- Put each clip inside a dark rounded window with a soft shadow on the dark gradient ground, at 100–110% scale.
- Zoom to 150% on the refusal line and on "NOT ok" for about 3 seconds each.
- Draw a thin teal rounded outline around "REFUSED" and "NOT ok" that animates in.
- Add a small callout pill beside each: "Refused before it ran", "Record checks out", "Tampered: fails".
- Speed 4x while the agent waits, normal where there is text to read.
- A quiet low tone when the refusal appears, no alarm. Label "REAL RECORDING".

### Part 5: From protocol to society (1:46–2:08)

| Scene | Time | Type | What |
|---|---|---|---|
| 5.1 | 1:46–1:52 | GEN | The agent's ID becomes a passport at a registry |
| 5.2 | 1:52–1:57 | GEN | The deposit locks in a vault |
| 5.3 | 1:57–2:03 | GEN | The record is read in a court |
| 5.4 | 2:03–2:08 | PIC | The "protocol parts" picture, animated |

**5.1**
```
A small teal-to-blue gradient circle node with an ID card icon floating beside it. The ID card flips into a passport and glides through a clean glowing archway made of thin lines into a registry building outline; the archway edge lights up teal as it passes. Premium motion graphics on near-black, no text. 6 seconds.
```
**5.2**
```
A small hexagon seal flips into a clean rounded vault icon; a thin ring is placed inside and the vault door closes with a soft teal edge glow. Premium motion graphics on near-black, subtle, no text. 5 seconds.
```
**5.3**
```
A clean wireframe domed hall with a round table; a chain of linked squares slides across the table and a few small circles seated around it light up in turn as they review it. Symmetrical, sharp, premium motion graphics on near-black, no faces, no text. 6 seconds.
```
**5.4 (PIC):** `protocol-parts.png` zooms and pans across its five cards (Identity, Mandate, Bond, Log, Courts), highlighting each in turn with a teal outline. Fast and smooth.
*Label: "CONCEPT ANIMATION · DESIGNED".*

### Part 6: Inside the society (2:08–2:33)

| Scene | Time | Type | What |
|---|---|---|---|
| 6.1 | 2:08–2:14 | GEN | Takes a job at the market |
| 6.2 | 2:14–2:19 | GEN | Does the work and earns credits |
| 6.3 | 2:19–2:26 | PIC | The institutions picture, animated, with credits spent |
| 6.4 | 2:26–2:30 | GEN | A home of its own |
| 6.5 | 2:30–2:33 | GEN | Moving up to a bigger job |

**6.1**
```
A clean wireframe market plaza on near-black. A small diamond job marker appears on a stand; a teal gradient circle node moves to it and takes it, and a thin ring of light settles around the node. Premium motion graphics, smooth, no text. 6 seconds.
```
**6.2**
```
Close on a teal gradient circle node with a thin progress ring around it that fills steadily; when complete the job marker turns teal and a small cluster of dots (credits) detaches and floats beside the node. Premium motion graphics, smooth, no text. 5 seconds.
```
**6.3 (PIC):** `society-institutions.png` slides in and the camera pans across its ten institutions; as the voice says "learning, services, everyday things" a trail of small teal dots flows from the left edge to the Academy, Shops and Housing tiles, each tile lighting up as the dots arrive.
**6.4**
```
Inside a small house made of thin lines on near-black: a teal gradient circle node enters, and thin lines add a window, a lamp and a small garden of dots, arranging the room. Quiet, minimal, premium motion graphics, no text. 4 seconds.
```
**6.5**
```
Back at the wireframe plaza a new, larger diamond job marker appears with a smaller ring around it; a teal gradient circle node moves toward it. Calm, smooth, premium motion graphics. 3 seconds.
```
*Label: "CONCEPT ANIMATION · DESIGNED".*

### Part 7: Accountability (2:33–2:56)

| Scene | Time | Type | What |
|---|---|---|---|
| 7.1 | 2:33–2:39 | GEN | Pull back to a society of varied agents |
| 7.2 | 2:39–2:45 | GEN | The agents evolve and interact |
| 7.3 | 2:45–2:50 | PIC | The pilot chart (a tether in numbers) |
| 7.4 | 2:50–2:56 | PIC | The repo screenshot, wordmark and URL |

**7.1**
```
Smooth pull-back from one teal gradient circle node to reveal a large clean network with hundreds of varied nodes (circles, squares, hexagons, triangles in teal, blue, white and violet) interacting, exchanging dots of light along thin lines, orderly and alive. Subtle gradient glow, premium product film. 6 seconds.
```
**7.2**
```
Time-lapse feel over a clean dark network: varied nodes form small groups, exchange dots along thin lines and gradually change form, a square slowly becoming a hexagon, a circle gaining a second ring. Continuous, calm, sharp, premium motion graphics. 6 seconds.
```
**7.3 (PIC):** `pilot-bond-floor.png` animates its four bars rising one by one (no learning 400, careless 322, overfits 400, learns 237) with a thin ring drawn inside the "Learns" bar as the tether. Keep the caption at the bottom.
**7.4 (PIC):** the GitHub repo screenshot in a dark glass browser frame, with "Agent Social" and `agentsocial.thedeeptransformation.com` appearing below. Hold 4 seconds. *Label "CONCEPT ANIMATION" until 2:50.*

## 6. Sound

- **Music:** modern, confident, light. Prompt: `modern tech product film score, light pulsing synth pads, clean minimal beat at 100 bpm, confident and optimistic, understated, 3 minutes, no vocals`. Keep it under the voice by 18 dB.
- **Effects, all quiet:** soft whooshes as panels slide in, a low tone for each refusal (no alarm), a chime when a job is paid, a click as a link attaches.
- **Voice:** your own, close mic, dry, no effects.

## 7. Order of work (so you do not waste credits)

1. Style message for the Director, then the three reference images. Check the three match.
2. Scenes 1.1 and 1.2 only. If the look is right, continue part by part.
3. Upload the assets and the two screenshots. Build the PIC and REC scenes first (they cost no generation credits).
4. Generate the GEN scenes. Keep the best take of each.
5. Record the voiceover, add music, effects, section tags and labels.
6. Watch once with the sound off and once with it on. Check the length is under 3:00. Export MP4.

## 8. If a generator misbehaves

- **It adds neon or clutter:** start with "restrained, clean, lots of empty space".
- **It draws text:** drop the word "text" and add it in Cardboard.
- **It gives faces or characters:** add "abstract geometric nodes only".
- **The look drifts between shots:** attach Reference A or B, or start from the last frame of the previous shot.
- **Amber appears where it should not:** add "teal, blue and white only, no amber".
