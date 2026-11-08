# Build-A-Dataset (TAMU Datathon 2026, challenge 3)

Repo: private https://github.com/YahwehC/td26-build-a-dataset (branch `main`). Must be made **public** before Devpost submission (user's OK needed). `git pull --rebase` before every push; teammates push too.
User speaks Chinese → answer in Chinese; code, docs, specs in English. Delegate routine coding to DeepSeek (`tools/ds.ps1 -Dir <this folder>`, specs in `specs/`), per root CLAUDE.md.

## Sources
- `GUIDE.txt`: official guide (exported from Google Doc 1LjwC2ZwxrLQzuy14MjoHLTnhe4Wmq6eEUBKs1PHoUjc).
  Key points: primary data collected by the team during the event, in the physical world; app must be interactive and depend on the data; no fabrication; label synthetic/supplementary data.
  Devpost submission = GitHub repo (code, dataset, README run steps, methodology, data dictionary, limitations) + ~2-min video (collection → dataset → app).
  Rubric: 5 × 20 pts (collection quality, app + data integration, creativity, usefulness + limitations, communication).
- `IDEAS.md`: ideas considered (A study spots, B water fillers, C accessible entrances, D reaction-time, E food queue, F food value) plus prior-art research.
- Official MSC floor plans (event-space focused, 1F, 2F, West Wing LL/2F only, ~720 px, TAMU copyright; reference only, don't ship as basemap):
  https://ucenter.tamu.edu/wp-content/uploads/2024/12/MSC_FirstFloor_FloorPlan.jpg ,
  https://ucenter.tamu.edu/wp-content/uploads/2025/09/MSC_SecondFloor_FloorPlan.jpg ,
  https://ucenter.tamu.edu/wp-content/uploads/2024/12/MSC_WWLowerLevel_FloorPlan-scaled.jpg ,
  https://ucenter.tamu.edu/wp-content/uploads/2024/12/MSC_WWSecondFloor_FloorPlan.jpg
- Aggie Map (aggiemap.tamu.edu) already has building-level layers (accessible entrances, AggiePrint, dining, lactation rooms, single-occupancy restrooms) but **no indoor floors, no water fillers, no study spots, nothing time-varying** → our gap.
- Prior art: many "study spot finder" projects (Devpost StudySpot, Study Hall Checker; TAMU Libraries "Explore"); refill maps exist elsewhere (Penn, BU; Devpost "Refill Radar", so avoid that name). TAMU fillers show a "bottles saved" counter (confirmed for Schuhmacher Hall); counter deltas as a usage sensor are our novel angle.
- MSC OSM: relation 2083295, center 30.61223, -96.34122, bbox lat 30.61138–30.61319, lon -96.34255 to -96.34041.

## Decisions (2026-11-07)
- **Concept: multi-layer interactive MSC map**: study spots (core, time series of people / seats taken / noise), water fillers (counter every round, fill time, filter light), restrooms (fixed features + supply/cleanliness in R0 and R4), optional other amenities. Pitch: "Aggie Map tells you where; we tell you which one, right now."
- Scope: MSC public areas only (1F, 2F, West Wing), 4 zones, rounds R0 (inventory, Sat ~15:00) then Sat 18:00, 21:00, Sun 08:30, 10:00; data cutoff Sun 10:30.
- Team has exactly one female member → she covers women's restrooms (R0 + R4 only) + smallest zone (West Wing). No photos in restrooms; enter only matching or all-gender/family restrooms.
- Team brief: `team-brief.html`, published privately as https://claude.ai/artifact/Kw2KCkN15JHPp71Bik5b8q (user shares it with the team).
- Still in planning: user said not to start building yet (2026-11-07 afternoon).
- **Scope update (later 2026-11-07):** user dropped study spots as a core layer. Layers are now **water fillers, restrooms, microwaves, vending machines**. Re-measured over time: filler counters, vending sold-out slots / total and price of water + 20 oz soda, microwave working + queue at mealtimes, restroom supplies. Proposed rounds: R0 Sat afternoon (inventory), R1 Sat ~19:00 (dinner), R2 Sun ~09:00 (final). Undecided: "light" study spots (8–10 lounges, seats taken only, noise optional). Noise only matters if study spots come back (iPhone NIOSH SLM, LAeq over 10–30 s, same phone, side-by-side calibration). `team-brief.html` still shows the old study-spot plan and must be updated once the scope is confirmed.
- Idea under discussion: Gaussian-splat 3D. Advised against a whole-MSC 3D site (capture scale, people in scans, file size, weak data link). Proposed instead: 3–5 small splats of key spots (Scaniverse on iPhone) shown as "3D preview" in a point's detail panel, viewer GaussianSplats3D or Spark (MIT).
- **Pilot scope (user, later 2026-11-07):** MSC **1st floor only**, 2 zones (east / dining-west); expand later if it goes well. Vending machines get a **front photo every round** (products + prices visible; lets us re-count sold-out slots and verify prices). The group-chat instructions were given in chat; `team-brief.html` is outdated.
- **Final collection scope (user, later 2026-11-07):** MSC 1st floor, **one collector (the user)**, 3 rounds (Sat 3 PM, Sat ~7 PM, Sun ~9 AM). Layers: **study places** (seats, seats taken, outlets, noise LAeq via NIOSH SLM), **vending** (photos only: front + payment panel; data read from photos later), **water fillers** (location, cold 1-3, working, counter + close-up photo), **microwaves** (units/working, clean 1-5 + photo, people waiting). **Restrooms dropped.**
- Repo rule: everything in the repo is English (UI, docs, comments, commits); talk to the user in Chinese.

## Open questions for the user
- Team size, phone types (iPhone/Android), and the noise app actually installed.
- Hosting the collection form: GitHub Pages needs a public repo (https is required for GPS/mic); alternatives are pending.
- Confirm the zone borders on site after R0.

## Build notes (2026-11-07 ~14:40)
- R0 collected by the user 13:42–14:11: 11 NIOSH SLM PDF reports + labels sent in WeChat (`data/raw/noise/labels.csv` maps file → place), annotated sign photo, full sign photo with the area legend (`data/areas.csv`). "sr 1" = study room in the Flag Room; red dots on the photo are slips and are ignored.
- Pipeline: `tools/parse_noise.py` → `data/noise.csv`. `data/places.csv` x/y are in the sign-photo pixel frame (2000×1379), the same frame as `assets/msc-floor1.svg` (traced by Claude; check alignment with `tools/overlay-check.html`).
- Photos: `data/raw/photos/<place_id>/R<n>-*.jpg` + `field-notes.csv` (user fills in). Before committing photos: check for faces and strip EXIF GPS. A merge step from field-notes.csv into `data/observations.csv` is still TODO.
- App v1 (DeepSeek, spec `specs/001-map-app.md`): `index.html`, `app.js`, `style.css`. Browser-tested by Claude on desktop and at 375 px: loads, no console errors, ranking/details/tooltips work. DeepSeek's sandbox could not run shell commands in this folder (SetNamedSecurityInfoW grantWrite error), so its acceptance commands were not run; Claude verified in the browser instead.
- v2 TODO: show area names from areas.csv; photo gallery; merge field-notes; Flag Room labels overlap; markers small on phones; a Flag Room within-room noise comparison.
- Local preview: `python -m http.server 8765 --bind 127.0.0.1` (the preview_start launch.json would have to live in the root `.claude/`, so it isn't used).

## App v2 (2026-11-07 evening, commit 695c483)
- **Front-end code is written by Claude, not DeepSeek (user rule).** Specs 002/003 were cancelled; they still describe the APIs.
- `iso.js`: SVG isometric 2.5D renderer (flat/3D toggle, grow-in rooms, `IsoMap.project/elevationAt/onFrame`). `model3d.js`: procedural Three.js r160 models (vending/water/microwave/printer) built from our data; lazy-loaded by the "View in 3D" button. Sketchfab was blocked (403), so there are no third-party models.
- `app.js`: loads all CSVs (photos/vending_items optional), markers at constant pixel size, quiet ranking with FLIP animation, vending search, details with photo lightbox and a measurement table with PDF links, water counter → bottles/hour.
- Photos: put them in `data/raw/photos/<place_id>/R<n>-*.jpg` + `field-notes.csv`, then run `.venv\Scripts\python.exe tools/ingest.py` (strips EXIF, resizes, fills photos.csv, merges notes). Vending products: Claude reads the photos → `data/vending_items.csv` with `source_photo`.
- v3 (user: "no big rounded cards, minimal, use an existing library"): map is MapLibre GL JS 4.7.1 (rooms parsed from assets/msc-floor1.svg into fake lon/lat GeoJSON, fill-extrusion; glyphs from demotiles.maplibre.org); iso.js removed; UI = full-bleed map + hairline sidebar, Inter font. The built-in browser pane pauses requestAnimationFrame when hidden, so MapLibre only renders while screenshots are taken; not a bug.
- **Sun Nov 8 later:** user liked v7. Added a 3D view (CSS 3D tilt + 12 stacked wall layers in plan2d.js; default on wide screens, 2D/3D button). Renamed to **MSC Study Guide** (user: the map has everything for studying); restrooms layer `R-1..3` from the directory-sign symbols (not inspected, said so in the UI). Demo film in `video/`: user rejected style 07 (sticker) as lazy → now **style 06 Shape Morph** (mg-styles-15 demo 08-morph): hero shape morphs A→circle→B per voice beat, colour-field blooms, parts regrow, text waits until its field covers the column, app screenshots inside the screen shape with circle wipes + cursor clicks. Beat times = cue starts + pauses inside each line (pause detection on voice.wav). edge-tts voice en-US-AndrewNeural. Build: `voice.py` → `capture.py` (server on :8765) → `render.py --stills 0` (writes out/beats.json) → `music.py` (bed + whoosh/pop per morph) → `render.py` → `video/out/msc-study-guide-demo.mp4` (not in git). Review with `render.py --stills t…` + ffmpeg tile contact sheets. Voiceover text in `video/script.json` mentions only R0/R1; update it if an R2 round is added. User asked for more of the real map: the hero icon `plan` is the traced outline of `assets/msc-floor1.svg` (affine 2.5D view: centre/zoom/rotation/tilt keys, rooms extruded, pins at places.csv x/y); runs at 10.6–18 s (walk route in measured order, R0 red / R1 blue), 38–48 s (25 places, noise colours, counters, vending), 55–69 s (lens: quietest Flag Room corner, flight to Aggie Stop, R0→R1 drop).
- **v7 (Sun Nov 8, user: "redo the page")**: Three.js map dropped (scene.js deleted; v4–v6 all rejected as ugly / cluttered). `plan2d.js` = flat SVG plan + HTML value pins (Airbnb price-pill pattern), own viewBox pan/zoom, single-link clusters for amenities, pin repulsion, area names placed by least pin overlap, compact pins + data-extent home view on phones. Light page, Aggie maroon accent, Geist fonts; top bar (search + round switch with times), floating layer chips, legend; side panel = 4 key numbers + one-sentence finding + ranked list with 40–75 dBA meters (grey line = range over rounds) + "Noise by round" in details. model3d.js viewer kept for amenities.
- v6 (user: "copy a GitHub project", picked neonplan3d / NextFloor): scene.js ports the neonplan3d look (MIT, credited in README): unlit MeshBasicMaterial + vertex fake light, additive cyan edges, faded ground grid, CSS radial sky, glass chips + cyan callout, Figtree/Bricolage fonts, dark-only page. Models = dark bodies + edge lines (model3d neonify). Recipe notes: scratchpad only; key numbers are in scene.js comments.
- v5 (user picked "clean white 3D", then called it ugly): same scene.js, now matte white massing model (MeshStandardMaterial, RoomEnvironment light, VSM soft shadows, GTAOPass AO, hairline EdgesGeometry), neutral minimal sidebar, abstract white figures. v4 was cartoon (rejected as ugly).
- v4 (user: "ugly, models clip", reference: github.com/Vincentwei1021/mg-styles-15 issue 4 = 3D cartoon style video): MapLibre dropped. `scene.js` renders the floor as a Three.js toon diorama (MeshToonMaterial + OutlineEffect, MapControls, CSS2D labels, Fredoka font). Rooms holding a place become flat tiles, empty rooms are blocks; models are shrunk/nudged so they never overlap blocks, markers or each other. Figures = people count (max 6 per place); ripples = noise band.
- Open: confirm Howdy room left/right placement.

## Status
- [x] Guide saved, ideas + prior-art research, concept chosen, team brief written.
- [ ] Collection tool (phone form → CSV), schema in team brief.
- [ ] Map app on clearly labeled demo data.
- [ ] README, METHODOLOGY, DATA_DICTIONARY, limitations, submission checklist, video plan.
