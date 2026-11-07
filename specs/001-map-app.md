# 001 — MSC Field Map: static interactive map app (v1)

## Goal
A static, dependency-light web app (works on GitHub Pages and on `python -m http.server`) that shows our own
measurements of the MSC 1st floor on a schematic floor plan: study places (noise, people), water fillers,
vending machines, microwaves, printers. Clicking a point shows its measurements. It must work on a phone (~390 px wide) and on desktop.

## Files to create (repo root = this folder)
- `index.html`: markup only + `<link>` to `style.css`, `<script defer>` PapaParse then `app.js`.
- `style.css`
- `app.js` (plain ES2020, no build step, no framework)

Do NOT modify: `assets/msc-floor1.svg`, anything in `data/`, `tools/`, `specs/`, `CLAUDE.md`, `IDEAS.md`, `team-brief.html`, `GUIDE.txt`.

Allowed external script (only this): `https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js`. No other CDNs, no fonts from the web (use system font stacks).

## Data inputs (read with fetch + Papa.parse({header:true, skipEmptyLines:true}))
1. `data/places.csv`: `place_id,layer,name,area,x,y,location_note,seats_total,outlets,note`
   - `layer` ∈ `study | water | vending | microwave | printer`. `x,y` are coordinates in the SVG's user space.
2. `data/noise.csv`: `obs_id,place_id,round,ts,duration_s,laeq_db,lmax_db,lcpeak_db,device,app,source_file,note`
   - `ts` is local ISO time (e.g. `2026-11-07T13:42:45`), no timezone; display as e.g. "Sat 1:42 PM".
   - `source_file` is a relative path to the original PDF report; link it ("Original report (PDF)").
3. `data/observations.csv`: `obs_id,place_id,round,ts,people,seats_taken,working,cold,counter,units,units_working,clean,waiting,photo,note`
   - Any field may be empty. `photo` (if present) is a relative image path; show it as a thumbnail that opens full size in a new tab.
Treat empty strings as "not measured". Numbers: parseFloat. Rows whose place_id is unknown: ignore and `console.warn`.

## Basemap
`fetch('assets/msc-floor1.svg')` → insert its markup inline into `#map` (so CSS can style it). Keep its viewBox.
Append a `<g id="markers">` to that SVG and draw markers there at each place's (x, y).
The SVG uses classes: `.plan-bg .plan-outline .room .room.open .room.service .room-labels text .area-names text .icon.restroom .icon.elevator .icon.stairs .icon.entrance .icon.you-are-here`. Style all of these in style.css with the tokens below.

## Layout
- Header: app name "MSC Field Map", subtitle "Memorial Student Center · 1st floor · measured by our team, Nov 7–8 2026".
- Layer chips (toggle buttons, `aria-pressed`): Study places, Water fillers, Vending, Microwaves, Printers, each with its point count. All on by default. Hiding a layer hides its markers and its list entries.
- Round control: a segmented control built from the distinct `round` values found in noise.csv + observations.csv, sorted, plus "Latest" (default). Selecting a round makes markers and the ranking use only that round's values; "Latest" uses the most recent value per place by `ts`.
- Main area: the map (fills available width; on desktop ≥ 900 px the details/ranking panel sits on the right at 360 px; on narrow screens the panel goes below the map).
- Panel has two tabs: "Quiet spots" (default) and "Details".
  - Quiet spots: study places sorted by LAeq ascending (places with no value at the end, labelled "not measured"). Each row: name, LAeq as "47.4 dBA", a noise band chip, people count if present ("19 people"). Clicking a row selects that place (switches to Details, highlights the marker).
  - Details: for the selected place show name, layer, area ("Area 9"), location_note, seats_total/outlets if present, note; then a table of all its measurements across rounds (round, time, and the relevant fields: for study LAeq/Lmax/LCpeak/duration + people/seats_taken; for water working/cold/counter; for microwave units/units_working/clean/waiting; for vending working + photo). Missing fields show "—". For water fillers with ≥ 2 counter readings, also show "Bottles filled between readings: N (≈ X per hour)". If nothing has been measured yet, show "Not measured yet. This place is on our collection route." Link source PDFs and photos.
