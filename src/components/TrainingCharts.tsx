"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import { Activity, Bike, Dumbbell, Footprints } from "lucide-react";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLanguage } from "@/components/LanguageProvider";
import { TrailChartCard } from "@/components/TrailChartCard";
import { fmtDur, fmtKm, fmtMinutes, fmtPace } from "@/lib/trail-format";
import { dictionary, type Locale, type TranslationKey } from "@/lib/i18n";
import type { TrailActivity, TrailHealthDay, WeekStats } from "@/lib/trail";

// Charts are drawn in a viewBox matching the real container width instead of a
// fixed 780px canvas scaled down by CSS: on a phone that scaling shrank every
// label to ~5px. Drawing at native width keeps text readable and lets each
// chart adapt its padding and label density to the space it actually has.
function useMeasuredWidth(): [(node: HTMLDivElement | null) => void, number] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width || 0);
      setWidth((previous) => (Math.abs(previous - next) > 1 ? next : previous));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}

// Phone vs desktop pick two genuinely different layouts (scrub chart with a
// selection card vs bars with a docked panel), not just a scaled-down chart.
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    // Sync once on mount (SSR renders the desktop layout by default).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

// Objective band around the plan target (±10%), mirroring how the plan itself
// phrases weekly volume as a range rather than an exact number.
function targetBand(week: WeekStats, view: LoadView): { low: number; high: number } {
  const target = targetFor(week, view);
  return { low: Math.round(target * 0.9), high: Math.round(target * 1.1) };
}

export type LoadView = "all" | "run" | "ride" | "strength";

const VIEWS: Array<{ id: LoadView; label: TranslationKey; icon: React.ReactNode }> = [
  { id: "all", label: "training.chart.viewAll", icon: <Activity size={14} /> },
  { id: "run", label: "training.chart.viewRun", icon: <Footprints size={14} /> },
  { id: "ride", label: "training.chart.viewRide", icon: <Bike size={14} /> },
  { id: "strength", label: "training.chart.viewStrength", icon: <Dumbbell size={14} /> },
];

const PHASE_SHORT: Record<number, TranslationKey> = { 1: "training.chart.phaseBase", 2: "training.chart.phaseSpecific", 3: "training.chart.phaseTaper" };

function translated(locale: Locale, key: TranslationKey, values: Record<string, string | number> = {}): string {
  let result = dictionary(locale)[key];
  for (const [name, value] of Object.entries(values)) result = result.replace(`{${name}}`, String(value));
  return result;
}

// ---------------------------------------------------------------------------
// Scale helpers — every axis snaps to round values so grid lines, bars and
// labels all land on numbers a coach would actually say out loud.
// ---------------------------------------------------------------------------

function niceStep(range: number, candidates: number[], targetTicks = 4): number {
  for (const step of candidates) {
    if (range / step <= targetTicks) return step;
  }
  const last = candidates[candidates.length - 1];
  return last * Math.ceil(range / (last * targetTicks));
}

function ticksFromZero(max: number, candidates: number[], targetTicks = 4): { max: number; ticks: number[] } {
  const step = niceStep(Math.max(max, 1), candidates, targetTicks);
  const top = step * Math.max(1, Math.ceil(max / step));
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return { max: top, ticks };
}

function ticksBetween(min: number, max: number, candidates: number[], targetTicks = 4): { min: number; max: number; ticks: number[] } {
  const step = niceStep(Math.max(max - min, 1), candidates, targetTicks);
  const low = step * Math.floor(min / step);
  const high = step * Math.ceil(max / step);
  const ticks: number[] = [];
  for (let value = low; value <= high; value += step) ticks.push(value);
  return { min: low, max: high, ticks };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Monotone cubic interpolation (Fritsch–Carlson): smooth professional curve
// that never overshoots the data — a plain Catmull-Rom would invent dips and
// bumps between two runs, which is exactly what a precise chart must not do.
function monotonePath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  if (points.length === 1) return `M${round2(points[0].x)},${round2(points[0].y)}`;
  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x || 1;
    slope[i] = (points[i + 1].y - points[i].y) / dx[i];
  }
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  tangent[n - 1] = slope[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const f = 3 / Math.sqrt(s);
      tangent[i] = f * a * slope[i];
      tangent[i + 1] = f * b * slope[i];
    }
  }
  let d = `M${round2(points[0].x)},${round2(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = points[i].x + dx[i] / 3;
    const c1y = points[i].y + (tangent[i] * dx[i]) / 3;
    const c2x = points[i + 1].x - dx[i] / 3;
    const c2y = points[i + 1].y - (tangent[i + 1] * dx[i]) / 3;
    d += `C${round2(c1x)},${round2(c1y)} ${round2(c2x)},${round2(c2y)} ${round2(points[i + 1].x)},${round2(points[i + 1].y)}`;
  }
  return d;
}

function topRoundedRect(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height);
  if (height <= 0) return "";
  return `M${round2(x)},${round2(y + height)} L${round2(x)},${round2(y + r)} Q${round2(x)},${round2(y)} ${round2(x + r)},${round2(y)} L${round2(x + width - r)},${round2(y)} Q${round2(x + width)},${round2(y)} ${round2(x + width)},${round2(y + r)} L${round2(x + width)},${round2(y + height)} Z`;
}

function hourLabel(minutes: number): string {
  if (minutes === 0) return "0";
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return minutes < 60 ? `${minutes}'` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Load explorer data helpers
// ---------------------------------------------------------------------------

function targetFor(week: WeekStats, view: LoadView): number {
  const sessions = (week.plan as WeekStats["plan"] & {
    sessions?: Array<{ sport: string; durationMin: number | null }>;
  }).sessions || [];
  if (!sessions.length) return view === "run" || view === "all" ? week.plan.runMinTarget : 0;
  return sessions
    .filter((session) => view === "all" || session.sport === view)
    .reduce((total, session) => total + (session.durationMin || 0), 0);
}

function actualFor(week: WeekStats, view: LoadView) {
  if (view === "run") return week.runMin;
  if (view === "ride") return week.rideMin;
  if (view === "strength") return week.strengthMin;
  return week.totalMin;
}

function secondaryFor(week: WeekStats, view: LoadView) {
  if (view === "run") return week.runKm;
  if (view === "ride") return week.rideKm;
  if (view === "strength") return week.strength.length;
  return 0;
}

function averageHr(activities: TrailActivity[]) {
  const withHr = activities.filter((activity) => activity.hr);
  if (!withHr.length) return null;
  return Math.round(withHr.reduce((total, activity) => total + (activity.hr || 0), 0) / withHr.length);
}

export function weeklyViewMetrics(weeks: WeekStats[], view: LoadView, selectedWeek: number, locale: Locale = "fr") {
  const week = weeks.find((item) => item.plan.week === selectedWeek);
  if (!week) return [];
  if (view === "run") {
    const seconds = week.runMin * 60;
    return [
      { label: translated(locale, "training.chart.time"), value: fmtMinutes(week.runMin) },
      { label: translated(locale, "training.chart.distance"), value: fmtKm(week.runKm, 1, locale) },
      { label: translated(locale, "training.chart.elevation"), value: `${Math.round(week.runDplus)} m` },
      { label: translated(locale, "training.chart.averagePace"), value: week.runKm ? fmtPace(seconds / week.runKm) : "—" },
    ];
  }
  if (view === "ride") {
    const speed = week.rideMin ? week.rideKm / (week.rideMin / 60) : 0;
    return [
      { label: translated(locale, "training.chart.time"), value: fmtMinutes(week.rideMin) },
      { label: translated(locale, "training.chart.distance"), value: fmtKm(week.rideKm, 1, locale) },
      { label: translated(locale, "training.chart.elevation"), value: `${Math.round(week.rideDplus)} m` },
      { label: translated(locale, "training.chart.averageSpeed"), value: speed ? `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(speed)} km/h` : "—" },
    ];
  }
  if (view === "strength") {
    const hr = averageHr(week.strength);
    return [
      { label: translated(locale, "training.chart.time"), value: fmtMinutes(week.strengthMin) },
      { label: translated(locale, "training.chart.sessions"), value: String(week.strength.length) },
      { label: translated(locale, "training.chart.averageDuration"), value: week.strength.length ? fmtMinutes(week.strengthMin / week.strength.length) : "—" },
      { label: translated(locale, "training.chart.averageHeartRate"), value: hr ? `${hr} bpm` : "—" },
    ];
  }
  return [
    { label: translated(locale, "training.chart.totalTime"), value: fmtMinutes(week.totalMin) },
    { label: translated(locale, "training.chart.sessions"), value: String(week.activities.length) },
    { label: translated(locale, "training.chart.viewRun"), value: fmtKm(week.runKm, 1, locale) },
    { label: translated(locale, "training.chart.viewRide"), value: fmtKm(week.rideKm, 1, locale) },
  ];
}

