#!/usr/bin/env python3
"""Validate the CSV files in data/ (or the directory passed with --data).

Run from the repository root:

    python tools/check_data.py
    python tools/check_data.py --data path/to/data

The script prints one line per finding, then an error/warning summary and the
row count of every input file.  It exits with status 1 if there is any ERROR.
"""

import csv
import datetime
import os
import re
import sys


FILES = (
    'places.csv',
    'areas.csv',
    'noise.csv',
    'observations.csv',
    'photos.csv',
    'vending_items.csv',
)

EXPECTED_HEADERS = {
    'places.csv': [
        'place_id', 'layer', 'name', 'area', 'x', 'y',
        'location_note', 'seats_total', 'outlets', 'note',
    ],
    'areas.csv': ['area', 'name'],
    'noise.csv': [
        'obs_id', 'place_id', 'round', 'ts', 'duration_s', 'laeq_db',
        'lmax_db', 'lcpeak_db', 'device', 'app', 'source_file', 'note',
    ],
    'observations.csv': [
        'obs_id', 'place_id', 'round', 'ts', 'people', 'seats_taken',
        'working', 'cold', 'counter', 'units', 'units_working', 'clean',
        'waiting', 'photo', 'note',
    ],
    'photos.csv': ['place_id', 'round', 'file', 'caption', 'ts'],
    'vending_items.csv': [
        'place_id', 'round', 'slot', 'product', 'category', 'size',
        'price_usd', 'sold_out', 'source_photo', 'note',
    ],
}

LAYERS = {'study', 'water', 'vending', 'microwave', 'printer'}
COVERAGE_LAYERS = {'study', 'water', 'vending', 'microwave'}
ALLOWED_DATES = {'2026-11-07', '2026-11-08'}

ROUND_RE = re.compile(r'^R\d+$')
TS_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$')
INT_RE = re.compile(r'^[+-]?\d+$')


class Report:
    """Collect findings and print them in the requested format."""

    def __init__(self):
        self.lines = []
        self.errors = 0
        self.warnings = 0

    def finding(self, level, filename, row_no=None, ident=None, message=''):
        if row_no is None:
            location = filename
        elif ident:
            location = '%s row %d (%s)' % (filename, row_no, ident)
        else:
            location = '%s row %d' % (filename, row_no)
        self.lines.append('%s %s: %s' % (level, location, message))

    def error(self, filename, row_no=None, ident=None, message=''):
        self.errors += 1
        self.finding('ERROR', filename, row_no, ident, message)

    def warn(self, filename, row_no=None, ident=None, message=''):
        self.warnings += 1
        self.finding('WARN', filename, row_no, ident, message)


class Table:
    """One parsed CSV file."""

    def __init__(self, name):
        self.name = name
        self.ok = False          # header matches exactly
        self.header = []
        self.rows = []           # [(row number, {column: value}), ...]
        self.count = 0           # data rows, including malformed ones


class Context:
    """Facts collected from places.csv and areas.csv."""

    def __init__(self):
        self.areas_ok = False
        self.area_ids = set()
        self.places_ok = False
        self.place_ids = set()
        self.place_order = []
        self.places = {}         # place_id -> row
        self.layers = {}         # place_id -> layer


def text(row, column):
    value = row.get(column)
    if value is None:
        return ''
    return value.strip()


def ident(row):
    for column in ('obs_id', 'place_id'):
        value = text(row, column)
        if value:
            return value
    return None


def to_int(value):
    if value == '' or not INT_RE.match(value):
        return None
    try:
        return int(value)
    except ValueError:
        return None


def disk_path(root, value):
    value = value.strip()
    if os.path.isabs(value):
        return value
    return os.path.join(root, value)


