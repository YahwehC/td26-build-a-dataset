# 003 — Cartoon 3D models of our amenities, driven by our data (`model3d.js`)

## Goal
An ES module that renders a small, cute, low-poly "3D cartoon" model of one amenity inside a given container,
built procedurally with Three.js (no downloaded model files). The model shows OUR measured data:
a vending machine's products and sold-out slots, a water filler's counter reading, how many microwaves/printers work.

## Files to create (only these)
- `model3d.js`: ES module (no build step).
- `tools/model-preview.html`: standalone test page that loads `../model3d.js` and shows all four kinds side by side with the sample data below (buttons: Vending / Vending (no products logged) / Water / Microwaves / Printers).
Do not touch any other file.

## Dependencies
Three.js r160 via an import map. The host page (index.html and the preview page) contains:
```html
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
```
In model3d.js: `import * as THREE from 'three'; import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';`

## API (exact)
```js
export function open(container, spec) -> { dispose(): void }
// spec = { kind: 'vending'|'water'|'microwave'|'printer', title: string, data: object }
```
- Creates a renderer sized to `container` (ResizeObserver; devicePixelRatio capped at 2), appends its canvas, starts the loop.
- `dispose()` stops the loop, disconnects observers, disposes geometries/materials/textures/renderer, removes the canvas. Calling `open` repeatedly (open → dispose → open) must not leak or throw.
- If WebGL is unavailable: put a short text message in the container ("3D view needs WebGL") and return a no-op `{dispose(){}}`. Never throw.

### `data` shapes
- vending: `{ working: 'y'|'n'|'' , items: [ {slot:'A1', product:'Dasani water', category:'drink'|'snack'|'food'|'other', price_usd: 2.25, sold_out: 'y'|'n'} ... ] }`
  - Slots are row letter + column number (A1…F10). Layout the shelf grid from the max row/col present (default 6 rows × 8 cols when `items` is empty).
  - Each filled slot: a small rounded product (can/bottle-ish cylinder for drinks, box for snacks/food) in a pastel color derived from a hash of the product name; sold-out slots: empty spiral coil only.
  - Glass front (MeshPhysicalMaterial, transmission ~0.6 or simple transparent), side panel with keypad + card reader.
  - When `items` is empty: show empty coils and a small floating sign "Products not logged yet".
  - Raycast hover (pointermove) on products → call the optional callback `spec.onPick?.(item)` and highlight the product (scale 1.15, emissive). On touch devices, tap = pick.
- water: `{ working, cold: 1|2|3|null, counter: number|null, filter_light: 'green'|'yellow'|'red'|'none'|'' }`
  - Wall-mounted bottle filler + fountain bowl below. A small display shows the counter number (CanvasTexture, e.g. "48,213 bottles saved", or "—" if null). Filter light as a small emissive dot in that color. If `cold` is 3, add a few slowly drifting frost particles; if `working` = 'n', show a red "out of order" tag.
- microwave: `{ units: 4, units_working: number|null, extras: ['utensils','napkins'] }`
  - Counter with `units` microwaves side by side. Working units have a lit green display + soft interior glow; non-working have a red X on the door. If units_working is null, all displays show "?" dimly. `extras` adds a cup of plastic forks and a napkin stack on the counter.
- printer: `{ units: 3, units_working: 2, broken_note: 'left' }`: printers on a table; non-working ones (from the left if broken_note includes 'left') show a red X sheet.

## Look & motion ("3D cartoon", soft studio)
- Pastel palette, soft rounded geometry (RoundedBoxGeometry radius ~0.04–0.08), MeshStandardMaterial roughness .6–.8, no textures except the CanvasTexture labels.
- Lighting: HemisphereLight (sky #fff6f0, ground #cfd8ff, 0.9) + DirectionalLight with soft shadows (PCFSoftShadowMap, mapSize 1024) + a shadow-catcher ground (ShadowMaterial opacity .18). Transparent renderer background (alpha true) so the page color shows through.
- Camera: PerspectiveCamera fov 30 at a 3/4 hero angle, OrbitControls (damping, no pan, zoom clamped, polar angle clamped so the camera never goes under the floor). Gentle idle auto-rotate (0.6) that pauses while the user drags and resumes after 3 s.
- Entrance: model pops in: scale 0 → 1 with easeOutBack over 700 ms, then products/units drop in staggered (30 ms each) with a tiny bounce. Respect `prefers-reduced-motion` (no entrance animation, no auto-rotate).
- Keep total triangle count reasonable (< 150k) and the frame loop idle-friendly (render only when something animates or controls change; it's fine to always render while auto-rotating).

## Acceptance
1. `node --check model3d.js` → no syntax errors (if node is unavailable, say so).
2. List what you implemented per kind and any part of the spec you skipped.
Claude will test both pages in a browser.

## Sample data for the preview page
- Vending: items A1–A4 drinks (`Dasani water` $2.25, `Coca-Cola 20 oz` $2.75, `Diet Coke 20 oz` $2.75 sold_out y, `Gatorade` $3.00), B1–B3 snacks (`Doritos` $1.75, `Cheez-It` $1.75 sold_out y, `Snickers` $1.75). Label the preview "SAMPLE DATA" clearly. This sample is for the test page only.
- Water: counter 48213, working y, cold 3, filter_light green.
- Microwaves: units 4, units_working 3, extras utensils+napkins.
- Printers: units 3, units_working 2, broken_note 'left'.
