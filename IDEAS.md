# Build-A-Dataset: ideas considered (drafted 2026-11-07 11:45)

> **Current direction (latest, 2026-11-07 afternoon):** a multi-layer interactive MSC map with **water fillers, restrooms, microwaves and vending machines**. Each layer has something we re-measure over time: filler "bottles saved" counters, sold-out vending slots, microwave queues at mealtimes, restroom supplies.
> **Light study spots** (8–10 big lounges, seats taken only, noise optional) are still undecided. Optional extra: a few small Gaussian-splat 3D previews of key spots (Scaniverse capture, in-browser viewer); the main app stays a 2D map.
> The ideas below are the earlier options and research.

Official key points (see `GUIDE.txt`):
- The primary data must be **collected by the team during the event**, from the real world. Public data and APIs may only supplement it. **No fabrication**; simulated or estimated values must be labeled.
- It must be an **interactive application** (web page, map, tool, game), and the data must drive its core feature.
- Submission (Devpost): a public GitHub repo (code, dataset CSV, README with run steps, collection methodology, data dictionary, limitations) plus a **~2-minute video** (where and how we collected → what the data contains → app demo).
- Judging, 5 × 20 points: collection quality and rigor / app functionality and data integration / creativity / usefulness and treatment of limitations / communication and documentation.
- Timing: now is Saturday noon; the deadline is Sunday 12:00. Collection window ≈ Sat 14:00 to Sun 10:00.

---

## A. MSC Study-Spot Finder
**Question:** where in the MSC is the best place to study right now: quiet, with outlets and free seats, fitting a group?

**Two tables**
1. `zones.csv`, recorded once per area (about 15–25 public seating areas in the MSC, optionally Evans/ZACH):
   `zone_id, building, floor, name, seats_total, outlets_reachable, seat_type(table/soft/booth/counter), group_max, natural_light(y/n), food_ok(y/n), lat, lon, photo(no people)`
2. `observations.csv`, one patrol round covers every area:
   `obs_id, ts(auto), observer, device, zone_id, people_count, seats_occupied, noise_dba(10 s average), lux(optional), wifi_mbps(optional), notes`

**Sampling plan:** a fixed route at Sat 14, 17, 20, 23 h and Sun 02 (optional), 08, 10 h → 6–7 rounds × ~20 areas ≈ **120–140 observations**. Each round is about 20–25 minutes for one person.

**Quality control:**
- fixed route order;
- form with an area dropdown, automatic timestamp and range validation;
- noise always measured with the same phone, or a side-by-side comparison of two phones at the start to get an offset;
- each round, a second person independently recounts 2 random areas, giving an agreement measure;
- only people counts are recorded: no photos of people, no identities.

**App:** a "where to study now / at time X" recommender. Filters (quiet / outlets / group size / time) → area ranking, hourly crowding and noise curves, floor-plan heat colors, area detail page. Limitation: a weekend hackathon crowd ≠ a normal weekday.

**Pros:** collected inside the venue, no long walks, easiest to execute; very practical. **Cons:** "noise / study space finder" is one of the official examples, so originality has to come from multiple dimensions, the 24-hour curves and in-browser noise measurement.

## B. Refill Radar (water bottle filler map)
**Question:** where is the nearest working filler with fast flow and a filter that hasn't expired? Which ones are used most?

`stations.csv`: `station_id, building, floor, location_desc, type(bottle-filler/fountain/both), working(y/n), filter_led(green/yellow/red/none), bottle_counter, counter_ts, fill_500ml_s(mean of two), cold_rating(1–3), ada_height(y/n), lat, lon, photo`
- Walk all stations Saturday afternoon and **read the counters again** Sunday morning → uses per station per hour (the "bottles saved" counter on the filler).
- Scale: the MSC plus 4–6 nearby buildings ≈ 30–50 stations.

**App:** a map with "nearest good filler", a flow-speed ranking, a list of filters that need replacing (could be reported to the university) and a usage heat map.
**Pros:** the most original; the counter difference is a clever free sensor. **Cons:** other buildings may be locked on the weekend, so the sample could be small; requires walking.