def load_table(report, data_dir, name):
    table = Table(name)
    path = os.path.join(data_dir, name)
    if not os.path.isfile(path):
        report.error(name, None, None, 'file not found: %s' % path)
        return table
    try:
        with open(path, 'r', newline='', encoding='utf-8-sig') as handle:
            reader = csv.reader(handle)
            try:
                header = next(reader)
            except StopIteration:
                report.error(name, 1, None, 'file is empty (header missing)')
                return table
            table.header = header
            expected = EXPECTED_HEADERS[name]
            if header == expected:
                table.ok = True
            else:
                report.error(
                    name, 1, None,
                    'header mismatch: expected %s, got %s' % (
                        ','.join(expected), ','.join(header)),
                )
            for row_no, raw in enumerate(reader, start=2):
                if not raw:
                    continue
                table.count += 1
                if len(raw) != len(header):
                    report.error(
                        name, row_no, None,
                        'row has %d fields, expected %d' % (
                            len(raw), len(header)),
                    )
                values = list(raw) + [''] * (len(header) - len(raw))
                row = dict(zip(header, values[:len(header)]))
                table.rows.append((row_no, row))
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        report.error(name, None, None, 'could not read file: %s' % exc)
        table.ok = False
    return table


def check_round(report, table_name, row_no, rid, row):
    value = text(row, 'round')
    if not ROUND_RE.match(value):
        report.error(
            table_name, row_no, rid,
            "round '%s' does not match ^R\\d+$" % value,
        )


def check_ts(report, table_name, row_no, rid, row):
    """Validate ts; return it when it is a usable ISO timestamp, else None."""
    value = text(row, 'ts')
    if value == '':
        report.warn(table_name, row_no, rid, 'missing time')
        return None
    if not TS_RE.match(value):
        report.error(
            table_name, row_no, rid,
            "ts '%s' is not ISO YYYY-MM-DDTHH:MM(:SS)" % value,
        )
        return None
    fmt = '%Y-%m-%dT%H:%M:%S' if len(value) == 19 else '%Y-%m-%dT%H:%M'
    try:
        datetime.datetime.strptime(value, fmt)
    except ValueError:
        report.error(
            table_name, row_no, rid,
            "ts '%s' is not a valid date/time" % value,
        )
        return None
    if value[:10] not in ALLOWED_DATES:
        report.warn(
            table_name, row_no, rid,
            'ts date %s is not 2026-11-07 or 2026-11-08' % value[:10],
        )
    return value


def check_place_ref(report, table_name, row_no, rid, row, ctx):
    place_id = text(row, 'place_id')
    if ctx.places_ok and place_id not in ctx.place_ids:
        report.error(
            table_name, row_no, rid,
            "place_id '%s' not in places.csv" % place_id,
        )


def number_field(report, table_name, row_no, rid, row, column):
    value = text(row, column)
    if value == '':
        report.error(table_name, row_no, rid, '%s is empty' % column)
        return None
    try:
        return float(value)
    except ValueError:
        report.error(
            table_name, row_no, rid,
            "%s '%s' is not a number" % (column, value),
        )
        return None


def nonneg_int_field(report, table_name, row_no, rid, row, column):
    value = text(row, column)
    if value == '':
        return None
    number = to_int(value)
    if number is None:
        report.error(
            table_name, row_no, rid,
            "%s '%s' is not an integer" % (column, value),
        )
        return None
    if number < 0:
        report.error(
            table_name, row_no, rid,
            '%s %d is negative' % (column, number),
        )
        return None
    return number


def ranged_int_field(report, table_name, row_no, rid, row, column, low, high):
    value = text(row, column)
    if value == '':
        return None
    number = to_int(value)
    if number is None:
        report.error(
            table_name, row_no, rid,
            "%s '%s' is not an integer" % (column, value),
        )
        return None
    if not low <= number <= high:
        report.error(
            table_name, row_no, rid,
            '%s %d outside %d..%d' % (column, number, low, high),
        )
        return None
    return number


def collect_areas(report, table, ctx):
    if not table.ok:
        return
    ctx.areas_ok = True
    for _row_no, row in table.rows:
        value = text(row, 'area')
        number = to_int(value)
        if number is not None:
            ctx.area_ids.add(str(number))


