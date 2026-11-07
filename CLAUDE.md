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
- Repo rule: everything in the repo is English (UI, docs, comments, commits); talk to the user in Chinese.

## Open questions for the user
- Team size, phone types (iPhone/Android), and the noise app actually installed.
- Hosting the collection form: GitHub Pages needs a public repo (https is required for GPS/mic); alternatives are pending.
- Confirm the zone borders on site after R0.

## Status
- [x] Guide saved, ideas + prior-art research, concept chosen, team brief written.
- [ ] Collection tool (phone form → CSV), schema in team brief.
- [ ] Map app on clearly labeled demo data.
- [ ] README, METHODOLOGY, DATA_DICTIONARY, limitations, submission checklist, video plan.
