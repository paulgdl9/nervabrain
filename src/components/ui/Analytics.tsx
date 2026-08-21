import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useId, type CSSProperties, type ReactNode } from "react";

export type MetricTone = "neutral" | "accent" | "positive" | "negative" | "info" | "warning";

export type MetricItem = {
  label: string;
  value: string | number;
  detail?: string;
  change?: string;
  changeTone?: "positive" | "negative" | "neutral";
  href?: string;
  icon?: ReactNode;
  tone?: MetricTone;
  series?: number[];
  content?: ReactNode;
};

function smoothPath(values: number[], width = 240, height = 82) {
  if (values.length < 2) return `M0 ${height / 2} L${width} ${height / 2}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => ({
    x: index / (values.length - 1) * width,
    y: height - 8 - (value - min) / range * (height - 16),
  }));
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const mid = (previous.x + point.x) / 2;
    return `${path} C${mid} ${previous.y},${mid} ${point.y},${point.x} ${point.y}`;
  }, `M${points[0].x} ${points[0].y}`);
}

export function Sparkline({ values, label, tone = "accent", large = false }: { values: number[]; label: string; tone?: MetricTone; large?: boolean }) {
  const id = useId().replaceAll(":", "");
  const width = large ? 640 : 240;
  const height = large ? 190 : 82;
  const path = smoothPath(values, width, height);
  return (
    <svg className={`ui-sparkline is-${tone}${large ? " is-large" : ""}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".2" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="ui-sparkline-grid" d={`M0 ${height * .33} H${width} M0 ${height * .66} H${width}`} />
      <path className="ui-sparkline-area" d={`${path} L${width} ${height} L0 ${height} Z`} fill={`url(#spark-${id})`} />
      <path className="ui-sparkline-line" d={path} />
    </svg>
  );
}

function Change({ value, tone = "neutral" }: { value: string; tone?: "positive" | "negative" | "neutral" }) {
  return (
    <span className={`ui-metric-change is-${tone}`}>
      {tone === "positive" ? <ArrowUpRight size={13} /> : tone === "negative" ? <ArrowDownRight size={13} /> : <Minus size={13} />}
      {value}
    </span>
  );
}

export function MetricCards({ items, className = "", viewLabel = "View" }: { items: MetricItem[]; className?: string; viewLabel?: string }) {
  return (
    <div className={`ui-metric-grid ${className}`} style={{ "--metric-columns": Math.min(4, Math.max(1, items.length)) } as CSSProperties}>
      {items.map((item) => {
        const content = (
          <>
            <div className="ui-metric-top">
              <span className="ui-metric-label">{item.icon ? <i>{item.icon}</i> : null}{item.label}</span>
              {item.change ? <Change value={item.change} tone={item.changeTone} /> : null}
            </div>
            <strong className="ui-metric-value">{item.value}</strong>
            {item.series?.length ? <Sparkline values={item.series} label={`${item.label} · ${item.value}`} tone={item.tone} /> : null}
            {item.content}
            <div className="ui-metric-footer">
              <small>{item.detail || " "}</small>
              {item.href ? <span>{viewLabel} <ArrowUpRight size={12} /></span> : null}
            </div>
          </>
        );
        return item.href ? <Link className={`ui-metric-card is-${item.tone || "neutral"}`} href={item.href} key={item.label}>{content}</Link> : <article className={`ui-metric-card is-${item.tone || "neutral"}`} key={item.label}>{content}</article>;
      })}
    </div>
  );
}

export type ProgressItem = { label: string; value: number; detail: string; tone?: MetricTone };

export function ProgressRing({ value, label, tone = "accent" }: { value: number; label: string; tone?: MetricTone }) {
  const progress = Math.max(0, Math.min(100, Math.round(value)));
  return <span className={`ui-progress-ring is-${tone}`} aria-label={`${label}: ${progress}%`} style={{ "--progress": `${progress * 3.6}deg` } as CSSProperties}><strong>{progress}%</strong></span>;
}

export function ProgressOverview({
  eyebrow,
  title,
  description,
  primary,
  items,
}: {
  eyebrow: string;
  title: string;
  description: string;
  primary: { label: string; value: number; target: string; detail?: string };
  items: ProgressItem[];
}) {
  const progress = Math.max(0, Math.min(100, Math.round(primary.value)));
  return (
    <section className="ui-progress-overview">
      <header className="ui-progress-heading"><div><span>{eyebrow}</span><h2>{title}</h2></div><p>{description}</p></header>
      <div className="ui-progress-layout">
        <article className="ui-progress-primary">
          <small>{primary.label}</small>
          <strong>{progress}%</strong>
          <span>{primary.target}</span>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
          {primary.detail ? <p>{primary.detail}</p> : null}
        </article>
        <div className="ui-progress-items">
          {items.map((item) => <article key={item.label}><ProgressRing value={item.value} label={item.label} tone={item.tone} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></article>)}
        </div>
      </div>
    </section>
  );
}