def check_places(report, table, ctx):
    if not table.ok:
        return

    seen = {}
    for row_no, row in table.rows:
        rid = ident(row)
        place_id = text(row, 'place_id')
        if not place_id:
            report.error('places.csv', row_no, rid, 'place_id is empty')
        elif place_id in seen:
            report.error(
                'places.csv', row_no, rid,
                'duplicate place_id (first at row %d)' % seen[place_id],
            )
        else:
            seen[place_id] = row_no

        layer = text(row, 'layer')
        if layer not in LAYERS:
            report.error(
                'places.csv', row_no, rid,
                "layer '%s' is not one of %s" % (
                    layer, ', '.join(sorted(LAYERS))),
            )

        for column, high in (('x', 2000), ('y', 1379)):
            value = text(row, column)
            if value == '':
                report.error('places.csv', row_no, rid, '%s is empty' % column)
                continue
            try:
                number = float(value)
            except ValueError:
                report.error(
                    'places.csv', row_no, rid,
                    "%s '%s' is not a number" % (column, value),
                )
                continue
            if not 0 <= number <= high:
                report.error(
                    'places.csv', row_no, rid,
                    '%s %s outside 0..%d' % (column, value, high),
                )

        area = text(row, 'area')
        if area:
            area_int = to_int(area)
            if area_int is None:
                report.error(
                    'places.csv', row_no, rid,
                    "area '%s' is not an integer" % area,
                )
            elif ctx.areas_ok and str(area_int) not in ctx.area_ids:
                report.error(
                    'places.csv', row_no, rid,
                    'area %s not in areas.csv' % area,
                )

        for column in ('seats_total', 'outlets'):
            value = text(row, column)
            if value == '':
                continue
            number = to_int(value)
            if number is None:
                report.error(
                    'places.csv', row_no, rid,
                    "%s '%s' is not an integer" % (column, value),
                )
            elif number < 0:
                report.error(
                    'places.csv', row_no, rid,
                    '%s %d is negative' % (column, number),
                )

    ctx.places_ok = True
    for _row_no, row in table.rows:
        place_id = text(row, 'place_id')
        if place_id and place_id not in ctx.places:
            ctx.places[place_id] = row
            ctx.place_order.append(place_id)
            ctx.place_ids.add(place_id)
            ctx.layers[place_id] = text(row, 'layer')


def check_noise(report, table, ctx, root):
    if not table.ok:
        return

    seen_obs = {}
    for row_no, row in table.rows:
        rid = ident(row)
        obs_id = text(row, 'obs_id')
        if obs_id:
            if obs_id in seen_obs:
                report.error(
                    'noise.csv', row_no, rid,
                    'duplicate obs_id (first at row %d)' % seen_obs[obs_id],
                )
            else:
                seen_obs[obs_id] = row_no

        check_round(report, 'noise.csv', row_no, rid, row)
        check_ts(report, 'noise.csv', row_no, rid, row)
        check_place_ref(report, 'noise.csv', row_no, rid, row, ctx)

        laeq = number_field(report, 'noise.csv', row_no, rid, row, 'laeq_db')
        lmax = number_field(report, 'noise.csv', row_no, rid, row, 'lmax_db')
        lcpeak = number_field(
            report, 'noise.csv', row_no, rid, row, 'lcpeak_db')

        if laeq is not None and not 30 <= laeq <= 120:
            report.error(
                'noise.csv', row_no, rid,
                'laeq_db %s outside 30..120' % text(row, 'laeq_db'),
            )
        if laeq is not None and lmax is not None and lmax < laeq:
            report.error(
                'noise.csv', row_no, rid,
                'lmax_db %s < laeq_db %s' % (
                    text(row, 'lmax_db'), text(row, 'laeq_db')),
            )
        if lmax is not None and lcpeak is not None and lcpeak < lmax:
            report.warn(
                'noise.csv', row_no, rid,
                'lcpeak_db %s < lmax_db %s' % (
                    text(row, 'lcpeak_db'), text(row, 'lmax_db')),
            )

        duration = number_field(
            report, 'noise.csv', row_no, rid, row, 'duration_s')
        if duration is not None and duration <= 0:
            report.error(
                'noise.csv', row_no, rid,
                'duration_s %s is not > 0' % text(row, 'duration_s'),
            )

        source_file = text(row, 'source_file')
        if source_file == '':
            report.error('noise.csv', row_no, rid, 'source_file is empty')
        elif not os.path.isfile(disk_path(root, source_file)):
            report.error(
                'noise.csv', row_no, rid,
                'source_file not found: %s' % source_file,
            )

        layer = ctx.layers.get(text(row, 'place_id'))
        if layer is not None and layer != 'study':
            report.warn(
                'noise.csv', row_no, rid,
                "place layer '%s' is not study" % layer,
            )