## C. Accessible Aggieland (accessible entrance audit)
**Question:** which entrances around the MSC are truly accessible?

`entrances.csv`: `entrance_id, building, side, step_free(y/n), ramp_slope_deg(phone level), ada_ok(slope ≤ 4.8°), auto_door_button(y/n/broken), open_delay_s, stay_open_s, door_width_in(tape measure / phone measure), surface(smooth/cracked), lat, lon, photo`
- Scale: about 40 entrances in the MSC and 6–8 surrounding buildings; a pair of people for 3–4 hours.

**App:** an accessible-route map that filters entrances by need (wheelchair, stroller, crutches) and flags broken buttons and too-steep ramps.
**Pros:** strong social impact and rigorous measurement (slope against the ADA 1:12 standard). **Cons:** needs a tape measure and a lot of walking; doors may be locked on the weekend, so buttons can't be tested.

---

## Options without walking (second round)
- **D. Datathon all-nighter reaction test (Sleep Debt Meter):** consenting participants take a 30-second reaction test on our phone or laptop (median of 5 tries), then answer anonymously: hours awake, cups of coffee or energy drinks today, hours slept. Ask 15–20 people 3–4 times between Saturday afternoon and Sunday morning → 60–100 people.
  - App: take the test yourself, see your rank among people awake as long as you, see the room's reaction-time curve vs hours awake, and whether you should go sleep. The collection tool is the app itself. Optional phone-gyroscope "steady hands" test.
  - Risk: judges may see the data as coming from a screen, so the video must show in-person table-by-table invitations and a uniform protocol.
  - Rejected by the user: too little interactivity.
- **E. Datathon food queue prediction:** at event mealtimes (Sat dinner, midnight snack, Sun breakfast), record the queue length every 3–5 minutes and time a sample of people from joining the line to getting food → "how long will I wait if I go now". Venue only, tied to the event's meal times. Small dataset (10–20 rows per meal).
- **F. MSC food value:** photograph menu boards and prices of MSC restaurants (menus only, no people), enter price, portion and calories/protein where posted → a "most filling / most protein under $10" recommender. About 1 hour, MSC food court only.
  - Risk: some places close on weekends; the data is mostly transcription, with little measurement.

## Prior-art research (2026-11-07, DuckDuckGo)
- **Study spots / noise (A), many look-alikes:** Devpost "StudySpot" (noise + crowd color map), "Study Hall Checker" (VT building occupancy) and several GitHub Campus-Study-Spot-Finder repos. TAMU Libraries already have an "Explore" study-space floor plan and "How busy are the libraries?". → A has low originality, but the MSC is not part of the library system.
- **Water fillers (B):** Penn's official refill map, a BU CS506 course project, and a Devpost project with the same name "Refill Radar" (rename needed). TAMU fillers do have a "Plastic Bottles Saved" counter (Waymarking lists one in Schuhmacher Hall), but **we found no official TAMU filler map**. Nobody we found uses two counter readings to estimate usage.
- **Accessibility (C):** Devpost "Access Maps" (community reports of ramp and elevator issues), a GitHub Campus Accessibility Map; TAMU hosted a Diversity Accessibility Hackathon. Measured slopes compared with the ADA standard are rare.
- **What winners have in common:** a creative collection method.
  - DataHacks 2026 winner BioByte: a wearable that measures heat index and maps campus hot spots.
  - Packed: an ESP32 that estimates dining-hall crowding from Wi-Fi noise.
  - TrippinTracker: sensors strapped to a teammate who walked to record 500+ samples.

## Collection tool (shared approach)
A single-page phone web form: works offline and stores data on the phone, with one-tap export/share as CSV. It stamps the time automatically and has dropdowns and range checks. Option A also had a "measure noise for 10 s with the microphone" button (uncalibrated dBFS, comparable within one phone; the sound-meter app reading stays the primary value).
Hosting: GitHub Pages is the simplest (the submission needs a public repo anyway). Otherwise teammates open the HTML file saved on their phone, but the microphone and GPS need https, so noise would be entered by hand.