function tooltipRows(week: WeekStats, view: LoadView, locale: Locale) {
  const label = (key: TranslationKey) => translated(locale, key);
  if (view === "run") {
    const hr = averageHr(week.runs);
    const pace = week.runKm ? fmtPace((week.runMin * 60) / week.runKm) : "—";
    return [
      [label("training.chart.time"), fmtMinutes(week.runMin)], [label("training.chart.target"), fmtMinutes(targetFor(week, view))],
      [label("training.chart.distance"), fmtKm(week.runKm, 1, locale)], [label("training.chart.elevation"), `${Math.round(week.runDplus)} m D+`],
      [label("training.chart.sessions"), String(week.runs.length)], [label("training.chart.averagePaceShort"), pace], [label("training.chart.averageHeartRate"), hr ? `${hr} bpm` : "—"],
    ];
  }
  if (view === "ride") {
    const hr = averageHr(week.rides);
    const speed = week.rideMin ? week.rideKm / (week.rideMin / 60) : 0;
    return [
      [label("training.chart.time"), fmtMinutes(week.rideMin)], [label("training.chart.target"), fmtMinutes(targetFor(week, view))],
      [label("training.chart.distance"), fmtKm(week.rideKm, 1, locale)], [label("training.chart.elevation"), `${Math.round(week.rideDplus)} m D+`],
      [label("training.chart.sessions"), String(week.rides.length)], [label("training.chart.averageSpeedShort"), speed ? `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(speed)} km/h` : "—"],
      [label("training.chart.averageHeartRate"), hr ? `${hr} bpm` : "—"],
    ];
  }
  if (view === "strength") {
    const hr = averageHr(week.strength);
    return [
      [label("training.chart.time"), fmtMinutes(week.strengthMin)], [label("training.chart.target"), fmtMinutes(targetFor(week, view))],
      [label("training.chart.sessions"), String(week.strength.length)], [label("training.chart.averageDurationShort"), week.strength.length ? fmtMinutes(week.strengthMin / week.strength.length) : "—"],
      [label("training.chart.averageHeartRate"), hr ? `${hr} bpm` : "—"],
    ];
  }
  return [
    [label("training.chart.totalLoad"), fmtMinutes(week.totalMin)], [label("training.chart.target"), fmtMinutes(targetFor(week, view))],
    [label("training.chart.viewRun"), fmtMinutes(week.runMin)], [label("training.chart.viewRide"), fmtMinutes(week.rideMin)],
    [label("training.chart.viewStrength"), fmtMinutes(week.strengthMin)], [label("training.chart.sessions"), String(week.activities.length)],
  ];
}

// ---------------------------------------------------------------------------
// Weekly load chart
// ---------------------------------------------------------------------------