def check_observations(report, table, ctx, root):
    if not table.ok:
        return

    seen_obs = {}
    counters = {}
    for row_no, row in table.rows:
        rid = ident(row)
        obs_id = text(row, 'obs_id')
        if obs_id:
            if obs_id in seen_obs:
                report.error(
                    'observations.csv', row_no, rid,
                    'duplicate obs_id (first at row %d)' % seen_obs[obs_id],
                )
            else:
                seen_obs[obs_id] = row_no

        check_round(report, 'observations.csv', row_no, rid, row)
        ts = check_ts(report, 'observations.csv', row_no, rid, row)
        check_place_ref(report, 'observations.csv', row_no, rid, row, ctx)

        values = {}
        for column in (
                'people', 'seats_taken', 'counter', 'units',
                'units_working', 'waiting'):
            values[column] = nonneg_int_field(
                report, 'observations.csv', row_no, rid, row, column)

        working = text(row, 'working')
        if working and working not in ('y', 'n'):
            report.error(
                'observations.csv', row_no, rid,
                "working '%s' is not y/n" % working,
            )

        ranged_int_field(
            report, 'observations.csv', row_no, rid, row, 'cold', 1, 3)
        ranged_int_field(
            report, 'observations.csv', row_no, rid, row, 'clean', 1, 5)

        units = values['units']
        units_working = values['units_working']
        if units is not None and units_working is not None:
            if units_working > units:
                report.error(
                    'observations.csv', row_no, rid,
                    'units_working %d > units %d' % (units_working, units),
                )

        seats_taken = values['seats_taken']
        place_id = text(row, 'place_id')
        place = ctx.places.get(place_id)
        if seats_taken is not None and place is not None:
            seats_total = to_int(text(place, 'seats_total'))
            if seats_total is not None and seats_taken > seats_total:
                report.error(
                    'observations.csv', row_no, rid,
                    'seats_taken %d > places.seats_total %d' % (
                        seats_taken, seats_total),
                )

        photo = text(row, 'photo')
        if photo and not os.path.isfile(disk_path(root, photo)):
            report.error(
                'observations.csv', row_no, rid,
                'photo not found: %s' % photo,
            )

        counter = values['counter']
        if counter is not None and ts is not None:
            counters.setdefault(place_id, []).append(
                (ts, counter, row_no, rid))

    for place_id, items in counters.items():
        items.sort(key=lambda item: item[0])
        previous = None
        for item in items:
            if previous is not None and item[1] < previous[1]:
                report.error(
                    'observations.csv', item[2], item[3],
                    'counter %d decreased from %d (previous at %s)' % (
                        item[1], previous[1], previous[0]),
                )
            previous = item


def check_photos(report, table, ctx, root, data_dir):
    if not table.ok:
        return

    for row_no, row in table.rows:
        rid = ident(row)
        check_round(report, 'photos.csv', row_no, rid, row)
        check_ts(report, 'photos.csv', row_no, rid, row)
        check_place_ref(report, 'photos.csv', row_no, rid, row, ctx)

        filename = text(row, 'file')
        if filename == '':
            report.error('photos.csv', row_no, rid, 'file is empty')
        elif not os.path.isfile(disk_path(root, filename)):
            report.error(
                'photos.csv', row_no, rid,
                'file not found: %s' % filename,
            )

    listed = set()
    for _row_no, row in table.rows:
        filename = text(row, 'file')
        if filename:
            listed.add(os.path.normcase(
                os.path.abspath(disk_path(root, filename))))

    photo_dir = os.path.join(data_dir, 'photos')
    if os.path.isdir(photo_dir):
        for dirpath, dirnames, filenames in os.walk(photo_dir):
            dirnames.sort()
            for filename in sorted(filenames):
                full = os.path.abspath(os.path.join(dirpath, filename))
                if os.path.normcase(full) not in listed:
                    report.warn(
                        'photos.csv', None, None,
                        'photo file is not listed: %s' % os.path.relpath(
                            full, root),
                    )


