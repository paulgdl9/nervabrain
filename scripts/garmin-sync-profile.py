#!/usr/bin/env python3
"""Generic Garmin sync for a profile's endurance journal.

The dashboard owns the goal in 08-Projects/Training/plan-data.json (field
"objective"), with the pre-migration 08-Projects/Trail-26K/goal.json kept as a
fallback for profiles that still carry it. This script only pulls Garmin
activities, writes the raw journal data, and refreshes the small custom-page
marker block. It deliberately contains no personal race plan.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

VAULT = Path(os.environ.get("VAULT_PATH", "/vault"))
TOKENSTORE = os.environ.get("GARMINTOKENS", str(Path.home() / ".garminconnect"))

PROJECT_DIR = VAULT / "08-Projects/Trail-26K"
SYNC_MD = PROJECT_DIR / "Sync.md"
SYNC_JSON = PROJECT_DIR / "sync-data.json"
FEEDBACK_JSON = PROJECT_DIR / "feedback-data.json"
PERFORMANCE_JSON = PROJECT_DIR / "performance-data.json"
GOAL_JSON = PROJECT_DIR / "goal.json"
PLAN_JSON = VAULT / "08-Projects/Training/plan-data.json"
SETUP_JSON = VAULT / ".second-brain-setup.json"
PAGE_MD = VAULT / "11-Custom/_registry/trail-26k.md"
MARK_START = "<!-- GARMIN-SYNC:START -->"
MARK_END = "<!-- GARMIN-SYNC:END -->"
DAY_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]


def parse_iso(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def positive_float(value: object) -> float | None:
    try:
        parsed = float(str(value or "").replace(",", "."))
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def trail_module_enabled() -> bool:
    """The dashboard's Modules settings own whether this sync should run.

    Unreadable or absent state means a profile that never went through setup,
    so the sync stays on rather than silently stopping.
    """
    try:
        raw = json.loads(SETUP_JSON.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return True
    modules = raw.get("modules")
    if not isinstance(modules, dict):
        return True
    # "trail" hides the training pages entirely; "trailSync" only stops the
    # import, so a profile can keep the pages without pulling from Garmin.
    for key in ("trail", "trailSync"):
        if key in modules and not modules[key]:
            return False
    return True


def load_plan_objective() -> dict:
    """The objective block the dashboard writes to plan-data.json."""
    try:
        raw = json.loads(PLAN_JSON.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    objective = raw.get("objective")
    return objective if isinstance(objective, dict) else {}


def load_goal() -> dict:
    try:
        raw = json.loads(GOAL_JSON.read_text(encoding="utf-8"))
    except Exception:
        raw = {}
    # plan-data.json is the live source of truth; goal.json only fills the gaps
    # it does not carry (distance, elevation, history window).
    objective = load_plan_objective()
    race_day = parse_iso(objective.get("event_date")) or parse_iso(raw.get("raceDay") or raw.get("race_day"))
    plan_start = parse_iso(objective.get("start_date")) or parse_iso(raw.get("planStart") or raw.get("plan_start"))
    history_start = parse_iso(raw.get("historyStart") or raw.get("history_start") or raw.get("syncStart") or raw.get("sync_start"))
    distance = positive_float(raw.get("distanceKm") or raw.get("distance_km"))
    elevation = positive_float(raw.get("elevationM") or raw.get("elevation_m"))
    if race_day and not plan_start:
        km, dplus = distance or 10.0, elevation or 0.0
        default_weeks = 16 if km >= 42 or dplus >= 1800 else 12 if km >= 21 or dplus >= 700 else 8 if km >= 10 or dplus >= 250 else 6
        plan_start = monday_of(race_day) - timedelta(weeks=default_weeks - 1)
    return {
        "title": str(objective.get("title") or raw.get("title") or "").strip(),
        "race_day": race_day,
        "plan_start": monday_of(plan_start) if plan_start else None,
        "history_start": history_start,
        "distance": distance,
        "elevation": elevation,
    }


def week_of(day: date, plan_start: date | None) -> int:
    if not plan_start:
        return 0
    return (day - plan_start).days // 7 + 1


def week_count(start: date | None, race_day: date | None) -> int:
    if not start or not race_day:
        return 0
    return max(1, min(52, (race_day - start).days // 7 + 1))


def esc(text: object) -> str:
    return str(text or "").replace("|", "/").replace("\n", " ").replace("\r", " ").strip()


def fmt_km(meters: float) -> str:
    return f"{meters / 1000:.2f}".replace(".", ",") + " km"


def fmt_dur(seconds: float) -> str:
    total = int(round(seconds))
    hours, rem = divmod(total, 3600)
    minutes, sec = divmod(rem, 60)
    return f"{hours}h{minutes:02d}" if hours else f"{minutes}'{sec:02d}"


def fmt_pace(meters: float, seconds: float) -> str:
    if not meters:
        return "-"
    spk = seconds / (meters / 1000)
    return f"{int(spk // 60)}:{int(spk % 60):02d}/km"


def act_date(act: dict) -> date:
    raw = act.get("startTimeLocal") or act.get("startTimeGMT") or ""
    return datetime.strptime(raw[:10], "%Y-%m-%d").date()


def kind_of(act: dict) -> str:
    key = (act.get("activityType") or {}).get("typeKey", "")
    if key in ("running", "trail_running", "track_running", "virtual_run", "indoor_running", "treadmill_running"):
        return "run"
    if "ride" in key or "cycling" in key:
        return "ride"
    if key == "strength_training":
        return "strength"
    return "other"


def first_value(source: dict, *keys: str):
    for key in keys:
        value = source.get(key)
        if value is not None:
            return value
    return None


def zone_items(source: dict, *keys: str) -> list[dict]:
    raw = first_value(source, *keys)
    if not isinstance(raw, list):
        return []
    zones: list[dict] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        seconds = first_value(item, "seconds", "duration", "timeInZone", "time_in_zone")
        if seconds is None:
            continue
        zones.append({
            "zone": first_value(item, "zone", "zoneNumber", "number") or index + 1,
            "label": first_value(item, "label", "name") or f"Z{index + 1}",
            "seconds": seconds,
            "percent": first_value(item, "percent", "percentage"),
            "low_boundary": first_value(item, "lowBoundary", "low_boundary", "min"),
            "high_boundary": first_value(item, "highBoundary", "high_boundary", "max"),
        })
    return zones


def summarize(act: dict) -> str:
    kind = kind_of(act)
    dist = float(act.get("distance") or 0.0)
    dur = float(act.get("duration") or 0.0)
    hr = act.get("averageHR")
    dplus = float(act.get("elevationGain") or 0.0)
    parts = [esc(act.get("activityName") or (act.get("activityType") or {}).get("typeKey") or "Activite")]
    if dist:
        parts.append(fmt_km(dist))
    if dur:
        parts.append(fmt_dur(dur))
    if kind == "run" and dist:
        parts.append(fmt_pace(dist, dur))
    if hr:
        parts.append(f"FC {int(hr)}")
    if dplus:
        parts.append(f"{int(dplus)} m D+")
    return " · ".join(parts)


FEELING_LABELS = {"great": "Excellent", "good": "Bien", "neutral": "Moyen", "hard": "Difficile"}


def load_feedback() -> dict[str, dict]:
    """Per-session RPE, pain and feeling, as entered in the Journal multisport.

    The watch never reports these, so without this join the generated journal
    carries no pain column at all and every reader (the user, the daily brief)
    concludes the sessions were never rated.
    """
    try:
        raw = json.loads(FEEDBACK_JSON.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    entries = raw.get("feedback") if isinstance(raw, dict) else None
    return {str(e.get("activityId")): e for e in entries or [] if isinstance(e, dict) and e.get("activityId")}


def feedback_for(feedback: dict[str, dict], act: dict) -> dict | None:
    # Entries saved before the sync emitted a numeric id are keyed on the
    # legacy composite form (legacyActivityKey in src/lib/trail.ts).
    key = (act.get("activityType") or {}).get("typeKey") or "activity"
    legacy = "::".join([act_date(act).isoformat(), key, (act.get("activityName") or "").strip()])[:240]
    return feedback.get(str(act.get("activityId"))) or feedback.get(legacy)


def feedback_cells(entry: dict | None) -> tuple[str, str]:
    if not entry:
        return "?", "?"
    pain, rpe = entry.get("pain"), entry.get("rpe")
    parts = [
        FEELING_LABELS.get(str(entry.get("feeling") or ""), ""),
        f"RPE {int(rpe)}" if isinstance(rpe, (int, float)) else "",
        esc(entry.get("note") or ""),
    ]
    return (
        f"{int(pain)}/10" if isinstance(pain, (int, float)) else "?",
        " · ".join(part for part in parts if part) or "?",
    )


def build_sync_md(today: date, acts: list[dict], goal: dict) -> str:
    now_iso = datetime.now().isoformat(timespec="seconds")
    feedback = load_feedback()
    by_month: dict[str, list[dict]] = {}
    for activity in acts:
        by_month.setdefault(act_date(activity).strftime("%Y-%m"), []).append(activity)
    parts = [
        "---",
        "type: log",
        'title: "Trail - Sync Garmin"',
        "status: active",
        "area: Sport",
        f"created: {today.isoformat()}",
        f"updated: {now_iso}",
        "generated_by: script:profile-trail-garmin-sync",
        "tags: [sport, trail, log, generated]",
        "---",
        "",
        "# Sync Garmin",
        "",
        "Fichier genere automatiquement depuis Garmin Connect. Ne pas editer :",
        "toute modification sera ecrasee a la prochaine synchronisation.",
        "Douleur et ressenti viennent du Journal multisport de l'application ;",
        "`?` signifie que la seance n'a pas encore ete notee.",
        f"Derniere generation : {now_iso}.",
        "",
    ]
    if goal["race_day"]:
        title = goal["title"] or "Objectif trail"
        parts.extend([f"Objectif : {title}", f"Date : {goal['race_day'].isoformat()}"])
        if goal["distance"]:
            parts.append(f"Distance : {goal['distance']:g} km")
        if goal["elevation"]:
            parts.append(f"D+ : {goal['elevation']:g} m")
        parts.append("")
    for month in sorted(by_month):
        parts.extend([f"## {month}", "", "| Date | Type | Activite | Distance | Duree | Allure | FC moy | D+ | Douleur | Ressenti |", "|---|---|---|---|---|---|---|---|---|---|"])
        for activity in sorted(by_month[month], key=lambda item: item.get("startTimeLocal") or ""):
            day = act_date(activity)
            key = (activity.get("activityType") or {}).get("typeKey", "?")
            dist = float(activity.get("distance") or 0.0)
            dur = float(activity.get("duration") or 0.0)
            hr = activity.get("averageHR")
            dplus = float(activity.get("elevationGain") or 0.0)
            pain, feeling = feedback_cells(feedback_for(feedback, activity))
            parts.append(
                "| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |".format(
                    f"{DAY_NAMES[day.weekday()]} {day.strftime('%d/%m')}",
                    kind_of(activity),
                    f"{esc(activity.get('activityName') or key)} ({key})",
                    fmt_km(dist) if dist else "-",
                    fmt_dur(dur) if dur else "-",
                    fmt_pace(dist, dur) if kind_of(activity) == "run" and dist else "-",
                    int(hr) if hr else "-",
                    f"{int(dplus)} m" if dplus else "-",
                    pain,
                    feeling,
                )
            )
        parts.append("")
    return "\n".join(parts) + "\n"


def build_json(acts: list[dict], goal: dict) -> str:
    items = []
    for activity in sorted(acts, key=lambda item: item.get("startTimeLocal") or ""):
        day = act_date(activity)
        dist = float(activity.get("distance") or 0.0)
        dur = float(activity.get("duration") or 0.0)
        items.append({
            "date": day.isoformat(),
            "week": week_of(day, goal["plan_start"]),
            "weekday": day.weekday(),
            "kind": kind_of(activity),
            "type": (activity.get("activityType") or {}).get("typeKey", ""),
            "name": (activity.get("activityName") or "").strip(),
            "km": round(dist / 1000, 3),
            "dur_s": round(dur, 1),
            "pace_s_per_km": round(dur / (dist / 1000), 1) if dist else None,
            "hr": int(activity["averageHR"]) if activity.get("averageHR") else None,
            "dplus": round(float(activity.get("elevationGain") or 0.0), 1),
            "avg_power": first_value(activity, "avgPower", "averagePower"),
            "normalized_power": first_value(activity, "normalizedPower", "normPower"),
            "calories": activity.get("calories"),
            "training_load": activity.get("activityTrainingLoad"),
            "max_hr": first_value(activity, "maxHR", "maxHr", "maxHeartRate"),
            "avg_cadence": first_value(activity, "averageRunningCadenceInStepsPerMinute", "avgRunCadence", "avgCadence"),
            "max_cadence": first_value(activity, "maxRunningCadenceInStepsPerMinute", "maxRunCadence", "maxCadence"),
            "avg_stride_length_cm": first_value(activity, "avgStrideLength", "averageStrideLength"),
            "vertical_oscillation_cm": first_value(activity, "vO", "verticalOscillation"),
            "vertical_ratio": first_value(activity, "verticalRatio"),
            "ground_contact_time_ms": first_value(activity, "avgGroundContactTime", "groundContactTime"),
            "aerobic_training_effect": first_value(activity, "aerobicTrainingEffect"),
            "anaerobic_training_effect": first_value(activity, "anaerobicTrainingEffect"),
            "training_effect_label": first_value(activity, "trainingEffectLabel", "trainingEffectMessage"),
            "stamina_start": first_value(activity, "staminaStart"),
            "stamina_end": first_value(activity, "staminaEnd"),
            "stamina_min": first_value(activity, "staminaMin"),
            "vo2_max": first_value(activity, "vO2MaxValue", "vo2MaxValue"),
            "hr_zones": zone_items(activity, "hrZones", "heartRateZones", "heart_rate_zones"),
            "power_zones": zone_items(activity, "powerZones", "power_zones"),
            "time_in_zone2_s": first_value(activity, "timeInZone2", "timeInZone2Seconds", "time_in_zone2_s"),
        })
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "history_start": goal["history_start"].isoformat() if goal["history_start"] else None,
        "plan_start": goal["plan_start"].isoformat() if goal["plan_start"] else None,
        "race_day": goal["race_day"].isoformat() if goal["race_day"] else None,
        "activities": items,
    }
    return json.dumps(payload, ensure_ascii=False, indent=1) + "\n"


def weekly_dates(start: date, today: date) -> list[date]:
    cursor = start
    out: list[date] = []
    while cursor <= today:
        out.append(cursor)
        cursor += timedelta(days=7)
    if today not in out:
        out.append(today)
    return out


def first_metric_item(data: object) -> dict | None:
    if isinstance(data, list) and data:
        return data[0] if isinstance(data[0], dict) else None
    if isinstance(data, dict):
        return data
    return None


def primary_status_item(data: object) -> dict | None:
    if not isinstance(data, dict):
        return None
    latest = ((data.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData") or {})
    if not isinstance(latest, dict) or not latest:
        return None
    values = [item for item in latest.values() if isinstance(item, dict)]
    return next((item for item in values if item.get("primaryTrainingDevice")), values[0] if values else None)


def compact_points(points: list[dict], value_keys: tuple[str, ...]) -> list[dict]:
    out: list[dict] = []
    last_value: tuple[object, ...] | None = None
    ordered = sorted(points, key=lambda item: item.get("date", ""))
    for index, point in enumerate(ordered):
        value = tuple(point.get(key) for key in value_keys)
        if value == last_value and index != len(ordered) - 1:
            continue
        out.append(point)
        last_value = value
    return out


def build_performance_json(api, acts: list[dict], goal: dict, today: date) -> str:
    start = goal["history_start"] or date(today.year, 1, 1)
    run_dates = {act_date(activity) for activity in acts if kind_of(activity) == "run"}
    metric_dates = sorted(run_dates | set(weekly_dates(start, today)) | {today})
    status_dates = weekly_dates(start, today)

    vo2_history: list[dict] = []
    for day in metric_dates:
        try:
            metric = first_metric_item(api.get_max_metrics(day.isoformat()))
        except Exception as exc:  # noqa: BLE001
            print(f"[sync] performance max metrics skipped {day}: {type(exc).__name__}", file=sys.stderr)
            continue
        generic = (metric or {}).get("generic") or {}
        if not isinstance(generic, dict):
            continue
        precise = generic.get("vo2MaxPreciseValue")
        rounded = generic.get("vo2MaxValue")
        if precise is None and rounded is None:
            continue
        vo2_history.append({
            "date": str(generic.get("calendarDate") or day.isoformat()),
            "value": rounded,
            "precise": precise,
        })

    training_status_history: list[dict] = []
    for day in status_dates:
        try:
            status = primary_status_item(api.get_training_status(day.isoformat()))
        except Exception as exc:  # noqa: BLE001
            print(f"[sync] training status skipped {day}: {type(exc).__name__}", file=sys.stderr)
            continue
        if not status:
            continue
        acute = status.get("acuteTrainingLoadDTO") or {}
        if not isinstance(acute, dict):
            acute = {}
        training_status_history.append({
            "date": str(status.get("calendarDate") or day.isoformat()),
            "phrase": status.get("trainingStatusFeedbackPhrase"),
            "trainingStatus": status.get("trainingStatus"),
            "fitnessTrend": status.get("fitnessTrend"),
            "acuteLoad": acute.get("dailyTrainingLoadAcute"),
            "chronicLoad": acute.get("dailyTrainingLoadChronic"),
            "acwr": acute.get("dailyAcuteChronicWorkloadRatio"),
            "acwrStatus": acute.get("acwrStatus"),
        })

    readiness = None
    try:
        raw_readiness = api.get_morning_training_readiness(today.isoformat())
    except Exception as exc:  # noqa: BLE001
        print(f"[sync] readiness skipped {today}: {type(exc).__name__}", file=sys.stderr)
        raw_readiness = None
    if isinstance(raw_readiness, dict):
        readiness = {
            "date": raw_readiness.get("calendarDate"),
            "score": raw_readiness.get("score"),
            "level": raw_readiness.get("level"),
            "sleepScore": raw_readiness.get("sleepScore"),
            "hrvWeeklyAverage": raw_readiness.get("hrvWeeklyAverage"),
            "recoveryTimeMinutes": raw_readiness.get("recoveryTime"),
        }

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "history_start": start.isoformat(),
        "vo2_history": compact_points(vo2_history, ("value", "precise")),
        "training_status_history": compact_points(training_status_history, ("phrase", "trainingStatus", "acuteLoad", "acwrStatus")),
        "readiness": readiness,
    }
    return json.dumps(payload, ensure_ascii=False, indent=1) + "\n"


def build_marker_block(today: date, acts: list[dict], goal: dict) -> str:
    recent = sorted([activity for activity in acts if act_date(activity) >= today - timedelta(days=7)], key=lambda item: item.get("startTimeLocal") or "", reverse=True)
    stamp = datetime.now().strftime("%d/%m/%Y %H:%M")
    lines = [MARK_START, ""]
    if goal["race_day"]:
        weeks_total = week_count(goal["plan_start"], goal["race_day"])
        days_left = max(0, (goal["race_day"] - today).days)
        title = goal["title"] or "Objectif trail"
        if goal["plan_start"] and today < goal["plan_start"]:
            lines.append(f"**{title}** · J-{days_left} · plan a partir du {goal['plan_start'].strftime('%d/%m')}")
        else:
            week = max(1, min(weeks_total or 1, week_of(today, goal["plan_start"])))
            lines.append(f"**{title}** · J-{days_left} · Semaine **{week} / {weeks_total}**")
    else:
        lines.append("**Objectif trail a definir** · le journal Garmin est pret.")
    lines.extend(["", "| Date | Activite | Resume |", "|---|---|---|"])
    for activity in recent[:10]:
        day = act_date(activity)
        lines.append(f"| {DAY_NAMES[day.weekday()]} {day.strftime('%d/%m')} | {kind_of(activity)} | {summarize(activity)} |")
    if not recent:
        lines.append("| - | - | Aucune activite recente synchronisee |")
    lines.extend(["", f"*Derniere sync Garmin : {stamp} (auto)*", "", MARK_END])
    return "\n".join(lines)


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".sync-tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def check_no_dashes(content: str) -> str:
    return content.replace("—", "-").replace("–", "-")


def ensure_page() -> str:
    if PAGE_MD.exists():
        return PAGE_MD.read_text(encoding="utf-8")
    return "\n".join([
        "---",
        "type: custom-page",
        'title: "Trail"',
        "slug: trail-26k",
        'icon: "mountain"',
        "status: active",
        f"created: {datetime.now().isoformat(timespec='seconds')}",
        f"updated: {datetime.now().isoformat(timespec='seconds')}",
        "tags: [sport, trail]",
        "daily: false",
        "---",
        "# Trail",
        "",
        "## Journal Garmin",
        "",
        MARK_START,
        MARK_END,
        "",
        "## Notes",
        "",
        "Cette page contient uniquement le bloc que le script Garmin peut mettre a jour.",
    ]) + "\n"


def update_marker(today: date, acts: list[dict], goal: dict) -> None:
    page = ensure_page()
    if MARK_START not in page or MARK_END not in page:
        page = page.rstrip() + f"\n\n## Journal Garmin\n\n{MARK_START}\n{MARK_END}\n"
    block = build_marker_block(today, acts, goal)
    new_page = re.sub(
        re.escape(MARK_START) + r".*?" + re.escape(MARK_END),
        lambda _: block,
        page,
        count=1,
        flags=re.DOTALL,
    )
    new_page = re.sub(
        r"^updated: .*$",
        f"updated: {datetime.now().isoformat(timespec='seconds')}",
        new_page,
        count=1,
        flags=re.MULTILINE,
    )
    atomic_write(PAGE_MD, check_no_dashes(new_page))


def main() -> int:
    if not trail_module_enabled():
        # Never reach Garmin when the module is off: a profile with no
        # credentials would otherwise retry and fail on every schedule.
        print("[sync] trail module disabled in settings, nothing to do")
        return 0

    from garminconnect import Garmin

    today = date.today()
    goal = load_goal()
    start = goal["history_start"] or goal["plan_start"] or (today - timedelta(days=90))
    api = Garmin()
    api.login(TOKENSTORE)
    acts = api.get_activities_by_date(start.isoformat(), today.isoformat())
    print(f"[sync] {len(acts)} activities since {start}")

    atomic_write(SYNC_MD, check_no_dashes(build_sync_md(today, acts, goal)))
    print(f"[sync] wrote {SYNC_MD}")

    atomic_write(SYNC_JSON, build_json(acts, goal))
    print(f"[sync] wrote {SYNC_JSON}")

    try:
        atomic_write(PERFORMANCE_JSON, build_performance_json(api, acts, goal, today))
        print(f"[sync] wrote {PERFORMANCE_JSON}")
    except Exception as exc:  # noqa: BLE001
        print(f"[sync] WARNING performance data skipped: {type(exc).__name__}: {exc}", file=sys.stderr)

    update_marker(today, acts, goal)
    print(f"[sync] updated marker block in {PAGE_MD}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[sync] ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
