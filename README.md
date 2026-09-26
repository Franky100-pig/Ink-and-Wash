# Sand-and-Ink

A **fully offline, account-free, privacy-first** sandbox for unwinding. One canvas, two materials — switch with the 墨/沙 (Ink/Sand) toggle at the bottom; switching changes the brush and the physics, not the program:

- **Ink mode (Ink Quiet, Mode B)** — drop ink on rice paper and watch it bleed and flow.
- **Sand mode (Mode A)** — a falling-sand particle sandbox with 9 materials.
- **Fine art mode** — a third position on the mode switch, for when you have
  something of your own to make: the AI steps aside completely, the brush gets
  much finer (smaller ink dots), and the ink spreads far less, so lines stay
  where you put them. Switching back restores your previous AI setting.
  What you painted in ink mode stays on the paper when you switch; press
  **Clear** first if you want to start a fresh piece.

Both halves are **sandbox games for decompressing** — no scores, no levels, no way to fail. Everything runs **100% offline** in your browser. This project was made in the hope that it might help someone who is feeling down: pour some sand, light a fire, grow a plant, watch the rain come back around.

There is no backend, no account, no tracking, and no network access at all.

## How it works

- **Ink mode**: you paint on the paper and the ink keeps bleeding on its own. A quiet "dumb AI" companion occasionally adds a stroke of its own — but the moment you touch the canvas it steps aside, and its next stroke avoids where you just painted. Your brush always wins.
- **Sand mode**: pick a material and pour it onto the canvas — sand / fire / water / cloud / bomb / seed / plant / snow / steam — and watch them fall, rise, flow, grow, and react like in the classic Powder Game. The same AI companion quietly pours a little pile in a corner and stops as soon as you start drawing.

> This is the first minimal slice of IDEAS.md #001 ("offline sandbox healing tool"):
> ink fluid + dumb AI + interrupt/yield rules. **No machine learning involved.**

## Run it (fully offline)

