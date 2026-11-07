# 002 — MSC Field Map v2: isometric "miniature MSC", motion polish, photo viewer, vending products, 3D view

Upgrade the existing app (`index.html`, `app.js`, `style.css`, built from `specs/001-map-app.md`; read that spec and the
current code first). Keep every v1 feature working (layers, rounds, quiet-spot ranking, details, tooltips, keyboard, dark mode, 390 px layout).

## Files
- Modify: `index.html`, `app.js`, `style.css`.
- Create: `iso.js` (classic script, defines `window.IsoMap`).
- Do NOT modify: `assets/msc-floor1.svg`, `data/*`, `tools/*`, `specs/*`, docs. Do NOT create or edit `model3d.js`
  (another worker is writing it in parallel; you only call its API, described below).

## A. Isometric 2.5D map (`iso.js`)
Visual reference: the "Isometric 2.5D" motion-design style: a true isometric miniature world, pastel studio palette,
soft shadows, buildings that "grow" (walls scaleY from 0 with overshoot, roof cap lands 2–3 frames later), no perspective.

`window.IsoMap = { attach(svg, opts), setMode(mode, animate=true), project(x, y, z=0) -> {x, y}, onFrame(cb), getMode() }`
- `attach(svg)`: reads every `path.room` from the inlined plan SVG. Their `d` attributes contain only absolute `M x y`, `L x y` and `Z`.
  Parse them into polygons (keep `data-area` and the classes `open`/`service`). Hide the original flat `.rooms` group and
  draw a new `<g id="iso-rooms">` instead. Also re-project `.room-labels text`, `.area-names text`, `.plan-icons`
  (move each icon element's position by projecting its center; keep its size) and `.plan-outline` (draw it as a flat floor slab at z=0).
- Projection with a morph parameter `t ∈ [0,1]` (t=0 = flat plan exactly like v1, t=1 = isometric):
  center the plan at `(cx, cy) = (980, 780)`; `dx = x-cx, dy = y-cy`;
  iso: `X = (dx - dy) * cos(30°) * 0.72 + cx`, `Y = (dx + dy) * sin(30°) * 0.72 + cy - z * t`;
  result = lerp(flat (x, y), iso (X, Y), easeInOutCubic(t)). Heights `z` are multiplied by `t` too, so walls grow as t rises.
- Room heights: default 30, `.service` 18, `.open` (courtyard) 2, area 9 (Flag Room) 40, area 14 (bookstore) 34.
- Faces: for each room draw side faces for every edge whose outward normal faces the viewer (screen-down/right half-plane in iso), then the top face. Painter's order: sort rooms by the iso depth of their centroid (`dx + dy`, ascending), and side faces within a room by edge midpoint depth.
- Colors (CSS variables, light + dark): top face by area group
  - study/lounges (areas 5, 8, 9, 15, 16): `--iso-mint`
  - shops/food (13, 14, 17, 18, 19): `--iso-peach`
  - galleries/offices/other (1, 3, 4, 6, 7, 10, 11, 12): `--iso-lavender`
  - `.service`: `--iso-service`; `.open`: `--iso-courtyard`
  - left side face = top color mixed 18 % toward `--iso-shade`, right side face = 32 % (use `color-mix(in oklab, …)` in CSS classes `.face-top`, `.face-left`, `.face-right` per group).
  - Floor slab `--iso-floor` with a soft blurred drop shadow (`feGaussianBlur` filter, offset down 14).
- Grow-in on first attach: animate t 0 → 1 over 1100 ms. Rooms grow staggered by distance from the plan center (each room's local t is delayed 0–350 ms); walls use easeOutBack (overshoot 1.4); the top face lands 60 ms after its walls.
- `setMode('flat'|'iso')` animates t over 700 ms (easeInOutCubic). `onFrame(cb)` is called every animation frame with the current t, so app.js can re-position markers.
- The SVG viewBox must follow the projected bounds (lerp between the flat viewBox and the iso bounds + 40 margin), so the map always fills its box.
- Default mode: iso. A toggle chip "3D view" / "Flat plan" sits in the layer bar (aria-pressed). Remember the choice in localStorage (wrapped in try/catch).

## B. Markers on the iso map (app.js)
- Markers are positioned with `IsoMap.project(x, y, h)` where h = the room height of the place's area + 2 (they stand on the roof/floor of that area). Re-position on every `onFrame`.
- Study markers become "pins": a small vertical stem (line, height 26) from the projected floor point up to the circle, plus an elliptical shadow on the floor. The dB label sits above the circle. Noise glow = flattened ellipse on the floor (ry = 0.55·rx) under the pin.
- Amenity markers: keep the rounded-square glyph, add the same stem and floor shadow.
- Depth: re-sort `#markers` children by projected y each frame so nearer markers draw on top.

## C. Motion polish (CSS + JS); always respect `prefers-reduced-motion: reduce` (then: no grow-in, no pops, instant state changes)
- Load sequence: header fades/slides up (opacity 0→1, translateY 12→0, 400 ms), chips stagger in (40 ms each), map grows (A), then markers pop in staggered by projected y (scale 0→1, easeOutBack, 30 ms apart), then the quiet-spot list rows slide in (40 ms stagger).
- Noise glows "breathe" slowly (scale 1 ↔ 1.08, 3.2 s, ease-in-out, infinite; offset per marker so they're not in sync).
- Hover/focus on a marker: lift it (translateY −4 in screen space) and enlarge 1.12 (160 ms). Selected marker: ring pulses once on select (scale 1→1.35, opacity 1→0, 600 ms), then a steady ring.
- Layer toggle: hidden markers shrink to 0 and fade (200 ms) instead of vanishing; shown ones pop back.
- Round change: dB numbers count up/down to the new value (400 ms) and pin colors cross-fade.
- Panel: switching tabs or selecting a place cross-fades the content (opacity + translateY 8 px, 220 ms). Quiet-spot list re-orders with a FLIP animation when the round changes.
- Use only transform/opacity for animations (no layout thrash). Use CSS transitions/keyframes where possible, a single requestAnimationFrame loop in JS otherwise.

## D. Photo viewer
- New data file `data/photos.csv`: `place_id,round,file,caption,ts` (`file` is a relative path such as `data/photos/V-1/R0-front.jpg`). Load it with the others (an empty file with only the header is valid → no photos).
- Details panel: a "Photos" strip of thumbnails (lazy-loaded `<img loading="lazy">`, 96 px tall, rounded) for the selected place, newest round first, each with its round badge. If none: "No photos yet."
- Clicking a thumbnail opens a lightbox: full-screen dimmed backdrop, image fitted to the viewport, caption + round + time, prev/next buttons and ←/→ keys, Esc / backdrop click / × closes, swipe left/right on touch. Focus is trapped while open and returns to the thumbnail on close. Open/close animate (scale .96→1 + fade, 200 ms).
- Map markers of places that have photos show a tiny camera badge.
- Also keep the v1 `photo` column of observations.csv working (treat it as an extra photo entry).

## E. Vending products
- New data file `data/vending_items.csv`: `place_id,round,slot,product,category,size,price_usd,sold_out,source_photo,note` (may be header-only).
- Details panel for a vending machine: a "Products" table (slot, product, size, price "$2.25", sold-out chip), sortable by price, with a summary line: "N products · cheapest X ($p) · K sold out". Round control applies (use the selected round, or the latest round that has items).
  If none: "Products not transcribed yet. They are read from our photos of the machine."
- In the Vending layer, a mini ranking under the quiet-spot tab is NOT needed; instead add a third panel tab "Vending" listing all products of all machines, filterable by a search box (product name), sorted by price, each row naming its machine; clicking a row selects that machine.

## F. 3D view (calls `model3d.js`, written by someone else)
- index.html: add exactly this import map before any module script:
  `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>`
- Details panel of vending / water / microwave / printer places: a "View in 3D" button. Clicking it opens a modal (same lightbox chrome, 3D canvas area ~ 70 vh, max 900 px wide) and runs:
  ```js
  const mod = await import('./model3d.js');            // lazy, once
  handle = mod.open(containerEl, { kind, title, data, onPick });   // returns { dispose() }
  ```
  Close → `handle.dispose()`. If the import fails, show "3D view could not load (needs internet for Three.js)".
- `kind` = place.layer. `data` built from our data for the selected round (or latest):
  - vending: `{ working, items: [rows of vending_items.csv for that place and round with price_usd parsed to number] }`
  - water: `{ working, cold: number|null, counter: number|null, filter_light }` (filter_light may be missing → '')
  - microwave: `{ units, units_working, extras }`, where extras = ['utensils','napkins'] if the place `note` mentions utensils/napkins
  - printer: `{ units, units_working, broken_note: observation note }`
- `onPick(item)` (vending): show the picked product name + price in a small label at the bottom of the modal.
- Under the canvas: "Model drawn by our code from our measurements; not to scale."

## G. Area names
- Load `data/areas.csv` (`area,name`) and show "Area 9 · Flag Room" in details, tooltips and list rows.

## Acceptance
1. `node --check app.js` and `node --check iso.js` (if node is unavailable, say so).
2. Report which parts A–G are done and anything skipped. Claude tests in the browser (desktop + 375 px, light + dark).