- Footer: "Basemap: schematic traced by our team from the MSC directory sign; not to scale. All values are our own measurements; see Data & methods." with links to `data/places.csv`, `data/noise.csv`, `data/observations.csv` and `README.md`.

## Markers
- Study: circle r=16, fill = noise band color of the LAeq for the current round (or the neutral color if not measured), white 3 px stroke, with the rounded dB value as text above it (font-size 22 in SVG units). Bands (A-weighted, LAeq):
  `< 50` "Quiet" · `50–<60` "Moderate" · `60–<70` "Loud" · `≥ 70` "Very loud".
- Also draw, under all markers, a soft "noise glow" per measured study place: a circle r=70 with a radial gradient from the band color (opacity .45) to transparent. A chip "Noise glow" in the layer bar toggles it (on by default).
- Water: rounded square 26×26 with a water-drop glyph or letter "W". Vending: square with "V". Microwave: square with "M". Printer: square with "P". Each layer has its own token color. Places that are measured as not working (`working` = "n"): add a diagonal red slash.
- All markers: `tabindex="0"`, `role="button"`, `aria-label` = name + main value; Enter/Space selects. Hover/focus shows a tooltip (name + main value). Selected marker gets a thick outline ring.
- Markers must stay readable on a phone: when the SVG is rendered narrower than 700 px, multiply marker sizes and font sizes by 1.6 (compute from `svg.getBoundingClientRect().width / viewBox width`).

## Legend
Below the map: noise band legend (four swatches with ranges) and layer symbol legend.

## Design tokens (put at top of style.css; support light + dark)
```css
:root{
  --bg:#f4f5f2; --surface:#ffffff; --ink:#1d2321; --muted:#5f6b66; --line:#d5dad6;
  --floor:#e6e9e4; --room:#ffffff; --room-stroke:#b9c1bb; --service:#eceee9; --open:#f0f2ee;
  --accent:#6e1423;            /* maroon: selection ring, active chips */
  --quiet:#2f9e6e; --moderate:#d9a21b; --loud:#e0662b; --vloud:#c0392b; --unmeasured:#9aa5a0;
  --water:#2a7fd4; --vending:#7b4bc4; --microwave:#d0532f; --printer:#56616b;
  --sans: system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --mono: ui-monospace,"Cascadia Mono",Consolas,monospace;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --bg:#141816; --surface:#1c211f; --ink:#e7ece9; --muted:#9aa7a1; --line:#2f3733;
  --floor:#202624; --room:#2a312e; --room-stroke:#46504b; --service:#252b29; --open:#232927;
  --accent:#e28a98; color-scheme:dark } }
:root[data-theme="dark"]{ /* same dark values as above */ }
```
Numbers use `font-variant-numeric: tabular-nums` and `--mono`. Body background `var(--bg)`. No horizontal page scroll at 390 px. Visible focus styles. Respect `prefers-reduced-motion`.

## Robustness
- If any fetch fails (e.g. opened via file://), show a clear message in the map area: "Open this app through a web server: run `python -m http.server` in the repo folder and visit http://localhost:8000".
- No console errors on load. Wrap localStorage use (if any) in try/catch; not required.
- Escape all CSV text before inserting into HTML (no innerHTML with raw CSV values).

## Acceptance (run these and report output)
1. `node --check app.js` (if node is available) → no syntax errors.
2. Start `python -m http.server 8799 --bind 127.0.0.1` in this folder in the background, then
   `python -c "import urllib.request as u;[print(p, u.urlopen('http://127.0.0.1:8799/'+p).status) for p in ['index.html','app.js','style.css','assets/msc-floor1.svg','data/places.csv','data/noise.csv','data/observations.csv']]"` → all 200. Stop the server afterwards.
3. Report the line counts of the three files. Do not try to open a browser; Claude will test it in a browser.