**Desktop app (recommended):** download the installer for your platform from the
[Releases](https://github.com/Franky100-pig/Sand-and-Ink/releases) page —
`Sand-and-Ink-<version>-<arch>.dmg` for macOS (Apple Silicon & Intel) and
`Sand-and-Ink-Setup-<version>.exe` for Windows. The desktop app is the same
offline sandbox wrapped in a small Electron shell: no network access, no
auto-update, no data stored.

**In the browser:** just double-click `index.html`. Every asset (engines, three.js, UI) is local — zero network requests, no backend, no account.

If your browser restricts `file://`, serve the folder locally (still offline):

```bash
cd ink-healing
python3 -m http.server 8080
# open http://localhost:8080
```

## Verify it

### 1. One-click self test (automated — start here)

Open `selftest.html`. It runs two groups of checks and shows PASS/FAIL:

- **Ink group (8 checks)**: three.js / engine loaded locally, WebGL context works;
  blank paper at start; the canvas actually darkens after a stroke; PNG export;
  **AI yields while the user is drawing (no new ink)**; **AI takes over after the user stops**;
  no ink after the AI toggle is off; clearing returns to blank paper.
- **Sand group (21 checks)**: engine loads/instantiates; sand falls, water finds the floor;
  fire burns out (no fuel), water douses fire, cloud rains, bomb fuse detonates;
  **snow falls and piles; seeds germinate into plants near water (bounded growth);
  fire ignites plants and burns them down; fire turns water into steam and steam
  condenses back to water (closed loop)**;
  clearing resets the grid (EMPTY count back to full); PNG export;
  mode toggle works (sand mode hides the ink palette);
  **user-active yield / idle takeover / full-box restraint in sand mode**;
  same seed → same result (determinism).

All green = both engines and the interrupt/yield rules are alive.

### 2. Prove it's offline (the decisive test)

The self test can't prove offline-ness. Either of these is the real verdict:

- **Disconnect**: turn off Wi-Fi → open `index.html` → paint. Ink still bleeds, export still works = offline confirmed.
- **DevTools**: F12 → Network → check **Offline** → reload. The page keeps working and the request list
  contains only local files (`index.html`, `styles.css`, `lib/*.js`, `src/app.js`) — **zero external domains**.

To confirm at the source level:

```bash
grep -rnE "fetch\(|XMLHttpRequest|PocketBase|https?://" src/ index.html lib/suminagashi.js
```

Expected: only a GitHub link inside a comment in `lib/suminagashi.js` (attribution, not a request).
Note: three.js ships loader code internally, but this project never calls any loader and loads no
textures/models, so that code path is never triggered.

### 3. Feel (only you can judge this)

- Drag a stroke, let go — the ink keeps spreading for a while, so the simulation is always running.
- **Yield A/B test**: set "AI patience" to minimum (2s).
  - Sit still for 10 seconds → about 5 blue strokes should appear (the AI's ink).
  - Then draw continuously for 10 seconds → **0** new blue strokes (the AI yields the whole time).
- After you stop, the AI resumes, and its next blue stroke **avoids where you just painted**.

## Controls

- **Paint**: press and drag on the canvas. The ink keeps drifting after you release.
- **Ink colors**: five dots at the bottom (pine soot / vermilion / pine needle / AI blue / **white**).
  **White is the "lighten / leave-blank" tool**: when things get too dark, brush white over the ink
  to fade it back to paper (like an eraser). White strokes don't splash velocity — they quietly lighten.
- **Brush**: adjusts ink volume (also affects how much the stroke spreads/flows).
- **Concentration**: only adjusts ink darkness, not spread. **Applies instantly to the whole sheet** —
  moving the slider re-tints your strokes, the AI's strokes, and all future strokes together
  (the engine deepens the ink layer at render time). Ink no longer fades over time by default
  (dye dissipation is near zero: ~12% after ten minutes idle), but it still bleeds naturally.
- **AI companion**: on/off. When on, it paints a stroke whenever you've been quiet for a bit; it steps away the moment you draw.
- **AI patience**: how long it waits between strokes (higher = slower, less intrusive).
- **Clear**: empties the paper; ink starts fresh from blank.
- **Save**: exports the current frame as PNG (via `toBlob`, robust on `file://` and Safari).
  Note: **the WorkBuddy preview iframe blocks downloads** — open `index.html` in a real browser
  and click Save there; the file goes to your downloads folder. The button flashes
  "已保存 ✓" (saved) as feedback.

### Sand mode (toggle to 「沙」)

- **Ink / Sand / Fine**: the segmented button on the left. Switching to sand swaps the five ink dots for
  **nine material dots**, and the physics switches from fluid to cellular automaton; the ink canvas
  freezes and is restored intact when you switch back.
- **Materials** (a physics sandbox with Powder Game–style reactions): sand / fire / water / cloud /
  bomb / seed / plant / snow / steam.
  - **Sand**: falls, piles into dunes (angle of repose), sinks in water.
  - **Fire**: rises (hot gas), flickers, burns itself out into smoke (cloud) without fuel;
    doused by water (the water becomes steam); detonates bombs;
    **ignites plants and seeds** (fire spreads along vines).
  - **Water**: falls, pools, never evaporates; douses fire (and becomes steam doing it).
  - **Cloud**: rises, drifts with the wind; rains into water; condenses near water/fire
    (being scorched by fire makes it rain and douse the fire).
  - **Bomb grains**: fall like powder; explode on a ~3-second fuse or on fire contact —
    a core void plus a burning ring; other bombs in the blast chain-detonate.
    An "explosion" interaction (part of the sand half's physics).
  - **Seed**: falls like powder; **germinates into a plant** near water; flammable.
  - **Plant**: paint it directly or grow it from seeds; grows new shoots upward/sideways
    under a per-cell growth budget (a few layers, then it stops — **it can't flood the grid**);
    grows faster next to water; once ignited, the whole vine burns down.
  - **Snow**: falls slowly, piles into fluffy steep drifts; slowly melts while floating on water;
    melts instantly near fire.
  - **Steam**: the gas that fire boils out of water; rises, drifts, and at end of life (~2–4s)
    **condenses back into a droplet** — water → steam → rain → water, a closed loop.
- **Brush**: same slider, now controlling the pour width.
- **AI companion / patience**: same yield rules as ink mode. In sand mode the AI slowly pours a
  little mound in a corner and stops the moment you draw; it also **holds back when the box is
  more than ~35% full**, so the canvas never turns to mush.
- The concentration slider is ink-mode only; it hides automatically in sand mode.
- **Press C**: hides the toolbar for an immersive view of the AI painting; press again to bring it back. While the canvas is still empty, a faint "press C" hint stays on screen.

## Design discipline (from IDEAS.md v3)

- No scores, no levels, no failure states. The sand half contains fire/bombs as *physics*,
  but nothing is ever judged as "win/lose".
- The AI only produces *intent* (where to drop, how wet); the actual stroke belongs to the physics.
- The AI's ink expresses no emotion; it only responds to rhythm, never interrupting or overpainting yours.
- No psychological assessment, no "your drawing means X" interpretation. This is a toy, not therapy.

## Credits & license

- Ink engine `lib/suminagashi.js`: adapted from **fisheryv/healing** (MIT, © 2026 Fisher).
  The original is a "phone face-down, music-driven focus app"; this tool reuses its rendering
  core behind an "active + interruptible + offline" interaction. See `NOTICE.md`.
- `lib/three.min.js`: three.js r137 (MIT).
- Sand engine `lib/sandsim.js`: **original implementation in this repo** (© 2026 Franky100-pig, MIT).
  Only the *ideas* of MIT-licensed projects (neon-sand, SandGears) were referenced; no code was copied.
  Sandboxels (R74n Content License, All Rights Reserved) was **not** referenced or copied.

## Ideas for later

- The AI's ink **physically retreats** when the user paints (inject reverse velocity, not just "no new strokes").
- Service worker → a truly installable PWA.
- Upgrade the dumb AI to a sketch-RNN-style stroke-sequence model (still optional, still offline).
