import assert from "node:assert/strict";
import test from "node:test";
import { briefScheduleSlot } from "@/lib/brief-schedule";

test("brief schedule respects profile timezone, frequency and configured time", () => {
  const monday = new Date("2026-06-01T06:30:00Z");
  assert.equal(briefScheduleSlot(monday, "Europe/Zurich", "daily", "08:00"), "2026-06-01@08:00");
  assert.equal(briefScheduleSlot(monday, "Europe/Zurich", "daily", "09:00"), "");
  assert.equal(briefScheduleSlot(monday, "Europe/Zurich", "weekly", "08:00"), "2026-06-01@08:00");
  assert.equal(briefScheduleSlot(new Date("2026-06-02T06:30:00Z"), "Europe/Zurich", "weekly", "08:00"), "");
  assert.equal(briefScheduleSlot(monday, "Europe/Zurich", "monthly", "08:00"), "2026-06-01@08:00");
  assert.equal(briefScheduleSlot(monday, "Europe/Zurich", "twice_daily", "08:00", "09:00"), "2026-06-01@08:00");
  assert.equal(briefScheduleSlot(new Date("2026-06-01T08:30:00Z"), "Europe/Zurich", "twice_daily", "08:00", "10:00"), "2026-06-01@10:00");
  assert.equal(briefScheduleSlot(monday, "Europe/Zurich", "manual", "08:00"), "");
});
