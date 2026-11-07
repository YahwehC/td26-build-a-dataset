# MSC Field Map

An interactive map of the Memorial Student Center (MSC) 1st floor at Texas A&M, built for the TAMU Datathon 2026
**Build-A-Dataset** challenge. Every value on the map was measured by our team in person during the event
(Nov 7–8, 2026): how loud each study place is, how many people are there, and where the water fillers,
vending machines, microwaves and printers are, with their condition.

The official Aggie Map shows which buildings have amenities. It has no indoor floor plan, no water fillers or
study places, and nothing that changes over time. Our map answers "where should I go right now?" with our own measurements.

## Run it
```bash
python -m http.server 8000
```
Then open http://localhost:8000. The app is static (HTML/CSS/JS, PapaParse from cdnjs), so it can also be served by GitHub Pages.

## Repository layout
| Path | What it is |
|---|---|
| `index.html`, `app.js`, `style.css` | The map app |
| `iso.js` | Turns the flat plan into an isometric 2.5D view (extruded rooms, flat/3D toggle) |
| `model3d.js` | Small 3D models of each amenity (Three.js), drawn by our code from our measurements, not from downloaded models |
| `data/photos.csv`, `data/photos/` | Our field photos (EXIF/GPS removed, resized), one row per photo |
| `data/vending_items.csv` | Products and prices, read by us from our vending-machine photos |
| `tools/ingest.py` | Processes raw photos and field notes of a round into `data/` |
| `tools/check_data.py` | Data-quality checks run after every round (IDs, ranges, counters, files) |
| `assets/msc-floor1.svg` | Schematic 1st-floor plan, hand-traced by us from a photo of the MSC directory sign |
| `data/places.csv` | Every place we logged, with its position on the plan |
| `data/noise.csv` | Sound-level measurements (one row per measurement) |
| `data/observations.csv` | Other measurements: people counts, filler counters, microwave and vending checks |
| `data/raw/noise/*.pdf` | Original NIOSH SLM reports, one per noise measurement, plus `labels.csv` (which report belongs to which place) |
| `data/raw/map/` | The annotated photo of the directory sign we used to locate every place |
| `tools/parse_noise.py` | Builds `data/noise.csv` from the raw PDF reports |
| `tools/overlay-check.html` | Dev check: overlays the traced plan and the place coordinates on the sign photo |

## How we collected the data
- **Where:** public areas of the MSC 1st floor, Texas A&M University, College Station. No restricted rooms.
- **Who:** one team member walked a fixed route through every study place and amenity on the floor.
- **When:** round R0 on Sat Nov 7, 2026, 13:42–14:11. Later rounds (Sat evening, Sun morning) follow the same route; see `round` in the data.
- **Locating places:** at the MSC directory sign we photographed the floor map and marked every place on it
  (`data/raw/map/`). We then traced a schematic plan (`assets/msc-floor1.svg`) in the same pixel frame, so each place's
  `x, y` comes straight from that annotated photo.
- **Noise:** iPhone with the free NIOSH SLM app (by the U.S. National Institute for Occupational Safety and Health).
  At each place: stand in the middle (or the named corner), phone at chest height, collector silent, measure about 20 s,
  export the report. We use **LAeq**, the A-weighted equivalent continuous level over the measurement, in dBA.
  Max level and LCpeak are kept too. Every number in `data/noise.csv` can be checked against its original PDF.
- **People:** a head count of everyone sitting or standing in the area at the time of the noise measurement.
- **Water fillers:** working (y/n), coldness (1 room temperature – 3 cold), and the "bottles saved" counter, with a
  close-up photo of the display. The counter difference between rounds gives bottles filled per hour.
- **Vending machines:** a photo of the whole front (products, prices) and of the payment panel; values are read from the photos.
- **Microwaves:** units, units working, cleanliness (1–5) and people waiting, plus a photo with no people in it.
- **Privacy:** we never photographed faces and never recorded who anyone was. People are only counted.

