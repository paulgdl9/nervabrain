"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type DashboardChartDetail = {
  primary: string;
  secondary: string;
  ariaLabel: string;
};

export function dashboardChartIndex(clientX: number, left: number, width: number, count: number): number {
  if (count <= 1) return 0;
  const ratio = Math.max(0, Math.min(1, (clientX - left) / Math.max(1, width)));
  return Math.round(ratio * (count - 1));
}

export function DashboardAreaChart({
  values,
  label,
  details,
  zeroBased = true,
}: {
  values: number[];
  label: string;
  details?: DashboardChartDetail[];
  zeroBased?: boolean;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const safeValues = values.length ? values : [0, 0];
  const max = Math.max(...safeValues);
  const min = zeroBased ? 0 : Math.min(...safeValues);
  const span = Math.max(1, max - min);
  const width = 560;
  const height = 172;
  const padX = 12;
  const padY = 16;
  const points = safeValues.map((value, index) => {
    const x = safeValues.length === 1 ? width / 2 : padX + (index / (safeValues.length - 1)) * (width - padX * 2);
    const y = height - padY - ((value - min) / span) * (height - padY * 2);
    return { x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${padX},${height - padY} ${line} ${width - padX},${height - padY}`;
  const activePoint = activeIndex === null ? null : points[activeIndex];
  const activeDetail = activeIndex === null ? null : details?.[activeIndex];

  function activateFromPointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = chartRef.current?.getBoundingClientRect();
    if (!bounds || safeValues.length < 1) return;
    setActiveIndex(dashboardChartIndex(event.clientX, bounds.left, bounds.width, safeValues.length));
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    setActiveIndex((current) => Math.max(0, Math.min(safeValues.length - 1, (current ?? safeValues.length - 1) + direction)));
  }

  return (
    <>
      <div
      aria-label={activeDetail ? `${label}, ${activeDetail.ariaLabel}` : label}
      className="cockpit-trading-chart"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setActiveIndex(null); }}
      onFocus={() => setActiveIndex((current) => current ?? safeValues.length - 1)}
      onKeyDown={moveWithKeyboard}
      onPointerEnter={activateFromPointer}
      onPointerLeave={() => setActiveIndex(null)}
      onPointerMove={activateFromPointer}
      ref={chartRef}
      role="img"
      tabIndex={0}
    >
      <svg className="cockpit-area-chart" viewBox={`0 0 ${width} ${height}`} aria-hidden preserveAspectRatio="none">
        <line x1="0" x2={width} y1="48" y2="48" />
        <line x1="0" x2={width} y1="96" y2="96" />
        <line x1="0" x2={width} y1="144" y2="144" />
        <polygon points={area} />
        <polyline points={line} />
        {activePoint ? <line className="cockpit-chart-crosshair" x1={activePoint.x} x2={activePoint.x} y1={padY} y2={height - padY} /> : null}
        {activePoint ? <circle className="cockpit-chart-active-point" cx={activePoint.x} cy={activePoint.y} r="5" /> : null}
      </svg>
      {activePoint && activeDetail ? (
        <div
          className="cockpit-chart-floating-value"
          data-edge={activeIndex === 0 ? "start" : activeIndex === safeValues.length - 1 ? "end" : "middle"}
          style={{ left: `${activePoint.x / width * 100}%`, top: `${activePoint.y / height * 100}%` }}
        >
          <strong>{activeDetail.primary}</strong>
          <span>{activeDetail.secondary}</span>
        </div>
      ) : null}
      </div>
      <span className="sr-only" aria-live="polite">{activeDetail?.ariaLabel || ""}</span>
    </>
  );
}

export type DashboardBudgetSegment = {
  label: string;
  value: number;
  color: string;
  formattedValue: string;
};

export function dashboardBudgetArcs(
  segments: readonly Pick<DashboardBudgetSegment, "value">[],
  total: number,
  circumference: number,
  gap = 3.5,
) {
  let offset = 0;
  return segments.map((segment) => {
    const length = total > 0 ? segment.value / total * circumference : 0;
    const arc = {
      length,
      visibleLength: Math.max(0, length - gap),
      dashOffset: offset ? -offset : 0,
      percent: total > 0 ? Math.round(segment.value / total * 100) : 0,
    };
    offset += length;
    return arc;
  });
}

export function DashboardBudgetDonut({
  segments,
  total,
  totalLabel,
  locale,
}: {
  segments: DashboardBudgetSegment[];
  total: number;
  totalLabel: string;
  locale: "fr" | "en";
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, "");
  const radius = 44;
  const circumference = Math.PI * 2 * radius;
  const arcs = dashboardBudgetArcs(segments, total, circumference);
  const active = activeIndex === null ? null : segments[activeIndex];

  return (
    <div
      className="cockpit-budget-body cockpit-budget-interactive"
      onPointerLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) setActiveIndex(null); }}
    >
      <div className="cockpit-budget-donut">
        <svg viewBox="0 0 120 120" role="img" aria-label={`${locale === "fr" ? "Budget planifié" : "Planned budget"}: ${totalLabel}`}>
          <defs>
            <filter id={`${gradientId}-glow`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <circle className="cockpit-budget-track" cx="60" cy="60" r={radius} />
          {segments.map((segment, index) => {
            const arc = arcs[index];
            return (
              <circle
                aria-hidden="true"
                className={`cockpit-budget-segment${activeIndex === index ? " is-active" : ""}${activeIndex !== null && activeIndex !== index ? " is-muted" : ""}`}
                cx="60"
                cy="60"
                key={segment.label}
                onPointerEnter={() => setActiveIndex(index)}
                r={radius}
                stroke={segment.color}
                strokeDasharray={`${arc.visibleLength} ${circumference - arc.visibleLength}`}
                strokeDashoffset={arc.dashOffset}
                style={activeIndex === index ? { filter: `url(#${gradientId}-glow)` } : undefined}
                transform="rotate(-90 60 60)"
              />
            );
          })}
        </svg>
        <div aria-live="polite">
          <strong>{active?.formattedValue ?? totalLabel}</strong>
          <span>{active?.label || (locale === "fr" ? "planifié" : "planned")}</span>
          {active ? <small>{Math.round(active.value / Math.max(1, total) * 100)}%</small> : null}
        </div>
      </div>
      <div className="cockpit-budget-categories">
        {segments.map((segment, index) => {
          const percent = arcs[index].percent;
          return (
            <button
              aria-label={`${segment.label}: ${segment.formattedValue}, ${percent}%`}
              className={activeIndex === index ? "is-active" : undefined}
              key={segment.label}
              onBlur={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => setActiveIndex(index)}
              onPointerEnter={() => setActiveIndex(index)}
              type="button"
            >
              <i style={{ background: segment.color }} />
              <span><strong>{segment.label}</strong><small>{percent}%</small></span>
              <em>{segment.formattedValue}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}