def check_vending(report, table, ctx, root):
    if not table.ok:
        return

    seen = {}
    for row_no, row in table.rows:
        rid = ident(row)
        check_round(report, 'vending_items.csv', row_no, rid, row)
        check_place_ref(report, 'vending_items.csv', row_no, rid, row, ctx)

        price = text(row, 'price_usd')
        if price:
            try:
                price_value = float(price)
            except ValueError:
                price_value = None
            if price_value is None:
                report.error(
                    'vending_items.csv', row_no, rid,
                    "price_usd '%s' is not a number" % price,
                )
            elif not 0 < price_value <= 20:
                report.error(
                    'vending_items.csv', row_no, rid,
                    'price_usd %s outside (0, 20]' % price,
                )

        sold_out = text(row, 'sold_out')
        if sold_out and sold_out not in ('y', 'n'):
            report.error(
                'vending_items.csv', row_no, rid,
                "sold_out '%s' is not y/n" % sold_out,
            )

        source_photo = text(row, 'source_photo')
        if source_photo == '':
            report.error(
                'vending_items.csv', row_no, rid, 'source_photo is empty')
        elif not os.path.isfile(disk_path(root, source_photo)):
            report.error(
                'vending_items.csv', row_no, rid,
                'source_photo not found: %s' % source_photo,
            )

        key = (
            text(row, 'place_id'),
            text(row, 'round'),
            text(row, 'slot'),
        )
        if key in seen:
            report.warn(
                'vending_items.csv', row_no, rid,
                'duplicate (place_id, round, slot) (first at row %d)' % (
                    seen[key]),
            )
        else:
            seen[key] = row_no


def check_coverage(report, tables, ctx):
    if not ctx.places_ok:
        return

    rounds = set()
    data = set()
    for name in (
            'noise.csv', 'observations.csv', 'photos.csv',
            'vending_items.csv'):
        table = tables[name]
        if not table.ok:
            continue
        for _row_no, row in table.rows:
            round_name = text(row, 'round')
            place_id = text(row, 'place_id')
            if ROUND_RE.match(round_name):
                rounds.add(round_name)
            if place_id and round_name:
                data.add((place_id, round_name))

    def round_key(value):
        return int(value[1:])

    for round_name in sorted(rounds, key=round_key):
        missing = [
            place_id for place_id in ctx.place_order
            if ctx.layers.get(place_id) in COVERAGE_LAYERS
            and (place_id, round_name) not in data
        ]
        if missing:
            report.warn(
                'coverage', None, None,
                'round %s has no data for: %s' % (
                    round_name, ', '.join(missing)),
            )


def main(argv):
    sys.stdout.reconfigure(encoding='utf-8')

    data_dir = 'data'
    args = list(argv[1:])
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == '--data':
            if index + 1 >= len(args):
                sys.stderr.write('error: --data requires a directory\n')
                return 2
            data_dir = args[index + 1]
            index += 2
        elif arg.startswith('--data='):
            data_dir = arg.split('=', 1)[1]
            index += 1
        elif arg in ('-h', '--help'):
            sys.stdout.write(
                'usage: python tools/check_data.py [--data DIRECTORY]\n')
            return 0
        else:
            sys.stderr.write('error: unknown argument: %s\n' % arg)
            return 2

    root = os.path.dirname(os.path.abspath(data_dir))
    report = Report()
    ctx = Context()

    tables = {}
    for name in FILES:
        tables[name] = load_table(report, data_dir, name)

    collect_areas(report, tables['areas.csv'], ctx)
    check_places(report, tables['places.csv'], ctx)
    check_noise(report, tables['noise.csv'], ctx, root)
    check_observations(report, tables['observations.csv'], ctx, root)
    check_photos(report, tables['photos.csv'], ctx, root, data_dir)
    check_vending(report, tables['vending_items.csv'], ctx, root)
    check_coverage(report, tables, ctx)

    for line in report.lines:
        sys.stdout.write(line + '\n')
    sys.stdout.write('%d errors, %d warnings\n' % (
        report.errors, report.warnings))
    for name in FILES:
        sys.stdout.write('%s: %d rows\n' % (name, tables[name].count))

    return 1 if report.errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
