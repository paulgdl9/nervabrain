#!/usr/bin/env python3
"""Roll a demo vault forward so its content reads as "now".

A demo vault is written once and goes stale: the dashboard shows zero tasks
completed in the last 7 days and the newest brief is weeks old. This shifts
every date in the vault by a fixed number of days, in file names, front matter,
bodies and JSON, and rewrites French long dates and ISO week labels so they stay
consistent.

    python3 scripts/roll-demo-vault.py /path/to/vault [--anchor 2026-08-04]
                                       [--to 2026-08-17] [--days 14] [--exact]
                                       [--dry-run] [--self-check]

The anchor is the demo's own "today" (default: the newest 06-Daily/<date>.md).
The shift is snapped down to whole weeks so weekday names, week labels and
"Monday plan" content stay coherent; --exact opts out. Never run it on a real
vault: it rewrites every dated file in place.
"""
import argparse
import json
import os
import re
import sys
from datetime import date, timedelta

FR_DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
FR_MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
             "août", "septembre", "octobre", "novembre", "décembre"]

# Lookarounds, not \b: a date inside "2026-08-04T06:40:00" has no word boundary
# before the "T".
ISO_DATE = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")
ISO_WEEK = re.compile(r"\b(\d{4})-W(\d{2})\b")
COMPACT = re.compile(r"\b(\d{4})(\d{2})(\d{2})\b")
MONTH_FIELD = re.compile(r'("?month"?\s*:\s*"?)(\d{4})-(\d{2})(")')
# "semaine 31" is an ISO week number in a weekly review, but a plan week
# anywhere else, so it is only rewritten under 07-Weekly/.
WEEK_WORD = re.compile(r"\b([Ss]emaine)\s+(\d{1,2})\b")
FR_LONG = re.compile(
    r"\b(?:(" + "|".join(FR_DAYS) + r")\s+)?(\d{1,2})(er)?\s+(" + "|".join(FR_MONTHS) + r")\b",
    re.IGNORECASE,
)


def shift_iso(match, days):
    try:
        moved = date(int(match[1]), int(match[2]), int(match[3])) + timedelta(days=days)
    except ValueError:
        return match.group(0)
    return moved.isoformat()


def shift_week(match, days):
    try:
        monday = date.fromisocalendar(int(match[1]), int(match[2]), 1) + timedelta(days=days)
    except ValueError:
        return match.group(0)
    iso = monday.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def shift_compact(match, days):
    try:
        moved = date(int(match[1]), int(match[2]), int(match[3])) + timedelta(days=days)
    except ValueError:
        return match.group(0)
    return moved.strftime("%Y%m%d")


def shift_month_field(match, days):
    moved = date(int(match[2]), int(match[3]), 1) + timedelta(days=days)
    return f"{match[1]}{moved.year}-{moved.month:02d}{match[4]}"


def shift_fr_long(match, days, year):
    weekday, day, ordinal, month = match[1], int(match[2]), match[3], match[4]
    month_index = FR_MONTHS.index(month.lower()) + 1
    try:
        moved = date(year, month_index, day) + timedelta(days=days)
    except ValueError:
        return match.group(0)
    text = f"{moved.day}{'er' if ordinal and moved.day == 1 else ''} {FR_MONTHS[moved.month - 1]}"
    if weekday:
        name = FR_DAYS[moved.weekday()]
        text = f"{name[0].upper() + name[1:] if weekday[0].isupper() else name} {text}"
    return text


def roll_text(text, days, year, week_numbers=False):
    text = ISO_WEEK.sub(lambda m: shift_week(m, days), text)
    text = MONTH_FIELD.sub(lambda m: shift_month_field(m, days), text)
    text = ISO_DATE.sub(lambda m: shift_iso(m, days), text)
    text = COMPACT.sub(lambda m: shift_compact(m, days), text)
    text = FR_LONG.sub(lambda m: shift_fr_long(m, days, year), text)
    if week_numbers and days % 7 == 0:
        text = WEEK_WORD.sub(lambda m: f"{m[1]} {int(m[2]) + days // 7}", text)
    return text


