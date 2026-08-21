export const DEFAULT_TIME_ZONE = "UTC";

function configuredTimeZone() {
  return (typeof process !== "undefined" && process.env.TIMEZONE) || DEFAULT_TIME_ZONE;
}

function calendarParts(date: Date, timeZone = configuredTimeZone()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function zonedCalendarDate(date: Date, timeZone?: string) {
  const { year, month, day } = calendarParts(date, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

export function todayISO(date = new Date(), timeZone?: string) {
  return isoDate(zonedCalendarDate(date, timeZone));
}

export function weekStartISO(date = new Date(), timeZone?: string) {
  const local = zonedCalendarDate(date, timeZone);
  const day = local.getUTCDay() || 7;
  local.setUTCDate(local.getUTCDate() - day + 1);
  return local.toISOString().slice(0, 10);
}

export function weekEndISO(date = new Date(), timeZone?: string) {
  const local = zonedCalendarDate(date, timeZone);
  const day = local.getUTCDay() || 7;
  local.setUTCDate(local.getUTCDate() + (7 - day));
  return local.toISOString().slice(0, 10);
}

export function weekId(date = new Date(), timeZone?: string) {
  const local = zonedCalendarDate(date, timeZone);
  const day = local.getUTCDay() || 7;
  local.setUTCDate(local.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(local.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((local.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${local.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function displayDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-CH", {
    timeZone: configuredTimeZone(),
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function displayDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-CH", {
    timeZone: configuredTimeZone(),
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
