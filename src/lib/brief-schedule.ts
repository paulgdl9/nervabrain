import type { BriefFrequency } from "@/lib/vault";

export function briefScheduleSlot(
  now: Date,
  timeZone: string,
  frequency: BriefFrequency,
  briefTime: string,
  briefTime2 = "17:00",
) {
  if (frequency === "manual") return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const nowTime = `${parts.hour}:${parts.minute}`;
  const dueTimes = (frequency === "twice_daily" ? [briefTime, briefTime2] : [briefTime]).sort();
  const dueTime = dueTimes.filter((time) => time <= nowTime).at(-1);
  if (!dueTime) return "";
  if (frequency === "weekly" && parts.weekday !== "Mon") return "";
  if (frequency === "monthly" && parts.day !== "01") return "";
  return `${date}@${dueTime}`;
}