## Data dictionary
### `data/places.csv`
| Field | Meaning |
|---|---|
| `place_id` | Our ID. `S-` study place, `W-` water filler, `V-` vending, `M-` microwave, `P-` printer |
| `layer` | `study`, `water`, `vending`, `microwave`, `printer` |
| `name` | Short human name |
| `area` | Area number on the MSC directory sign (e.g. 9 = Flag Room) |
| `x`, `y` | Position in the plan's coordinate frame (pixels of the sign photo, 2000×1379) |
| `location_note` | Where exactly, in words |
| `seats_total`, `outlets` | Seats and reachable power sockets (study places) |
| `note` | Anything else |

### `data/noise.csv`
| Field | Meaning |
|---|---|
| `obs_id` | Measurement ID |
| `place_id` | Place measured (see `places.csv`) |
| `round` | Collection round (`R0` = first walk, Sat afternoon) |
| `ts` | Local time (America/Chicago) the report was exported, i.e. the end of the measurement |
| `duration_s` | Measurement length in seconds |
| `laeq_db` | A-weighted equivalent continuous sound level, dBA |
| `lmax_db` | Maximum level during the measurement, dB |
| `lcpeak_db` | C-weighted peak level, dB |
| `device`, `app` | Measuring device and app |
| `source_file` | The original report this row was parsed from |
| `note` | Collector's remark (e.g. "no one playing the piano") |

### `data/observations.csv`
| Field | Meaning |
|---|---|
| `obs_id`, `place_id`, `round`, `ts` | As above |
| `people` | People counted in the area |
| `seats_taken` | Seats with a person or their belongings |
| `working` | `y` / `n` |
| `cold` | Water coldness: 1 room temperature, 2 cool, 3 cold |
| `counter` | Water filler "bottles saved" counter reading |
| `units`, `units_working` | Microwaves present / working |
| `clean` | 1 (unusable) – 5 (spotless) |
| `waiting` | People waiting in line |
| `photo` | Path to the photo taken at this observation |
| `note` | Remarks |

### `data/photos.csv`
| Field | Meaning |
|---|---|
| `place_id`, `round` | As above |
| `file` | Processed photo path (`data/photos/<place_id>/...`) |
| `caption` | What the photo shows |
| `ts` | Time taken (from the photo, local time) |

### `data/vending_items.csv`
| Field | Meaning |
|---|---|
| `place_id`, `round` | Machine and round of the photo |
| `slot` | Slot code printed on the machine (e.g. `A3`) |
| `product`, `category`, `size` | Product as labelled, our category (drink, snack, …), size if shown |
| `price_usd` | Price shown for the slot |
| `sold_out` | `y` if the slot is empty in the photo |
| `source_photo` | The photo this row was read from, so every value can be checked |

## Processing a round
```bash
python tools/ingest.py        # photos: strip EXIF/GPS, resize, list in photos.csv; merge field-notes.csv
python tools/parse_noise.py   # noise PDFs -> data/noise.csv
python tools/check_data.py    # validation; exit code 1 on errors
```

## Limitations
- **One floor, one weekend.** Saturday and Sunday during a hackathon are not a typical weekday; game days
  next to Kyle Field change crowds a lot. Treat the numbers as snapshots, not averages.
- **Few rounds.** Each place was measured a handful of times, so the map shows what we saw at those times. It is not a prediction.
- **Phone sound meter.** The NIOSH SLM app on an iPhone is typically within a few dB of a sound level meter, but
  ours is not calibrated against one. All noise readings come from the same phone, so they are comparable with each other.
- **Short measurements.** About 20 s per place, so a single loud event (a conversation, someone playing the Flag Room piano) moves the value.
- **Schematic plan.** Traced by hand from a photo of the directory sign: positions are approximate and not to scale.
- **People counts** are a single collector's count and were taken at area level (e.g. one count for all of area 8).

## Data sources
- Primary data: collected by our team, see above.
- The floor layout is traced from the MSC directory sign photographed on site. Official MSC event floor plans
  (ucenter.tamu.edu) were consulted for orientation only and are not included.
- No public datasets, APIs or synthetic data are used.
