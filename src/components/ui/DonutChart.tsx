"use client";

// The single donut used everywhere a share-of-total is drawn (dashboard
// modules, area focus, finance allocation, budget breakdown, note charts).
// One geometry, one palette, one interaction model: hover or focus highlights a
// slice and swaps the centre readout, a click pins that highlight until it is
// clicked again (the only way to reach it on touch, where hover never fires).

import { useState, type CSSProperties, type ReactNode } from "react";

export type DonutSegment = {
  label: string;
  value: number;
  color?: string;
  formattedValue?: string;
};

// Categorical palette shared by every donut. The hues live in globals.css as
// --chart-1..9 so the palette picked in Settings swaps them everywhere at once;
// each one is saturated enough to stay visible on a light card, since a
// near-grey entry reads as a missing slice.
const DONUT_PALETTE = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6", "--chart-7", "--chart-8", "--chart-9"]
  .map((token) => `var(${token})`);

const BOX = 120;
const STROKE = 14;
const R = (BOX - STROKE) / 2;
const C = 2 * Math.PI * R;
const GAP = 4;

type PointerProps = {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
};

type DonutSelection = {
  active: number | null;
  hoverProps: (index: number) => PointerProps;
  segmentProps: (index: number) => PointerProps & { onClick: () => void };
};

export function useDonutSelection(): DonutSelection {
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const hoverProps = (index: number): PointerProps => ({
    onMouseEnter: () => setHover(index),
    onMouseLeave: () => setHover((current) => (current === index ? null : current)),
    onFocus: () => setHover(index),
    onBlur: () => setHover((current) => (current === index ? null : current)),
  });
  return {
    active: hover ?? pinned,
    hoverProps,
    segmentProps: (index) => ({
      ...hoverProps(index),
      onClick: () => setPinned((current) => (current === index ? null : index)),
    }),
  };
}

function withPalette(segments: DonutSegment[]): DonutSegment[] {
  return segments.map((segment, index) => ({
    ...segment,
    color: segment.color ?? DONUT_PALETTE[index % DONUT_PALETTE.length],
  }));
}

// Ring only: callers that already own a rich legend (finance, budget) render
// this and drive `selection` from their own rows. Segment indexes must match
// the caller's list, so nothing is filtered here — zero-value slices are simply
// not drawn.
export function DonutRing({
  segments,
  centerValue,
  centerSub,
  ariaLabel,
  selection,
  className,
}: {
  segments: DonutSegment[];
  centerValue: ReactNode;
  centerSub: ReactNode;
  ariaLabel?: string;
  selection: DonutSelection;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const drawn = segments.filter((segment) => segment.value > 0).length;
  const gap = drawn > 1 ? GAP : 0;
  const lengths = segments.map((segment) => (total ? (Math.max(0, segment.value) / total) * C : 0));

  const active = selection.active !== null ? segments[selection.active] : undefined;
  const value = active ? active.formattedValue ?? String(active.value) : centerValue;
  const sub = active ? active.label : centerSub;
  // The centre readout must stay inside the hole whatever it holds ("10" or
  // "34,1 k €"), so its length drives the font size (see --viz-value-len).
  const valueLength = typeof value === "string" || typeof value === "number" ? String(value).length : 4;

  return (
    <div className={`viz-donut${className ? ` ${className}` : ""}`}>
      <svg className="viz-donut-svg" viewBox={`0 0 ${BOX} ${BOX}`} role="img" aria-label={ariaLabel}>
        <circle className="viz-donut-track" cx={BOX / 2} cy={BOX / 2} r={R} fill="none" strokeWidth={STROKE} />
        <g transform={`rotate(-90 ${BOX / 2} ${BOX / 2})`}>
          {segments.map((segment, index) => {
            if (segment.value <= 0) return null;
            const dash = Math.max(1.5, lengths[index] - gap);
            const offset = -lengths.slice(0, index).reduce((sum, length) => sum + length, 0);
            const state = selection.active === null ? "" : selection.active === index ? " is-active" : " is-dim";
            return (
              <circle
                key={`${segment.label}-${index}`}
                className={`viz-donut-arc${state}`}
                cx={BOX / 2}
                cy={BOX / 2}
                r={R}
                fill="none"
                strokeWidth={STROKE}
                strokeLinecap="round"
                stroke={segment.color ?? DONUT_PALETTE[index % DONUT_PALETTE.length]}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={offset}
                {...selection.segmentProps(index)}
              >
                <title>{`${segment.label} · ${segment.formattedValue ?? segment.value}`}</title>
              </circle>
            );
          })}
        </g>
      </svg>
      <div className="viz-donut-hole">
        <span className="viz-donut-value" style={{ "--viz-value-len": valueLength } as CSSProperties}>{value}</span>
        <span className="viz-donut-sub">{sub}</span>
      </div>
    </div>
  );
}

// Ring plus the default legend. Zero-value segments are dropped first so the
// palette, the arcs and the legend rows all share one index.
export function DonutChart({
  segments,
  centerValue,
  centerSub,
  ariaLabel,
}: {
  segments: DonutSegment[];
  centerValue: ReactNode;
  centerSub: ReactNode;
  ariaLabel?: string;
}) {
  const selection = useDonutSelection();
  const shown = withPalette(segments.filter((segment) => segment.value > 0));

  return (
    <div className="viz-donut-wrap">
      <DonutRing
        segments={shown}
        centerValue={centerValue}
        centerSub={centerSub}
        ariaLabel={ariaLabel}
        selection={selection}
      />
      {/* Every drawn arc gets a row: a slice with no row is a colour the reader
          cannot explain. Rows are buttons so touch and keyboard reach the same
          highlight the mouse does. */}
      <ul className="viz-legend">
        {shown.map((segment, index) => (
          <li key={`${segment.label}-${index}`}>
            <button
              type="button"
              className={`viz-legend-row${selection.active === null ? "" : selection.active === index ? " is-active" : " is-dim"}`}
              aria-pressed={selection.active === index}
              {...selection.segmentProps(index)}
            >
              <span className="viz-legend-dot" style={{ background: segment.color }} />
              <span className="viz-legend-name">{segment.label}</span>
              <span className="viz-legend-count">{segment.formattedValue ?? segment.value}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
