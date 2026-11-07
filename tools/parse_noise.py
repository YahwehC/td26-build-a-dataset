"""Parse NIOSH SLM PDF reports into data/noise.csv.

Each report is one sound-level measurement exported from the NIOSH SLM iPhone app.
data/raw/noise/labels.csv maps every report file to a place_id; the label is what the
collector typed into the team chat right before sending that report.

Usage: python tools/parse_noise.py [--round R0]
"""
import argparse
import csv
import re
import sys
from datetime import datetime
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "noise"
OUT = ROOT / "data" / "noise.csv"

FIELDS = ["obs_id", "place_id", "round", "ts", "duration_s", "laeq_db", "lmax_db",
          "lcpeak_db", "device", "app", "source_file", "note"]


def num(pattern, text):
    m = re.search(pattern, text)
    return float(m.group(1)) if m else None


def parse_report(path):
    text = PdfReader(path).pages[0].extract_text().replace(" ", " ")
    # File name holds the export time with seconds: "Report 2026-11-07 13-42-45.pdf".
    m = re.search(r"(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})-(\d{2})", path.name)
    ts = datetime.strptime(" ".join(m.groups()), "%Y-%m-%d %H %M %S") if m else None
    dur = re.search(r"Measurement time \(hh:mm:ss\)\s*(\d+):(\d+):(\d+)", text)
    duration = int(dur.group(1)) * 3600 + int(dur.group(2)) * 60 + int(dur.group(3)) if dur else None
    return {
        "ts": ts.isoformat(timespec="seconds") if ts else "",
        "duration_s": duration,
        "laeq_db": num(r"LAeq\s*([\d.]+)\s*dB", text),
        "lmax_db": num(r"Max\. level\s*([\d.]+)\s*dB", text),
        "lcpeak_db": num(r"LCpeak\s*([\d.]+)\s*dB", text),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", default="R0", help="round id for reports without one in labels.csv")
    args = ap.parse_args()

    labels = list(csv.DictReader(open(RAW / "labels.csv", encoding="utf-8")))
    rows, problems = [], []
    for i, lab in enumerate(labels, 1):
        path = RAW / lab["file"]
        if not path.exists():
            problems.append(f"missing file {lab['file']}")
            continue
        r = parse_report(path)
        if r["laeq_db"] is None:
            problems.append(f"no LAeq in {lab['file']}")
        rows.append({
            "obs_id": f"N{i:03d}", "place_id": lab["place_id"],
            "round": lab.get("round") or args.round, **r,
            "device": "iPhone (collector 1)", "app": "NIOSH SLM",
            "source_file": f"data/raw/noise/{lab['file']}", "note": lab.get("note", ""),
        })
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} rows to {OUT.relative_to(ROOT)}")
    for p in problems:
        print("PROBLEM:", p, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
