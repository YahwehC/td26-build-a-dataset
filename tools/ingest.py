"""Ingest field photos and field notes into the published dataset.

1. Photos: data/raw/photos/<place_id>/<R#-name>.(jpg|jpeg|png|webp)  ->  data/photos/<place_id>/<R#-name>.jpg
   - EXIF orientation applied, then ALL metadata (incl. GPS) dropped; longest side <= 1600 px; JPEG q=82.
   - Round = leading "R<digits>" of the file name (else "R0"). ts = EXIF DateTimeOriginal if present, else file mtime.
   - Writes data/photos.csv.
   Raw originals are git-ignored (they may contain GPS); only the cleaned copies are published.
2. Field notes: data/raw/photos/field-notes.csv rows that have at least one value filled
   -> rows with obs_id "F-<place>-<round>" in data/observations.csv (previous F- rows are replaced).

Usage: .venv\\Scripts\\python.exe tools/ingest.py
"""
import csv
import re
import sys
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "photos"
OUT = ROOT / "data" / "photos"
PHOTOS_CSV = ROOT / "data" / "photos.csv"
OBS_CSV = ROOT / "data" / "observations.csv"
PLACES_CSV = ROOT / "data" / "places.csv"
ROUND_DATE = {"R0": "2026-11-07", "R1": "2026-11-07", "R2": "2026-11-08"}
EXTS = {".jpg", ".jpeg", ".png", ".webp"}
VALUE_FIELDS = ["working", "cold", "counter", "units", "units_working", "clean", "waiting"]


def exif_time(img):
    try:
        raw = img.getexif().get_ifd(0x8769).get(36867) or img.getexif().get(306)
        return datetime.strptime(raw, "%Y:%m:%d %H:%M:%S").isoformat(timespec="seconds") if raw else ""
    except Exception:
        return ""


def ingest_photos(place_ids):
    rows, problems = [], []
    # Keep hand-written captions / times from an earlier run (re-ingest must not wipe them).
    old = {}
    if PHOTOS_CSV.exists():
        with open(PHOTOS_CSV, newline="", encoding="utf-8-sig") as f:
            old = {r["file"]: r for r in csv.DictReader(f)}
    for folder in sorted(p for p in RAW.iterdir() if p.is_dir()):
        if folder.name not in place_ids:
            problems.append(f"unknown place folder {folder.name}")
            continue
        for src in sorted(folder.iterdir()):
            if src.suffix.lower() not in EXTS:
                continue
            m = re.match(r"(R\d+)", src.stem, re.I)
            rnd = m.group(1).upper() if m else "R0"
            with Image.open(src) as im:
                # No EXIF (e.g. photos sent via chat apps) -> leave blank; file mtime is the transfer time, not the shot.
                ts = exif_time(im)
                im = ImageOps.exif_transpose(im).convert("RGB")
                im.thumbnail((1600, 1600))
                dst = OUT / folder.name / (src.stem + ".jpg")
                dst.parent.mkdir(parents=True, exist_ok=True)
                im.save(dst, "JPEG", quality=82, optimize=True)  # no exif= argument -> metadata dropped
            caption = re.sub(r"^R\d+[-_ ]*", "", src.stem).replace("-", " ").replace("_", " ").strip()
            if re.fullmatch(r"[0-9a-f]{16,}", caption, re.I):  # hash file names carry no meaning
                caption = ""
            file = dst.relative_to(ROOT).as_posix()
            prev = old.get(file, {})
            rows.append({"place_id": folder.name, "round": rnd, "file": file,
                         "caption": caption or prev.get("caption", ""), "ts": ts or prev.get("ts", "")})
    with open(PHOTOS_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["place_id", "round", "file", "caption", "ts"])
        w.writeheader()
        w.writerows(rows)
    return rows, problems


def ingest_notes(place_ids):
    notes_path = RAW / "field-notes.csv"
    if not notes_path.exists():
        return 0, []
    obs = list(csv.DictReader(open(OBS_CSV, encoding="utf-8-sig")))
    fields = list(obs[0].keys()) if obs else ["obs_id", "place_id", "round", "ts", "people", "seats_taken", "working",
                                              "cold", "counter", "units", "units_working", "clean", "waiting", "photo", "note"]
    obs = [r for r in obs if not r["obs_id"].startswith("F-")]
    added, problems = 0, []
    for r in csv.DictReader(open(notes_path, encoding="utf-8-sig")):
        if not any((r.get(k) or "").strip() for k in VALUE_FIELDS + ["note"]):
            continue
        pid, rnd = r["place_id"].strip(), (r.get("round") or "R0").strip().upper()
        if pid not in place_ids:
            problems.append(f"field-notes: unknown place {pid}")
            continue
        t = (r.get("time") or "").strip()
        ts = ""
        if t:
            try:
                hhmm = datetime.strptime(t.upper().replace(" ", ""), "%I:%M%p") if re.search(r"[AP]M", t, re.I) \
                    else datetime.strptime(t, "%H:%M")
                ts = f"{ROUND_DATE.get(rnd, '2026-11-07')}T{hhmm:%H:%M}:00"
            except ValueError:
                problems.append(f"field-notes: bad time '{t}' for {pid} {rnd}")
        row = {k: "" for k in fields}
        row.update({"obs_id": f"F-{pid}-{rnd}", "place_id": pid, "round": rnd, "ts": ts,
                    "note": (r.get("note") or "").strip()})
        for k in VALUE_FIELDS:
            row[k] = (r.get(k) or "").strip().lower() if k == "working" else (r.get(k) or "").strip()
        obs.append(row)
        added += 1
    with open(OBS_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(obs)
    return added, problems


def main():
    place_ids = {r["place_id"] for r in csv.DictReader(open(PLACES_CSV, encoding="utf-8-sig"))}
    photos, p1 = ingest_photos(place_ids)
    notes, p2 = ingest_notes(place_ids)
    print(f"photos: {len(photos)} written to data/photos/ and data/photos.csv")
    print(f"field notes: {notes} rows merged into data/observations.csv")
    for p in p1 + p2:
        print("PROBLEM:", p, file=sys.stderr)
    return 1 if p1 + p2 else 0


if __name__ == "__main__":
    sys.exit(main())
