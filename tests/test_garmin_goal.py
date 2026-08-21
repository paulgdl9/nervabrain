"""The Garmin sync must read the goal from plan-data.json.

Regression guard: when the objective moved to 08-Projects/Training/plan-data.json
the sync kept reading the removed goal.json, so plan_start was None and every
activity was written with week 0 -- which the dashboard filters on, leaving the
training page empty while sync-data.json looked healthy.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "garmin-sync-profile.py"


def load_module(vault: Path):
    os.environ["VAULT_PATH"] = str(vault)
    spec = importlib.util.spec_from_file_location(f"garmin_sync_{vault.name}", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_vault(root: Path, *, objective: dict | None = None, goal: dict | None = None,
               modules: dict | None = None, setup_raw: str | None = None) -> Path:
    if setup_raw is not None:
        (root / ".second-brain-setup.json").write_text(setup_raw)
    elif modules is not None:
        (root / ".second-brain-setup.json").write_text(json.dumps({"version": 1, "modules": modules}))
    if objective is not None:
        plan = root / "08-Projects/Training"
        plan.mkdir(parents=True, exist_ok=True)
        (plan / "plan-data.json").write_text(json.dumps({"version": 1, "objective": objective}))
    if goal is not None:
        legacy = root / "08-Projects/Trail-26K"
        legacy.mkdir(parents=True, exist_ok=True)
        (legacy / "goal.json").write_text(json.dumps(goal))
    return root


def test_objective_drives_the_week_numbers():
    with tempfile.TemporaryDirectory() as tmp:
        vault = make_vault(Path(tmp), objective={
            "title": "Objectif A",
            "start_date": "2026-01-05",
            "event_date": "2026-03-29",
        })
        m = load_module(vault)
        goal = m.load_goal()
        assert goal["plan_start"] == date(2026, 1, 5)
        assert goal["race_day"] == date(2026, 3, 29)
        # Weeks are 1-based; the dashboard matches plan weeks 1..12 on them.
        assert m.week_of(date(2026, 1, 5), goal["plan_start"]) == 1
        assert m.week_of(date(2026, 1, 12), goal["plan_start"]) == 2
        assert m.week_of(date(2026, 2, 23), goal["plan_start"]) == 8


def test_legacy_goal_json_still_works():
    with tempfile.TemporaryDirectory() as tmp:
        vault = make_vault(Path(tmp), goal={
            "title": "Objectif B",
            "planStart": "2026-01-19",
            "raceDay": "2026-03-29",
            "distanceKm": 21,
            "elevationM": 800,
        })
        m = load_module(vault)
        goal = m.load_goal()
        assert goal["plan_start"] == date(2026, 1, 19)
        assert goal["distance"] == 21
        assert m.week_of(date(2026, 1, 19), goal["plan_start"]) == 1


def test_objective_wins_over_legacy_goal():
    with tempfile.TemporaryDirectory() as tmp:
        vault = make_vault(
            Path(tmp),
            objective={"title": "Nouveau", "start_date": "2026-01-05", "event_date": "2026-03-29"},
            goal={"title": "Ancien", "planStart": "2025-09-01", "raceDay": "2025-11-30"},
        )
        m = load_module(vault)
        goal = m.load_goal()
        assert goal["plan_start"] == date(2026, 1, 5)
        assert goal["title"] == "Nouveau"


def test_no_goal_at_all_is_week_zero():
    with tempfile.TemporaryDirectory() as tmp:
        m = load_module(make_vault(Path(tmp)))
        goal = m.load_goal()
        assert goal["plan_start"] is None
        assert m.week_of(date(2026, 2, 23), goal["plan_start"]) == 0


def test_trail_module_off_disables_the_sync():
    with tempfile.TemporaryDirectory() as tmp:
        m = load_module(make_vault(Path(tmp), modules={"trail": False, "finance": True}))
        assert m.trail_module_enabled() is False
        # The gate runs before garminconnect is imported, so a profile with no
        # credentials stops here instead of failing against Garmin every cycle.
        assert m.main() == 0


def test_trail_sync_off_stops_the_import_but_not_the_module():
    with tempfile.TemporaryDirectory() as tmp:
        m = load_module(make_vault(Path(tmp), modules={"trail": True, "trailSync": False}))
        assert m.trail_module_enabled() is False
        assert m.main() == 0


def test_trail_module_on_keeps_the_sync():
    with tempfile.TemporaryDirectory() as tmp:
        m = load_module(make_vault(Path(tmp), modules={"trail": True}))
        assert m.trail_module_enabled() is True


def test_missing_or_broken_setup_leaves_the_sync_on():
    with tempfile.TemporaryDirectory() as tmp:
        assert load_module(make_vault(Path(tmp))).trail_module_enabled() is True
    with tempfile.TemporaryDirectory() as tmp:
        m = load_module(make_vault(Path(tmp), setup_raw="{ not json"))
        assert m.trail_module_enabled() is True
    with tempfile.TemporaryDirectory() as tmp:
        m = load_module(make_vault(Path(tmp), modules={"finance": True}))
        assert m.trail_module_enabled() is True


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("tous les tests passent")