function LoadChart({ weeks, view, currentWeek, activeIndex, setActiveIndex, width, locale }: {
  weeks: WeekStats[];
  view: LoadView;
  currentWeek: number;
  activeIndex: number | null;
  setActiveIndex: (index: number | null) => void;
  width: number;
  locale: Locale;
}) {
  const narrow = width < 520;
  const height = narrow ? 236 : 288;
  const left = narrow ? 34 : 46;
  const right = view === "all" ? (narrow ? 10 : 18) : (narrow ? 30 : 46);
  const top = 34;
  const bottom = narrow ? 40 : 44;
  const plotH = height - top - bottom;
  const plotW = width - left - right;
  const band = plotW / weeks.length;

  // Y axis snapped to round durations so grid lines mean something.
  const rawMax = Math.max(...weeks.map((week) => Math.max(actualFor(week, view), targetFor(week, view))), 1);
  const axis = ticksFromZero(rawMax, [15, 30, 60, 90, 120, 180, 240], 5);
  const y = (minutes: number) => top + plotH - (minutes / axis.max) * plotH;

  // Secondary axis (distance or session count), also snapped to round values.
  const secondaryCandidates = view === "strength" ? [1, 2, 3, 4, 5] : [2, 5, 10, 20, 25, 50, 100];
  const secondaryAxis = ticksFromZero(Math.max(...weeks.map((week) => secondaryFor(week, view)), 1), secondaryCandidates, 3);
  const secondaryY = (value: number) => top + plotH - (value / secondaryAxis.max) * plotH;
  const secondaryPoints = view === "all" ? [] : weeks
    .map((week, index) => ({ x: left + index * band + band / 2, y: secondaryY(secondaryFor(week, view)), value: secondaryFor(week, view) }))
    .filter((point) => point.value > 0);
  const secondaryPath = monotonePath(secondaryPoints);

  // Objective zone: a smooth band across the twelve weeks (±10% around the
  // plan target). Reads like a corridor to stay inside — clearer than the
  // previous stepped dashed line, and honest about the plan's tolerance.
  const bandCenters = weeks.map((_, index) => left + index * band + band / 2);
  const bandHigh = weeks.map((week, index) => ({ x: bandCenters[index], y: y(targetBand(week, view).high) }));
  const bandLow = weeks.map((week, index) => ({ x: bandCenters[index], y: y(targetBand(week, view).low) }));
  const bandPath = `${monotonePath(bandHigh)} L${round2(bandLow[bandLow.length - 1].x)},${round2(bandLow[bandLow.length - 1].y)} ${monotonePath([...bandLow].reverse()).replace(/^M/, "L")} Z`;

  // Narrow screens: one week label out of two is enough (they would collide),
  // and phase names shrink to one word. Parity anchored on the last week so
  // the final label always prints without colliding with its neighbour.
  const labelParity = (weeks.length - 1) % 2;
  const showWeekLabel = (index: number) => !narrow || index % 2 === labelParity;
  const phaseLabels: Record<number, string> = Object.fromEntries(
    Object.entries(PHASE_SHORT).map(([phase, key]) => [phase, translated(locale, key)]),
  );

  // Phase boundaries from the plan (flat → trail+D+ → peak/taper).
  const phaseMarks: Array<{ x: number; labelX: number; label: string }> = [];
  weeks.forEach((week, index) => {
    if (index === 0 || week.plan.phase !== weeks[index - 1].plan.phase) {
      const startX = left + index * band;
      let span = 0;
      for (let i = index; i < weeks.length && weeks[i].plan.phase === week.plan.phase; i++) span += 1;
      phaseMarks.push({ x: startX, labelX: startX + (span * band) / 2, label: phaseLabels[week.plan.phase] });
    }
  });

  const barW = band * 0.56;
  const currentIndex = weeks.findIndex((week) => week.plan.week === currentWeek);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={translated(locale, "training.chart.weeklyVolume", { discipline: translated(locale, VIEWS.find((item) => item.id === view)?.label ?? "training.chart.viewAll") })}>
      {/* Current-week backdrop, always visible (not only on hover) */}
      {currentIndex >= 0 && <rect x={left + currentIndex * band + 1.5} y={top - 4} width={band - 3} height={plotH + 4} rx="8" className="chart-current-column" />}

      {axis.ticks.map((tick) => (
        <g key={tick}>
          <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "chart-baseline" : "chart-grid-line"} />
          <text x={left - 9} y={y(tick) + 3.5} textAnchor="end" className="chart-axis-label">{hourLabel(tick)}</text>
        </g>
      ))}

      <path d={bandPath} className="chart-target-band" />

      {phaseMarks.map((mark, index) => (
        <g key={mark.label + index}>
          {index > 0 && <line x1={mark.x} x2={mark.x} y1={top - 14} y2={top + plotH} className="chart-phase-line" />}
          <text x={mark.labelX} y={top - 20} textAnchor="middle" className="chart-phase-label">{mark.label}</text>
        </g>
      ))}

      {weeks.map((week, index) => {
        const x = left + index * band + (band - barW) / 2;
        const base = top + plotH;
        const isActive = activeIndex === index;
        const gate = week.plan.gate;
        const common = (
          <>
            {gate && <path d={`M${round2(x + barW / 2)},${height - 33} l3.2,3.2 l-3.2,3.2 l-3.2,-3.2 Z`} className="chart-gate-marker"><title>{gate}</title></path>}
            {showWeekLabel(index) && <text x={x + barW / 2} y={height - 16} textAnchor="middle" className="chart-week-label">S{week.plan.week}</text>}
            {week.plan.week === currentWeek && <circle cx={x + barW / 2} cy={height - 6} r="2.4" className="chart-current-dot" />}
            <rect className="chart-hit-area" x={left + index * band} y={top - 14} width={band} height={plotH + bottom + 14} tabIndex={0} onPointerEnter={() => setActiveIndex(index)} onPointerDown={() => setActiveIndex(index)} onPointerLeave={() => setActiveIndex(null)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} />
          </>
        );
        if (view === "all") {
          // Stack from the baseline: strength, ride, run. Only the topmost
          // non-empty segment gets rounded corners so the stack reads as one bar.
          const segments = [
            { h: (week.strengthMin / axis.max) * plotH, cls: "chart-strength" },
            { h: (week.rideMin / axis.max) * plotH, cls: "chart-ride" },
            { h: (week.runMin / axis.max) * plotH, cls: "chart-run" },
          ].filter((segment) => segment.h > 0);
          let stackY = base;
          const rendered = segments.map((segment, segmentIndex) => {
            stackY -= segment.h;
            const isTop = segmentIndex === segments.length - 1;
            return isTop
              ? <path key={segment.cls} d={topRoundedRect(x, stackY, barW, segment.h, 4.5)} className={segment.cls} />
              : <rect key={segment.cls} x={x} y={stackY} width={barW} height={segment.h} className={segment.cls} />;
          });
          return (
            <g key={week.plan.week} className={`${week.plan.week === currentWeek ? "is-current-week " : ""}${isActive ? "is-chart-active" : ""}`}>
              {isActive && <rect x={left + index * band + 1.5} y={top - 4} width={band - 3} height={plotH + 4} rx="8" className="chart-hover-column" />}
              {rendered}
              {common}
            </g>
          );
        }
        const barH = (actualFor(week, view) / axis.max) * plotH;
        return (
          <g key={week.plan.week} className={`${week.plan.week === currentWeek ? "is-current-week " : ""}${isActive ? "is-chart-active" : ""}`}>
            {isActive && <rect x={left + index * band + 1.5} y={top - 4} width={band - 3} height={plotH + 4} rx="8" className="chart-hover-column" />}
            {barH > 0 && <path d={topRoundedRect(x, base - barH, barW, barH, 5)} className={`chart-focus-bar chart-${view}`} />}
            {common}
          </g>
        );
      })}

      {secondaryPath && <path d={secondaryPath} className={`chart-secondary-line chart-${view}-line`} />}
      {secondaryPoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="3.4" className={`chart-secondary-dot chart-${view}-dot`} />)}

      {view !== "all" && narrow && view !== "strength" && (
        <text x={width - right + 4} y={top - 12} className="chart-axis-unit">km</text>
      )}
      {view !== "all" && secondaryAxis.ticks.filter((tick) => tick > 0).map((tick) => (
        <g key={`sec-${tick}`}>
          <line x1={width - right} x2={width - right + 4} y1={secondaryY(tick)} y2={secondaryY(tick)} className="chart-tick-mark" />
          {/* Narrow: bare numbers on the right axis, the unit sits once at the top. */}
          <text x={width - right + 7} y={secondaryY(tick) + 3.5} className="chart-axis-label">{view === "strength" || narrow ? tick : `${tick} km`}</text>
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Mobile volume chart: objective band + actual line, scrubbed with the finger.
// The selected week's numbers live in a card above the chart (no docked panel
// on a phone), matching how training apps present weekly volume.
// ---------------------------------------------------------------------------

function MobileVolumeChart({ weeks, view, currentWeek, selectedIndex, onSelect, width, locale }: {
  weeks: WeekStats[];
  view: LoadView;
  currentWeek: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
  width: number;
  locale: Locale;
}) {
  const height = 200;
  const left = 34;
  const right = 10;
  const top = 14;
  const bottom = 30;
  const plotH = height - top - bottom;
  const plotW = width - left - right;
  const band = plotW / weeks.length;
  const centerX = (index: number) => left + index * band + band / 2;

  const rawMax = Math.max(...weeks.map((week) => Math.max(actualFor(week, view), targetBand(week, view).high)), 1);
  const axis = ticksFromZero(rawMax, [15, 30, 60, 90, 120, 180, 240], 4);
  const y = (minutes: number) => top + plotH - (minutes / axis.max) * plotH;
  const baseY = top + plotH;

  const bandHigh = weeks.map((week, index) => ({ x: centerX(index), y: y(targetBand(week, view).high) }));
  const bandLow = weeks.map((week, index) => ({ x: centerX(index), y: y(targetBand(week, view).low) }));
  const bandPath = `${monotonePath(bandHigh)} L${round2(bandLow[bandLow.length - 1].x)},${round2(bandLow[bandLow.length - 1].y)} ${monotonePath([...bandLow].reverse()).replace(/^M/, "L")} Z`;

  // Actual volume: line through the weeks already trained, dots on each.
  const donePoints = weeks
    .map((week, index) => ({ index, value: actualFor(week, view), x: centerX(index), y: y(actualFor(week, view)) }))
    .filter((point) => point.value > 0 && weeks[point.index].plan.week <= currentWeek);
  const actualPath = donePoints.length > 1 ? monotonePath(donePoints) : "";

  // Sparse week labels: S1, S5, S9 … plus the last week.
  const labelIndexes = new Set<number>();
  for (let index = 0; index < weeks.length; index += 4) labelIndexes.add(index);
  labelIndexes.add(weeks.length - 1);

  const selected = weeks[selectedIndex];
  const selectedActual = selected ? actualFor(selected, view) : 0;

  // Finger scrub: translate the pointer x into a week index. touch-action is
  // pan-y in CSS so vertical page scroll still works over the chart.
  const scrub = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const index = Math.min(weeks.length - 1, Math.max(0, Math.floor((px - left) / band)));
    onSelect(index);
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={translated(locale, "training.chart.weeklyVolume", { discipline: translated(locale, VIEWS.find((item) => item.id === view)?.label ?? "training.chart.viewAll") })}
      className="volume-scrub-svg"
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); scrub(event); }}
      onPointerMove={(event) => { if (event.buttons > 0) scrub(event); }}
    >
      {axis.ticks.filter((tick) => tick > 0).map((tick) => (
        <g key={tick}>
          <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="chart-grid-dotted" />
          <text x={left - 7} y={y(tick) + 3.5} textAnchor="end" className="chart-axis-label">{hourLabel(tick)}</text>
        </g>
      ))}

      <path d={bandPath} className="chart-target-band" />
      <line x1={left} x2={width - right} y1={baseY} y2={baseY} className="chart-baseline" />

      {/* Selection cursor across the full plot, like a scrubber. */}
      <line x1={centerX(selectedIndex)} x2={centerX(selectedIndex)} y1={top - 4} y2={baseY} className="volume-cursor" />

      {actualPath && <path d={actualPath} className="volume-actual-line" />}
      {donePoints.map((point) => (
        <circle key={point.index} cx={point.x} cy={point.y} r={point.index === selectedIndex ? 4.5 : 3} className="volume-actual-dot" />
      ))}

      {/* Baseline markers: a ring per trained week (filled when selected). */}
      {donePoints.map((point) => (
        <circle key={`base-${point.index}`} cx={point.x} cy={baseY} r="3.6" className={`volume-base-dot${point.index === selectedIndex ? " is-selected" : ""}`} />
      ))}
      {selectedActual === 0 && <circle cx={centerX(selectedIndex)} cy={baseY} r="3.6" className="volume-base-dot is-selected is-empty" />}

      {weeks.map((week, index) => labelIndexes.has(index) && (
        <text key={week.plan.week} x={centerX(index)} y={height - 8} textAnchor="middle" className={`chart-week-label${index === selectedIndex ? " is-selected" : ""}`}>
          S{week.plan.week}
        </text>
      ))}
    </svg>
  );
}