def snap(days):
    """Whole weeks only, toward zero, so weekdays survive the roll."""
    return (abs(days) // 7) * 7 * (1 if days >= 0 else -1)


def find_anchor(vault):
    daily = os.path.join(vault, "06-Daily")
    dates = []
    if os.path.isdir(daily):
        for name in os.listdir(daily):
            match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})\.md", name)
            if match:
                dates.append(date.fromisoformat(match[1]))
    if not dates:
        sys.exit("No 06-Daily/<date>.md found: pass --anchor explicitly.")
    return max(dates)


def self_check():
    assert roll_text("date: 2026-08-04", 7, 2026) == "date: 2026-08-11"
    assert roll_text("week: 2026-W32", 7, 2026) == "week: 2026-W33"
    assert roll_text("20260804-090000-x.md", 7, 2026) == "20260811-090000-x.md"
    assert roll_text("Brief du mardi 4 août", 7, 2026) == "Brief du mardi 11 août"
    assert roll_text("le 1er août", 7, 2026) == "le 8 août"
    assert roll_text("created: 2026-07-28T06:40:00.000Z", 7, 2026) == "created: 2026-08-04T06:40:00.000Z"
    assert roll_text('"month": "2026-07"', 7, 2026) == '"month": "2026-07"'
    assert roll_text("id 23400000001", 7, 2026) == "id 23400000001"
    assert roll_text("2026-02-30", 7, 2026) == "2026-02-30"  # invalid date left alone
    assert roll_text("Revue de la semaine 31", 7, 2026, week_numbers=True) == "Revue de la semaine 32"
    assert roll_text("pic en semaine 10", 7, 2026) == "pic en semaine 10"  # plan week, untouched
    # A 13-day gap snaps down to one whole week.
    assert snap(13) == 7 and snap(-13) == -7 and snap(21) == 21
    print("self-check ok")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("vault")
    parser.add_argument("--anchor", help="the demo's current 'today' (default: newest daily note)")
    parser.add_argument("--to", help="date the anchor should become (default: today)")
    parser.add_argument("--days", type=int, help="explicit shift, overrides --anchor/--to")
    parser.add_argument("--exact", action="store_true", help="do not snap the shift to whole weeks")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()

    if args.self_check:
        self_check()
        return

    target = date.fromisoformat(args.to) if args.to else date.today()
    if args.anchor:
        anchor = date.fromisoformat(args.anchor)
    elif args.days is None:
        anchor = find_anchor(args.vault)
    else:
        anchor = target  # only used as the year for bare French dates
    days = args.days if args.days is not None else (target - anchor).days
    if not args.exact:
        days = snap(days)
    if days == 0:
        print("Nothing to roll: the vault is already within a week of the target.")
        return
    print(f"Rolling {args.vault} by {days:+} days (anchor {anchor} -> {anchor + timedelta(days=days)})")

    renames, touched = [], 0
    for folder, _, names in os.walk(args.vault):
        for name in names:
            if not (name.endswith((".md", ".json")) or name.startswith(".second-brain")):
                continue
            path = os.path.join(folder, name)
            with open(path, encoding="utf-8") as handle:
                original = handle.read()
            rolled = roll_text(original, days, anchor.year,
                               week_numbers="07-Weekly" in folder)
            if rolled != original:
                touched += 1
                if not args.dry_run:
                    with open(path, "w", encoding="utf-8") as handle:
                        handle.write(rolled)
            new_name = roll_text(name, days, anchor.year)
            if new_name != name:
                renames.append((path, os.path.join(folder, new_name)))

    # Two phases: rolling 2026-W29/W30/W31 forward by a week would otherwise
    # rename W29 onto the still-unrolled W30 and destroy it.
    for old, new in renames:
        print(f"  rename {os.path.relpath(old, args.vault)} -> {os.path.basename(new)}")
    if not args.dry_run:
        staged = []
        for old, new in renames:
            temp = f"{new}.rolling"
            os.rename(old, temp)
            staged.append((temp, new))
        for temp, new in staged:
            if os.path.exists(new):
                sys.exit(f"Refusing to overwrite {new}: two notes roll onto the same name.")
            os.rename(temp, new)

    # A rolled vault must stay parseable JSON where it was JSON.
    for folder, _, names in os.walk(args.vault):
        for name in names:
            if name.endswith(".json"):
                with open(os.path.join(folder, name), encoding="utf-8") as handle:
                    json.load(handle)

    print(f"{touched} file(s) rewritten, {len(renames)} renamed"
          + (" (dry run)" if args.dry_run else ""))


if __name__ == "__main__":
    main()
