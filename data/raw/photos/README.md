# Field photos

One folder per place (IDs match `data/places.csv` and the annotated sign photo in `data/raw/map/`):

| Folder | Place |
|---|---|
| `W-1` … `W-4` | Water fillers wf1–wf4 |
| `V-1` … `V-4` | Vending machines 1–4 (area 17, Vending/ATM) |
| `M-1` | Microwaves |
| `P-1` | Printers |

## How to add photos
1. Put each photo in its place's folder. Start the file name with the round, e.g. `R0-counter.jpg`, `R0-front.jpg`, `R1-counter.jpg`.
2. Write the values you read on site into `field-notes.csv`, one row per place per round:
   - `working`: y / n
   - `cold` (water): 1 room temperature, 2 cool, 3 cold
   - `counter` (water): the "bottles saved" number
   - `units`, `units_working`, `clean` (1–5), `waiting` (microwaves)
   - `time`: e.g. `14:20`
   - Vending values (prices, sold-out slots) are read from the photos later, so leave them blank.
3. No faces in any photo. Photos are checked and their location metadata (EXIF GPS) is removed before publishing.
