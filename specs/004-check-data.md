# 004: data-quality checker

Goal: one command that validates every CSV in `data/` after each collection round and prints a short report, so bad rows are caught before they reach the app. Exit code 1 if any ERROR.

## File
`tools/check_data.py` (stdlib only: csv, os, sys, datetime, re). Run from the repo root: `python tools/check_data.py`. First line of main: `sys.stdout.reconfigure(encoding='utf-8')`.

## Inputs (all under `data/`; headers are exact)
- `places.csv`: place_id,layer,name,area,x,y,location_note,seats_total,outlets,note
- `areas.csv`: area,name
- `noise.csv`: obs_id,place_id,round,ts,duration_s,laeq_db,lmax_db,lcpeak_db,device,app,source_file,note
- `observations.csv`: obs_id,place_id,round,ts,people,seats_taken,working,cold,counter,units,units_working,clean,waiting,photo,note
- `photos.csv` (may have only a header): place_id,round,file,caption,ts
- `vending_items.csv` (may have only a header): place_id,round,slot,product,category,size,price_usd,sold_out,source_photo,note

## Checks (ERROR unless marked WARN)
- Each file exists and its header matches exactly (column order too).
- places: unique place_id; layer in {study, water, vending, microwave, printer}; x in 0..2000, y in 0..1379 (numbers); area empty or an integer present in areas.csv; seats_total/outlets empty or int ≥ 0.
- Every place_id in the other files exists in places.csv.
- obs_id unique within noise.csv and within observations.csv.
- round matches `^R\d+$`.
- ts empty (WARN "missing time") or ISO `YYYY-MM-DDTHH:MM(:SS)?`; WARN if the date is not 2026-11-07 or 2026-11-08.
- noise: 30 ≤ laeq_db ≤ 120; lmax_db ≥ laeq_db; lcpeak_db ≥ lmax_db (WARN if violated); duration_s > 0; source_file exists on disk (path relative to repo root); WARN if the layer of the place is not study.
- observations: people, seats_taken, counter, units, units_working, waiting empty or int ≥ 0; working empty or y/n; cold empty or 1..3; clean empty or 1..5; units_working ≤ units; seats_taken ≤ places.seats_total when both are set; photo empty or the file exists.
- water counter: per place, sorted by ts, the counter must not decrease (ERROR).
- photos: file exists; WARN if a file under `data/photos/` is not listed in photos.csv.
- vending_items: price_usd empty or 0 < price ≤ 20; sold_out empty or y/n; source_photo exists; WARN on duplicate (place_id, round, slot).
- Coverage (WARN): for each round present anywhere, list places of layers study/water/vending/microwave with no data in that round.

## Output
One line per finding: `ERROR noise.csv row 4 (N007): lmax_db 40.1 < laeq_db 47.4`. Rows are numbered from 2 (row 1 is the header). Then a summary: `N errors, M warnings` + per-file row counts. Exit 1 if errors > 0, else 0.

## Acceptance
- `python tools/check_data.py` on the current repo: exit 0 (warnings allowed), prints the row counts.
- Copy `data/` to a temp dir, make places.csv x = 5000 on one row and noise.csv place_id = "NOPE" on one row; running the checker with `--data <tmpdir>` gives exit 1 and both errors. (Add an optional `--data` argument, default `data`; source_file/photo paths are resolved relative to the parent of the data dir.)