export function MultisportLoadExplorer({
  weeks,
  currentWeek,
  selectedWeek = currentWeek,
  views = ["all", "run", "ride", "strength"],
  view: controlledView,
  onViewChange,
}: {
  weeks: WeekStats[];
  currentWeek: number;
  selectedWeek?: number;
  views?: LoadView[];
  // Controlled view, so a parent (MultisportLoadSection) can drive which
  // detail chart is shown below the explorer. Falls back to internal state
  // when omitted, so any other caller keeps working unmodified.
  view?: LoadView;
  onViewChange?: (view: LoadView) => void;
}) {
  const { locale, t } = useLanguage();
  const availableViews = VIEWS.filter((item) => views.includes(item.id));
  const [internalView, setInternalView] = useState<LoadView>(availableViews[0]?.id || "run");
  const view = controlledView ?? internalView;
  const setView = onViewChange ?? setInternalView;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [chartBoxRef, measuredWidth] = useMeasuredWidth();
  const isMobile = useMediaQuery("(max-width: 700px)");
  const chartWidth = measuredWidth || 780;
  const metrics = weeklyViewMetrics(weeks, view, selectedWeek, locale);
  // The detail panel is docked beside the chart (never floating over the
  // bars), so it can always show something: hovered week, else current week.
  const selectedIndex = Math.max(0, weeks.findIndex((week) => week.plan.week === selectedWeek));
  const shownIndex = activeIndex ?? selectedIndex;
  const activeWeek = weeks[shownIndex];

  const tabs = availableViews.length > 1 ? (
    <div className="load-tabs" role="tablist" aria-label={t("training.chart.discipline")}>
      {availableViews.map((item) => (
        <button type="button" role="tab" aria-selected={view === item.id} className={view === item.id ? "is-active" : ""} onClick={() => { setView(item.id); setActiveIndex(null); }} key={item.id}>
          {item.icon}<span>{t(item.label)}</span>
        </button>
      ))}
    </div>
  ) : null;

  if (isMobile && activeWeek) {
    // Phone layout, in the spirit of coaching apps: selection card with the
    // week's number and objective range, a finger-scrubbed band chart, then
    // the cumulative metric cards. No docked panel.
    const bandRange = targetBand(activeWeek, view);
    const actual = actualFor(activeWeek, view);
    const weekStatus = activeWeek.plan.week === currentWeek
      ? t("training.chart.currentWeek")
      : activeWeek.plan.week < currentWeek ? t("training.chart.pastWeek") : t("training.chart.upcomingWeek");
    // Zone verdict, only for weeks already trained (or in progress): inside
    // the objective band, under it, or above it.
    const zone = activeWeek.plan.week > currentWeek
      ? null
      : actual >= bandRange.low && actual <= bandRange.high
        ? { key: "in", label: t("training.chart.inTarget") }
        : actual > bandRange.high
          ? { key: "over", label: t("training.chart.overTarget") }
          : { key: "under", label: activeWeek.plan.week === currentWeek ? t("training.chart.underCurrentTarget") : t("training.chart.outsideTarget") };
    return (
      <div className={`load-explorer is-${view} volume-mobile`}>
        {tabs}
        <div className="volume-select-card" aria-live="polite">
          <div className="volume-select-top">
            <strong className="volume-select-value">
              {zone && <i className={`volume-zone-dot is-${zone.key}`} aria-hidden />}
              {actual > 0 ? fmtMinutes(actual) : "– –"}
            </strong>
            <span className="volume-select-dates">{activeWeek.plan.dates}</span>
          </div>
          <span className="volume-select-week">{t("training.cycle.week").replace("{week}", String(activeWeek.plan.week))} · {weekStatus}</span>
          {zone && <span className={`volume-zone is-${zone.key}`}>{zone.label}</span>}
          <p className="volume-select-goal">
            {t("training.chart.recommendedVolume").replace("{low}", fmtMinutes(bandRange.low)).replace("{high}", fmtMinutes(bandRange.high))}
          </p>
          {activeWeek.plan.gate && <p className="volume-select-gate">◆ {activeWeek.plan.gate}</p>}
        </div>
        <div className="chart-svg-box" ref={chartBoxRef}>
          <MobileVolumeChart weeks={weeks} view={view} currentWeek={currentWeek} selectedIndex={shownIndex} onSelect={setActiveIndex} width={measuredWidth || 330} locale={locale} />
        </div>
        <div className="chart-explainer volume-mobile-explainer">
          <span><i className="actual-marker" />{t("training.chart.actual")}</span>
          <span><i className="band-marker" />{t("training.chart.targetZone")}</span>
        </div>
        <div className="load-view-metrics volume-mobile-metrics">
          {metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
        </div>
      </div>
    );
  }

  return (
    <div className={`load-explorer is-${view}`}>
      {tabs}
      <div className="load-view-metrics">
        {metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
      </div>
      <div className="interactive-chart-wrap">
        <div className="chart-svg-box" ref={chartBoxRef}>
          <LoadChart weeks={weeks} view={view} currentWeek={currentWeek} activeIndex={activeIndex ?? selectedIndex} setActiveIndex={setActiveIndex} width={chartWidth} locale={locale} />
        </div>
        {activeWeek && (
          <div className="chart-detail-panel" aria-live="polite">
            <div className="chart-tooltip-head"><strong>{t("training.cycle.week").replace("{week}", String(activeWeek.plan.week))}</strong><span>{activeWeek.plan.dates}</span></div>
            <div className="chart-tooltip-grid">
              {tooltipRows(activeWeek, view, locale).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
            </div>
            {activeWeek.plan.gate && <p className="chart-tooltip-gate">◆ {activeWeek.plan.gate}</p>}
            {activeIndex === null && <p className="chart-detail-hint">{t("training.chart.hoverWeekChange")}</p>}
          </div>
        )}
      </div>
      <div className="chart-explainer">
        <span><i className="actual-marker" />{t("training.chart.actual")}</span>
        <span><i className="band-marker" />{t("training.chart.targetZone")}</span>
        {view !== "all" && <span><i className="line-marker" />{t(view === "strength" ? "training.chart.sessionCount" : "training.chart.weeklyDistance")}</span>}
        <span><i className="gate-marker" />{t("training.chart.validationGate")}</span>
        <small>{t("training.chart.hoverWeek")}</small>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pace / heart-rate performance chart
// ---------------------------------------------------------------------------

export function InteractivePerformanceChart({ runs }: { runs: TrailActivity[] }) {
  const { locale, t } = useLanguage();
  const gradientId = useId().replace(/:/g, "");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [chartBoxRef, measuredWidth] = useMeasuredWidth();
  const width = measuredWidth || 780;
  const narrow = width < 520;
  const height = narrow ? 232 : 272;
  const leftPad = narrow ? 40 : 48;
  const rightPad = narrow ? 38 : 50;
  const top = 30;
  const bottom = narrow ? 40 : 44;
  const plotW = width - leftPad - rightPad;
  const plotH = height - top - bottom;

  const points = runs
    .filter((run) => run.paceSPerKm)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12);
  if (!points.length) return <div className="chart-empty">{t("training.chart.emptyRun")}</div>;

  // Time-proportional x axis: three runs in one week and a two-week gap must
  // not look evenly spaced — the horizontal distance carries meaning.
  const dayMs = 86400000;
  const firstDay = new Date(`${points[0].date}T00:00:00`).getTime();
  const lastDay = new Date(`${points[points.length - 1].date}T00:00:00`).getTime();
  const daySpan = Math.max(1, (lastDay - firstDay) / dayMs);
  const x = (index: number) => {
    if (points.length === 1) return leftPad + plotW / 2;
    const day = (new Date(`${points[index].date}T00:00:00`).getTime() - firstDay) / dayMs;
    return leftPad + (day / daySpan) * plotW;
  };

  // Pace axis snapped to round splits (…6:00, 6:30…), fast at the top.
  const paces = points.map((run) => run.paceSPerKm as number);
  const paceAxis = ticksBetween(Math.min(...paces) - 6, Math.max(...paces) + 6, [5, 10, 15, 20, 30, 60], 4);
  const paceY = (pace: number) => top + ((pace - paceAxis.min) / Math.max(1, paceAxis.max - paceAxis.min)) * plotH;

  // Heart-rate axis on the right, its own round steps.
  const hrs = points.map((run) => run.hr).filter((hr): hr is number => Boolean(hr));
  const hrAxis = ticksBetween((hrs.length ? Math.min(...hrs) : 100) - 3, (hrs.length ? Math.max(...hrs) : 160) + 3, [5, 10, 15, 20], 4);
  const hrY = (hr: number) => top + (1 - (hr - hrAxis.min) / Math.max(1, hrAxis.max - hrAxis.min)) * plotH;

  const pacePoints = points.map((run, index) => ({ x: x(index), y: paceY(run.paceSPerKm as number) }));
  const pacePath = monotonePath(pacePoints);
  const hrPoints = points
    .map((run, index) => (run.hr ? { x: x(index), y: hrY(run.hr) } : null))
    .filter((point): point is { x: number; y: number } => Boolean(point));
  const hrPath = monotonePath(hrPoints);
  const area = pacePoints.length > 1
    ? `${pacePath} L${round2(pacePoints[pacePoints.length - 1].x)},${top + plotH} L${round2(pacePoints[0].x)},${top + plotH} Z`
    : "";

  // Hit zones split at midpoints between consecutive runs (date-proportional).
  const hitArea = (index: number) => {
    if (points.length === 1) return { x: leftPad, width: plotW };
    const prev = index === 0 ? leftPad : (x(index - 1) + x(index)) / 2;
    const next = index === points.length - 1 ? leftPad + plotW : (x(index) + x(index + 1)) / 2;
    return { x: prev, width: Math.max(8, next - prev) };
  };

  // Thin date labels when runs cluster: keep ≥52px between printed labels.
  const showLabel: boolean[] = [];
  for (let index = 0, lastLabelX = -Infinity; index < points.length; index++) {
    const px = x(index);
    const visible = px - lastLabelX >= 52 || index === points.length - 1;
    if (visible) lastLabelX = px;
    showLabel.push(visible);
  }

  // Same docked-panel pattern as the load explorer: default to the latest run
  // so the panel is informative before any interaction.
  const shownIndex = activeIndex ?? points.length - 1;
  const active = points[shownIndex];

  return (
    <div className="interactive-chart-wrap performance-interactive">
      <div className="chart-svg-box" ref={chartBoxRef}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("training.chart.runAria")}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--run-color)" stopOpacity=".2" />
            <stop offset="1" stopColor="var(--run-color)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Narrow: anchor the unit to the plot's left edge; right-anchored at
            leftPad-9 it extends past x=0 and gets clipped by the card. */}
        <text x={narrow ? 2 : leftPad - 9} y={top - 12} textAnchor={narrow ? "start" : "end"} className="chart-axis-unit">min/km</text>
        {hrs.length > 0 && <text x={width - rightPad + 9} y={top - 12} className="chart-axis-unit">bpm</text>}

        {paceAxis.ticks.map((tick) => (
          <g key={tick}>
            <line x1={leftPad} x2={width - rightPad} y1={paceY(tick)} y2={paceY(tick)} className="chart-grid-line" />
            <text x={leftPad - 9} y={paceY(tick) + 3.5} textAnchor="end" className="chart-axis-label">{fmtPace(tick).replace("/km", "")}</text>
          </g>
        ))}
        {hrs.length > 0 && hrAxis.ticks.map((tick) => (
          <g key={`hr-${tick}`}>
            <line x1={width - rightPad} x2={width - rightPad + 4} y1={hrY(tick)} y2={hrY(tick)} className="chart-tick-mark" />
            <text x={width - rightPad + 7} y={hrY(tick) + 3.5} className="chart-axis-label">{tick}</text>
          </g>
        ))}

        {activeIndex !== null && <line x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={top + plotH} className="chart-crosshair" />}

        {area && <path d={area} fill={`url(#${gradientId})`} />}
        {pacePath && <path d={pacePath} className="chart-pace-line" />}
        {hrPath && <path d={hrPath} className="chart-hr-line" />}

        {points.map((run, index) => (
          <g key={run.id} className={activeIndex === index ? "is-chart-active" : ""}>
            <circle cx={x(index)} cy={paceY(run.paceSPerKm as number)} r={activeIndex === index ? 5 : 4} className="chart-pace-dot" />
            {run.hr && <circle cx={x(index)} cy={hrY(run.hr)} r={activeIndex === index ? 4.5 : 3.5} className="chart-hr-dot" />}
            {showLabel[index] && (
              <text x={x(index)} y={height - 15} textAnchor="middle" className="chart-week-label">
                {new Date(`${run.date}T00:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" })}
              </text>
            )}
            <rect className="chart-hit-area" x={hitArea(index).x} y={top} width={hitArea(index).width} height={plotH + bottom} tabIndex={0} onPointerEnter={() => setActiveIndex(index)} onPointerDown={() => setActiveIndex(index)} onPointerLeave={() => setActiveIndex(null)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} />
          </g>
        ))}
      </svg>
      </div>
      {active && (
        <div className="chart-detail-panel" aria-live="polite">
          <div className="chart-tooltip-head"><strong>{active.name}</strong><span>{new Date(`${active.date}T00:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}</span></div>
          <div className="chart-tooltip-grid">
            <div><span>{t("training.coach.pace")}</span><strong>{fmtPace(active.paceSPerKm)}</strong></div>
            <div><span>{t("training.chart.averageHeartRate")}</span><strong>{active.hr ? `${active.hr} bpm` : "—"}</strong></div>
            <div><span>{t("training.chart.distance")}</span><strong>{fmtKm(active.km, 1, locale)}</strong></div>
            <div><span>{t("training.cycle.duration")}</span><strong>{fmtDur(active.durS)}</strong></div>
            <div><span>{t("training.chart.elevation")}</span><strong>{Math.round(active.dplus)} m D+</strong></div>
          </div>
          {activeIndex === null && <p className="chart-detail-hint">{t("training.chart.hoverPoint")}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ride performance chart — average speed & heart rate for every ride.
// ---------------------------------------------------------------------------

function rideMetric(ride: TrailActivity): number {
  return ride.durS ? ride.km / (ride.durS / 3600) : 0;
}

export function RidePerformanceChart({ rides }: { rides: TrailActivity[] }) {
  const { locale, t } = useLanguage();
  const gradientId = useId().replace(/:/g, "");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [chartBoxRef, measuredWidth] = useMeasuredWidth();
  const width = measuredWidth || 780;
  const narrow = width < 520;
  const height = narrow ? 232 : 272;
  const leftPad = narrow ? 40 : 48;
  const rightPad = narrow ? 38 : 50;
  const top = 30;
  const bottom = narrow ? 40 : 44;
  const plotW = width - leftPad - rightPad;
  const plotH = height - top - bottom;

  const points = rides
    .filter((ride) => ride.durS > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12);
  if (!points.length) return <div className="chart-empty">{t("training.chart.emptyRide")}</div>;

  const dayMs = 86400000;
  const firstDay = new Date(`${points[0].date}T00:00:00`).getTime();
  const lastDay = new Date(`${points[points.length - 1].date}T00:00:00`).getTime();
  const daySpan = Math.max(1, (lastDay - firstDay) / dayMs);
  const x = (index: number) => {
    if (points.length === 1) return leftPad + plotW / 2;
    const day = (new Date(`${points[index].date}T00:00:00`).getTime() - firstDay) / dayMs;
    return leftPad + (day / daySpan) * plotW;
  };

  // Value axis from zero (power/speed have no meaningful non-zero floor,
  // unlike pace), snapped to round steps appropriate to each unit.
  const values = points.map(rideMetric);
  const axis = ticksFromZero(Math.max(...values) * 1.1, [1, 2, 5, 10, 20], 4);
  const valueY = (value: number) => top + plotH - (value / axis.max) * plotH;

  const hrs = points.map((ride) => ride.hr).filter((hr): hr is number => Boolean(hr));
  const hrAxis = ticksBetween((hrs.length ? Math.min(...hrs) : 100) - 3, (hrs.length ? Math.max(...hrs) : 160) + 3, [5, 10, 15, 20], 4);
  const hrY = (hr: number) => top + (1 - (hr - hrAxis.min) / Math.max(1, hrAxis.max - hrAxis.min)) * plotH;

  const valuePoints = points.map((ride, index) => ({ x: x(index), y: valueY(rideMetric(ride)) }));
  const valuePath = monotonePath(valuePoints);
  const hrPoints = points
    .map((ride, index) => (ride.hr ? { x: x(index), y: hrY(ride.hr) } : null))
    .filter((point): point is { x: number; y: number } => Boolean(point));
  const hrPath = monotonePath(hrPoints);
  const area = valuePoints.length > 1
    ? `${valuePath} L${round2(valuePoints[valuePoints.length - 1].x)},${top + plotH} L${round2(valuePoints[0].x)},${top + plotH} Z`
    : "";

  const hitArea = (index: number) => {
    if (points.length === 1) return { x: leftPad, width: plotW };
    const prev = index === 0 ? leftPad : (x(index - 1) + x(index)) / 2;
    const next = index === points.length - 1 ? leftPad + plotW : (x(index) + x(index + 1)) / 2;
    return { x: prev, width: Math.max(8, next - prev) };
  };

  const showLabel: boolean[] = [];
  for (let index = 0, lastLabelX = -Infinity; index < points.length; index++) {
    const px = x(index);
    const visible = px - lastLabelX >= 52 || index === points.length - 1;
    if (visible) lastLabelX = px;
    showLabel.push(visible);
  }

  const shownIndex = activeIndex ?? points.length - 1;
  const active = points[shownIndex];
  return (
    <div className="interactive-chart-wrap performance-interactive">
      <div className="chart-svg-box" ref={chartBoxRef}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("training.chart.rideAria")}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--ride-color)" stopOpacity=".2" />
            <stop offset="1" stopColor="var(--ride-color)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <text x={narrow ? 2 : leftPad - 9} y={top - 12} textAnchor={narrow ? "start" : "end"} className="chart-axis-unit">km/h</text>
        {hrs.length > 0 && <text x={width - rightPad + 9} y={top - 12} className="chart-axis-unit">bpm</text>}

        {axis.ticks.map((tick) => (
          <g key={tick}>
            <line x1={leftPad} x2={width - rightPad} y1={valueY(tick)} y2={valueY(tick)} className="chart-grid-line" />
            <text x={leftPad - 9} y={valueY(tick) + 3.5} textAnchor="end" className="chart-axis-label">{tick}</text>
          </g>
        ))}
        {hrs.length > 0 && hrAxis.ticks.map((tick) => (
          <g key={`hr-${tick}`}>
            <line x1={width - rightPad} x2={width - rightPad + 4} y1={hrY(tick)} y2={hrY(tick)} className="chart-tick-mark" />
            <text x={width - rightPad + 7} y={hrY(tick) + 3.5} className="chart-axis-label">{tick}</text>
          </g>
        ))}

        {activeIndex !== null && <line x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={top + plotH} className="chart-crosshair" />}

        {area && <path d={area} fill={`url(#${gradientId})`} />}
        {valuePath && <path d={valuePath} className="chart-ride-line" />}
        {hrPath && <path d={hrPath} className="chart-hr-line" />}

        {points.map((ride, index) => (
          <g key={ride.id} className={activeIndex === index ? "is-chart-active" : ""}>
            <circle cx={x(index)} cy={valueY(rideMetric(ride))} r={activeIndex === index ? 5 : 4} className="chart-ride-dot" />
            {ride.hr && <circle cx={x(index)} cy={hrY(ride.hr)} r={activeIndex === index ? 4.5 : 3.5} className="chart-hr-dot" />}
            {showLabel[index] && (
              <text x={x(index)} y={height - 15} textAnchor="middle" className="chart-week-label">
                {new Date(`${ride.date}T00:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" })}
              </text>
            )}
            <rect className="chart-hit-area" x={hitArea(index).x} y={top} width={hitArea(index).width} height={plotH + bottom} tabIndex={0} onPointerEnter={() => setActiveIndex(index)} onPointerDown={() => setActiveIndex(index)} onPointerLeave={() => setActiveIndex(null)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} />
          </g>
        ))}
      </svg>
      </div>
      {active && (
        <div className="chart-detail-panel" aria-live="polite">
          <div className="chart-tooltip-head"><strong>{active.name}</strong><span>{new Date(`${active.date}T00:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}</span></div>
          <div className="chart-tooltip-grid">
            <div><span>{t("training.chart.averageSpeed")}</span><strong>{`${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rideMetric(active))} km/h`}</strong></div>
            <div><span>{t("training.chart.averageHeartRate")}</span><strong>{active.hr ? `${active.hr} bpm` : "—"}</strong></div>
            <div><span>{t("training.chart.distance")}</span><strong>{fmtKm(active.km, 1, locale)}</strong></div>
            <div><span>{t("training.cycle.duration")}</span><strong>{fmtDur(active.durS)}</strong></div>
            <div><span>{t("training.chart.elevation")}</span><strong>{Math.round(active.dplus)} m D+</strong></div>
          </div>
          {activeIndex === null && <p className="chart-detail-hint">{t("training.chart.hoverPoint")}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Strength sessions chart — duration bars with an optional heart-rate line.
// Same date-proportional scaffolding as the other performance charts, minus
// the area fill (a bar chart already reads its own magnitude).
// ---------------------------------------------------------------------------

export function StrengthSessionsChart({ sessions }: { sessions: TrailActivity[] }) {
  const { locale, t } = useLanguage();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [chartBoxRef, measuredWidth] = useMeasuredWidth();
  const width = measuredWidth || 780;
  const narrow = width < 520;
  const height = narrow ? 232 : 272;
  const leftPad = narrow ? 34 : 44;
  const rightPad = narrow ? 30 : 46;
  const top = 30;
  const bottom = narrow ? 40 : 44;
  const plotW = width - leftPad - rightPad;
  const plotH = height - top - bottom;

  const points = sessions
    .filter((session) => session.durS > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12);
  if (!points.length) return <div className="chart-empty">{t("training.chart.emptyStrength")}</div>;

  const dayMs = 86400000;
  const firstDay = new Date(`${points[0].date}T00:00:00`).getTime();
  const lastDay = new Date(`${points[points.length - 1].date}T00:00:00`).getTime();
  const daySpan = Math.max(1, (lastDay - firstDay) / dayMs);
  const x = (index: number) => {
    if (points.length === 1) return leftPad + plotW / 2;
    const day = (new Date(`${points[index].date}T00:00:00`).getTime() - firstDay) / dayMs;
    return leftPad + (day / daySpan) * plotW;
  };
  const barW = Math.min(34, (plotW / points.length) * 0.5);

  const minutes = points.map((session) => session.durS / 60);
  const axis = ticksFromZero(Math.max(...minutes), [10, 15, 20, 30, 45, 60, 90], 4);
  const y = (value: number) => top + plotH - (value / axis.max) * plotH;
  const base = top + plotH;

  const hrs = points.map((session) => session.hr).filter((hr): hr is number => Boolean(hr));
  const hrAxis = ticksBetween((hrs.length ? Math.min(...hrs) : 100) - 3, (hrs.length ? Math.max(...hrs) : 160) + 3, [5, 10, 15, 20], 4);
  const hrY = (hr: number) => top + (1 - (hr - hrAxis.min) / Math.max(1, hrAxis.max - hrAxis.min)) * plotH;
  const hrPoints = points
    .map((session, index) => (session.hr ? { x: x(index), y: hrY(session.hr) } : null))
    .filter((point): point is { x: number; y: number } => Boolean(point));
  const hrPath = monotonePath(hrPoints);

  const hitArea = (index: number) => {
    if (points.length === 1) return { x: leftPad, width: plotW };
    const prev = index === 0 ? leftPad : (x(index - 1) + x(index)) / 2;
    const next = index === points.length - 1 ? leftPad + plotW : (x(index) + x(index + 1)) / 2;
    return { x: prev, width: Math.max(8, next - prev) };
  };

  const showLabel: boolean[] = [];
  for (let index = 0, lastLabelX = -Infinity; index < points.length; index++) {
    const px = x(index);
    const visible = px - lastLabelX >= 52 || index === points.length - 1;
    if (visible) lastLabelX = px;
    showLabel.push(visible);
  }

  const shownIndex = activeIndex ?? points.length - 1;
  const active = points[shownIndex];

  return (
    <div className="interactive-chart-wrap performance-interactive">
      <div className="chart-svg-box" ref={chartBoxRef}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("training.chart.strengthAria")}>
        <text x={narrow ? 2 : leftPad - 9} y={top - 12} textAnchor={narrow ? "start" : "end"} className="chart-axis-unit">min</text>
        {hrs.length > 0 && <text x={width - rightPad + 9} y={top - 12} className="chart-axis-unit">bpm</text>}

        {axis.ticks.map((tick) => (
          <g key={tick}>
            <line x1={leftPad} x2={width - rightPad} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "chart-baseline" : "chart-grid-line"} />
            <text x={leftPad - 9} y={y(tick) + 3.5} textAnchor="end" className="chart-axis-label">{tick}</text>
          </g>
        ))}
        {hrs.length > 0 && hrAxis.ticks.map((tick) => (
          <g key={`hr-${tick}`}>
            <line x1={width - rightPad} x2={width - rightPad + 4} y1={hrY(tick)} y2={hrY(tick)} className="chart-tick-mark" />
            <text x={width - rightPad + 7} y={hrY(tick) + 3.5} className="chart-axis-label">{tick}</text>
          </g>
        ))}

        {activeIndex !== null && <line x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={top + plotH} className="chart-crosshair" />}

        {points.map((session, index) => {
          const barH = (session.durS / 60 / axis.max) * plotH;
          return (
            <g key={session.id} className={activeIndex === index ? "is-chart-active" : ""}>
              {barH > 0 && <path d={topRoundedRect(x(index) - barW / 2, base - barH, barW, barH, 4)} className="chart-strength" />}
              {showLabel[index] && (
                <text x={x(index)} y={height - 15} textAnchor="middle" className="chart-week-label">
                  {new Date(`${session.date}T00:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" })}
                </text>
              )}
              <rect className="chart-hit-area" x={hitArea(index).x} y={top} width={hitArea(index).width} height={plotH + bottom} tabIndex={0} onPointerEnter={() => setActiveIndex(index)} onPointerDown={() => setActiveIndex(index)} onPointerLeave={() => setActiveIndex(null)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} />
            </g>
          );
        })}
        {hrPath && <path d={hrPath} className="chart-hr-line" />}
        {points.map((session, index) => session.hr && (
          <circle key={`hr-dot-${session.id}`} cx={x(index)} cy={hrY(session.hr)} r={activeIndex === index ? 4.5 : 3.5} className="chart-hr-dot" />
        ))}
      </svg>
      </div>
      {active && (
        <div className="chart-detail-panel" aria-live="polite">
          <div className="chart-tooltip-head"><strong>{active.name}</strong><span>{new Date(`${active.date}T00:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}</span></div>
          <div className="chart-tooltip-grid">
            <div><span>{t("training.cycle.duration")}</span><strong>{fmtDur(active.durS)}</strong></div>
            <div><span>{t("training.chart.averageHeartRate")}</span><strong>{active.hr ? `${active.hr} bpm` : "—"}</strong></div>
          </div>
          {activeIndex === null && <p className="chart-detail-hint">{t("training.chart.hoverPoint")}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combined load explorer + detail chart. State has to live here (a client
// component) because TrailWorkspace, the caller, is a server component and
// cannot itself hold "which sport is selected" — this is that shared state.
// ---------------------------------------------------------------------------

export function MultisportLoadSection({ weeks, currentWeek, selectedWeek, activities }: { weeks: WeekStats[]; currentWeek: number; selectedWeek: number; activities: TrailActivity[] }) {
  const { t } = useLanguage();
  const [view, setView] = useState<LoadView>("all");
  const rides = activities.filter((activity) => activity.kind === "ride");

  return (
    <>
      <TrailChartCard className="load-chart-card" kicker={t("training.chart.loadKicker")} title={t("training.chart.loadTitle")}>
        <MultisportLoadExplorer key={selectedWeek} weeks={weeks} currentWeek={currentWeek} selectedWeek={selectedWeek} view={view} onViewChange={setView} />
      </TrailChartCard>

      {view === "run" && (
        <TrailChartCard
          className="performance-card"
          kicker={t("training.chart.runKicker")}
          title={t("training.chart.runTitle")}
          headerAside={<div className="chart-legend"><span className="legend-run"><i />{t("training.chart.paceLegend")}</span><span className="legend-heart"><i />{t("training.chart.averageHeartRate")}</span></div>}
        >
          <InteractivePerformanceChart key={selectedWeek} runs={activities.filter((activity) => activity.kind === "run")} />
        </TrailChartCard>
      )}

      {view === "ride" && (
        <TrailChartCard
          className="performance-card"
          kicker={t("training.chart.rideKicker")}
          title={t("training.chart.rideTitle")}
          headerAside={<div className="chart-legend"><span className="legend-ride"><i />{t("training.chart.speedLegend")}</span><span className="legend-heart"><i />{t("training.chart.averageHeartRate")}</span></div>}
        >
          <RidePerformanceChart key={selectedWeek} rides={rides} />
        </TrailChartCard>
      )}

      {view === "strength" && (
        <TrailChartCard
          className="performance-card"
          kicker={t("training.chart.strengthKicker")}
          title={t("training.chart.strengthTitle")}
          headerAside={<div className="chart-legend"><span className="legend-strength"><i />{t("training.chart.durationLegend")}</span><span className="legend-heart"><i />{t("training.chart.averageHeartRate")}</span></div>}
        >
          <StrengthSessionsChart key={selectedWeek} sessions={activities.filter((activity) => activity.kind === "strength")} />
        </TrailChartCard>
      )}
    </>
  );
}

function formatPct(value: number): string {
  return `${Math.round(value)}%`;
}

function formatNumber(value: number | null, digits = 0, locale: Locale = "fr"): string {
  if (value === null) return "—";
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function runDateLabel(run: TrailActivity, locale: Locale): string {
  return new Date(`${run.date}T00:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
}

function zonePercent(run: TrailActivity, zone: number): number {
  const found = run.hrZones.find((item) => item.zone === zone);
  if (!found) return 0;
  return found.percent ?? (run.durS ? (found.seconds / run.durS) * 100 : 0);
}

function z2Seconds(run: TrailActivity): number {
  return run.timeInZone2S ?? run.hrZones.find((zone) => zone.zone === 2)?.seconds ?? 0;
}

function z3PlusSeconds(run: TrailActivity): number {
  return run.hrZones.filter((zone) => zone.zone >= 3).reduce((sum, zone) => sum + zone.seconds, 0);
}

function lastRunsWithZones(runs: TrailActivity[]): TrailActivity[] {
  return runs.filter((run) => run.hrZones.length > 0).sort((a, b) => a.date.localeCompare(b.date)).slice(-4);
}

function zoneVerdict(run: TrailActivity, locale: Locale): { label: string; tone: "good" | "warn" | "neutral" } {
  if (!run.hrZones.length) return { label: translated(locale, "training.chart.zonesMissing"), tone: "neutral" };
  const z2Pct = run.durS ? (z2Seconds(run) / run.durS) * 100 : 0;
  const z3Pct = run.durS ? (z3PlusSeconds(run) / run.durS) * 100 : 0;
  if (z2Pct >= 65 && z3Pct <= 25) return { label: translated(locale, "training.chart.z2Clean"), tone: "good" };
  if (z3Pct > 35) return { label: translated(locale, "training.chart.tooHard"), tone: "warn" };
  return { label: translated(locale, "training.chart.mixed"), tone: "neutral" };
}

// Most recent run whose hrZones carry real bpm boundaries, used to label the
// legend with actual thresholds instead of bare zone numbers.
function zoneBoundaryRun(runs: TrailActivity[]): TrailActivity | null {
  return [...runs]
    .filter((run) => run.hrZones.some((zone) => zone.lowBoundary !== null || zone.highBoundary !== null))
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

function zoneLegendLabel(boundaryRun: TrailActivity | null, zone: number): string {
  const found = boundaryRun?.hrZones.find((item) => item.zone === zone);
  if (!found) return `Z${zone}`;
  if (zone === 1) return found.highBoundary !== null ? `Z1 · ≤${found.highBoundary}` : "Z1";
  if (zone === 5) return found.lowBoundary !== null ? `Z5 · ≥${found.lowBoundary}` : "Z5";
  return found.lowBoundary !== null && found.highBoundary !== null ? `Z${zone} · ${found.lowBoundary}-${found.highBoundary}` : `Z${zone}`;
}

function formatZoneMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)}'`;
}

// One compact line per run: intensity (Z2/Z3+/TE) plus, when the device
// reported them, the technique numbers that used to live in their own row.
function runMetaLine(run: TrailActivity, locale: Locale): string {
  const te = run.aerobicTrainingEffect !== null ? formatNumber(run.aerobicTrainingEffect, 1, locale) : "—";
  let line = `Z2 ${formatZoneMinutes(z2Seconds(run))} · Z3+ ${formatZoneMinutes(z3PlusSeconds(run))} · TE ${te}`;
  if (run.avgCadence !== null) line += ` · ${Math.round(run.avgCadence)} spm`;
  if (run.groundContactTimeMs !== null) line += ` · ${Math.round(run.groundContactTimeMs)} ms`;
  return line;
}

export function RunningFormPanel({ runs }: { runs: TrailActivity[] }) {
  const { locale, t } = useLanguage();
  const zoneRuns = lastRunsWithZones(runs);
  if (!runs.length) return <div className="chart-empty">{t("training.chart.runningZonesEmpty")}</div>;
  if (!zoneRuns.length) return <div className="chart-empty">{t("training.chart.runningZonesMissing")}</div>;

  const recentSeconds = zoneRuns.reduce((sum, run) => sum + run.durS, 0);
  const z2Pct = recentSeconds ? (zoneRuns.reduce((sum, run) => sum + z2Seconds(run), 0) / recentSeconds) * 100 : 0;
  const latest = zoneRuns[zoneRuns.length - 1];
  const boundaryRun = zoneBoundaryRun(runs);
  const rows = [...zoneRuns].reverse();

  return (
    <div className="running-analysis">
      <div className="load-view-metrics">
        <div><span>{t("training.chart.recentZ2")}</span><strong>{formatPct(z2Pct)}</strong></div>
        <div><span>{t("training.chart.aerobicEffect")}</span><strong>{latest.aerobicTrainingEffect !== null ? formatNumber(latest.aerobicTrainingEffect, 1, locale) : "—"}</strong></div>
        <div><span>{t("training.chart.cadence")}</span><strong>{latest.avgCadence ? `${Math.round(latest.avgCadence)} spm` : "—"}</strong></div>
        <div><span>{t("training.chart.endStamina")}</span><strong>{latest.staminaEnd !== null ? `${Math.round(latest.staminaEnd)}%` : "—"}</strong></div>
      </div>
      <div className="run-zone-list">
        {rows.map((run) => {
          const verdict = zoneVerdict(run, locale);
          return (
            <div className="run-zone-row" key={run.id}>
              <div className="run-zone-title">
                <span>{runDateLabel(run, locale)}</span>
                <strong>{run.name}</strong>
                <small className={`run-zone-verdict is-${verdict.tone}`}>{verdict.label}</small>
              </div>
              <div className="run-zone-stack" aria-label={t("training.chart.heartZones").replace("{name}", run.name)}>
                {[1, 2, 3, 4, 5].map((zone) => {
                  const width = zonePercent(run, zone);
                  return width > 0 ? <i className={`is-z${zone}`} style={{ width: `${width}%` }} title={`Z${zone} · ${formatPct(width)}`} key={zone} /> : null;
                })}
              </div>
              <div className="run-zone-meta">
                <span>{runMetaLine(run, locale)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="chart-explainer run-zone-legend">
        {[1, 2, 3, 4, 5].map((zone) => <span key={zone}><i className={`is-z${zone}`} />{zoneLegendLabel(boundaryRun, zone)}</span>)}
        <small>{t("training.chart.latestRunZ2").replace("{percent}", formatPct(zonePercent(latest, 2)))}</small>
      </div>
    </div>
  );
}

type HealthMetricKey = "readiness" | "sleepScore" | "rhr" | "hrvAvg";

const HEALTH_METRICS: Array<{ key: HealthMetricKey; label: TranslationKey; unit: string; color: string; up: TranslationKey; down: TranslationKey }> = [
  { key: "readiness", label: "training.health.readiness", unit: "/100", color: "var(--run-color)", up: "training.health.readinessUp", down: "training.health.readinessDown" },
  { key: "sleepScore", label: "training.health.sleep", unit: "/100", color: "var(--strength-color)", up: "training.health.sleepUp", down: "training.health.sleepDown" },
  { key: "rhr", label: "training.health.restingHr", unit: " bpm", color: "var(--recovery-color)", up: "training.health.rhrUp", down: "training.health.rhrDown" },
  { key: "hrvAvg", label: "training.health.hrv", unit: " ms", color: "var(--ride-color)", up: "training.health.hrvUp", down: "training.health.hrvDown" },
];

type HealthTrend = "up" | "down" | "flat";
const TREND_ARROW: Record<HealthTrend, string> = { up: "↑", down: "↓", flat: "→" };

function healthTrend(days: TrailHealthDay[], key: HealthMetricKey): { value: number | null; trend: HealthTrend | null } {
  const withValue = days.filter((day) => day[key] !== null);
  if (!withValue.length) return { value: null, trend: null };
  const latestValue = withValue[withValue.length - 1][key] as number;
  const previous = withValue.slice(0, -1).slice(-7).map((day) => day[key] as number);
  if (!previous.length) return { value: latestValue, trend: null };
  const average = previous.reduce((sum, value) => sum + value, 0) / previous.length;
  const diff = latestValue - average;
  return { value: latestValue, trend: Math.abs(diff) < 0.5 ? "flat" : diff > 0 ? "up" : "down" };
}

function healthDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`));
}

function HealthTooltip({ active, payload, unit, locale }: { active?: boolean; payload?: ReadonlyArray<{ payload?: { date: string; value: number } }>; unit: string; locale: Locale }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="finance-chart-tooltip"><span>{healthDate(point.date, locale)}</span><strong>{point.value}{unit}</strong></div>;
}

// Deterministic one-line reading of the selected metric: latest value vs. the
// average of up to 7 preceding recorded days, only surfaced when the move is
// meaningful (≥ 2% of the range) — silence when nothing changed.
// ponytail: heuristic reading, swap for the coach bridge if it should reason across metrics.
function healthReading(values: number[], metric: (typeof HEALTH_METRICS)[number], locale: Locale): string | null {
  if (values.length < 3) return null;
  const latest = values[values.length - 1];
  const previous = values.slice(0, -1).slice(-7);
  const average = previous.reduce((sum, value) => sum + value, 0) / previous.length;
  const range = Math.max(...values) - Math.min(...values) || 1;
  if (Math.abs(latest - average) < range * 0.08) return null;
  const rising = latest > average;
  return translated(locale, rising ? metric.up : metric.down);
}

export function HealthTrendChart({ days }: { days: TrailHealthDay[] }) {
  const { locale, t } = useLanguage();
  const [activeKey, setActiveKey] = useState<HealthMetricKey>("readiness");
  const gradientId = `health-trend-${useId().replace(/:/g, "")}`;
  const metric = HEALTH_METRICS.find((item) => item.key === activeKey) ?? HEALTH_METRICS[0];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const series = sorted
    .map((day) => ({ date: day.date, value: day[metric.key] }))
    .filter((point): point is { date: string; value: number } => point.value !== null);
  const reading = healthReading(series.map((point) => point.value), metric, locale);
  const latestSleepH = [...sorted].reverse().find((day) => day.sleepH !== null)?.sleepH ?? null;

  return (
    <section className="trail-card health-trend-card">
      <div className="trail-card-head"><div><span className="trail-card-kicker">{t("training.health.kicker")}</span><h2>{t("training.health.title").replace("{days}", String(sorted.length))}</h2></div><Activity size={18} /></div>
      <div className="health-grid" role="group" aria-label={t("training.health.metric")}>
        {HEALTH_METRICS.map((item) => {
          const summary = healthTrend(sorted, item.key);
          const unit = item.key === "sleepScore" && latestSleepH !== null ? `${item.unit} · ${fmtDur(latestSleepH * 3600)}` : item.unit;
          return (
            <button className="health-chip" key={item.key} type="button" aria-pressed={item.key === activeKey} onClick={() => setActiveKey(item.key)} style={{ "--metric-color": item.color } as CSSProperties}>
              <small>{t(item.label)}</small>
              <strong>{summary.value ?? "-"}<span>{summary.value === null ? "" : unit}</span></strong>
              {summary.trend && <em>{TREND_ARROW[summary.trend]}</em>}
            </button>
          );
        })}
      </div>
      <div className="health-trend-plot">
        {series.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 12, right: 8, bottom: 4, left: 4 }}>
              <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={metric.color} stopOpacity=".22" /><stop offset="1" stopColor={metric.color} stopOpacity="0" /></linearGradient></defs>
              <XAxis axisLine={false} dataKey="date" minTickGap={28} tick={{ fill: "var(--muted)", fontSize: 10 }} tickFormatter={(date) => healthDate(date, locale)} tickLine={false} />
              <YAxis axisLine={false} domain={["auto", "auto"]} tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} width={30} />
              <Tooltip content={<HealthTooltip unit={metric.unit} locale={locale} />} cursor={{ stroke: metric.color, strokeDasharray: "4 4", strokeWidth: 1 }} />
              <Area dataKey="value" fill={`url(#${gradientId})`} stroke="none" type="monotone" />
              <Line activeDot={{ fill: metric.color, r: 5, stroke: "var(--bg)", strokeWidth: 2 }} dataKey="value" dot={false} stroke={metric.color} strokeWidth={2.4} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="chart-empty">{t("training.health.empty")}</div>
        )}
      </div>
      {reading ? <p className="health-trend-reading">{reading}</p> : null}
    </section>
  );
}
