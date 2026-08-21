"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown, ArrowUp, BarChart3, Check, ChevronDown, LineChart } from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dictionary } from "@/lib/i18n";

export type FinanceMetricPoint = {
  date: string;
  value: number;
  estimated?: boolean;
  breakdown?: Array<{ label: string; value: number; color: string; detail?: string }>;
};

type Period = "7d" | "30d" | "90d" | "1y" | "all";
type View = "line" | "bar";

function formatCurrency(value: number, currency: string, locale: string, compact = false) {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    // Compact notation with only a maximum lets each ICU build decide whether to
    // keep a trailing zero: Node renders "34,0 k €" where the browser renders
    // "34 k €", so the server and client markup disagreed and React threw a
    // hydration error and re-rendered the tree. Pinning the minimum makes both
    // agree. Standard currency is 2/2 either way; stating it keeps this honest.
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);
}

function chartLabels(locale: string) {
  return dictionary(locale === "fr" ? "fr" : "en");
}

function windowPoints(points: FinanceMetricPoint[], period: Period) {
  if (period === "all" || !points.length) return points;
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
  const end = new Date(`${points.at(-1)!.date}T12:00:00`);
  end.setDate(end.getDate() - days);
  return points.filter((point) => new Date(`${point.date}T12:00:00`) >= end);
}

function FinanceTooltip({ active, payload, currency, locale }: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: FinanceMetricPoint }>;
  currency: string;
  locale: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const date = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${point.date}T12:00:00`));
  return <div className="finance-chart-tooltip"><span>{date}{point.estimated ? ` · ${chartLabels(locale)["finance.chart.estimated"]}` : ""}</span><strong>{formatCurrency(point.value, currency, locale)}</strong>{point.breakdown?.length ? <div>{point.breakdown.filter((row) => row.value).map((row) => <p key={row.label}><i style={{ background: row.color }} /><span>{row.label}{row.detail ? <small>{row.detail}</small> : null}</span><b>{formatCurrency(row.value, currency, locale)}</b></p>)}</div> : null}</div>;
}

export function FinanceMetricChart({
  title,
  points,
  currency,
  locale,
  color = "rgb(var(--accent-rgb))",
  compact = false,
  icon,
  subtitle,
  action,
}: {
  title: string;
  points: FinanceMetricPoint[];
  currency: string;
  locale: string;
  color?: string;
  compact?: boolean;
  icon?: ReactNode;
  subtitle?: string;
  action?: ReactNode;
}) {
  const labels = chartLabels(locale);
  const [period, setPeriod] = useState<Period>(compact ? "30d" : "90d");
  const [view, setView] = useState<View>("line");
  const [periodOpen, setPeriodOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const gradientId = `finance-metric-${useId().replaceAll(":", "")}`;
  const visible = useMemo(() => windowPoints(points, period), [points, period]);
  const values = visible.map((point) => point.value);
  const current = values.at(-1) || 0;
  const first = values[0] || 0;
  const previous = values.at(-2) ?? first;
  const delta = current - previous;
  const periodDelta = current - first;
  const percent = first ? periodDelta / first * 100 : 0;
  const high = values.length ? Math.max(...values) : 0;
  const low = values.length ? Math.min(...values) : 0;
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const periods: Array<[Period, string]> = [
    ["7d", labels["finance.chart.period7"]],
    ["30d", labels["finance.chart.period30"]],
    ["90d", labels["finance.chart.period90"]],
    ["1y", labels["finance.chart.periodYear"]],
    ["all", labels["finance.chart.periodAll"]],
  ];
  const selectedPeriod = periods.find(([value]) => value === period)?.[1] || "";

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setPeriodOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  return <section className={`finance-metric-card${compact ? " is-compact" : ""}`} ref={rootRef} style={{ "--finance-chart-color": color } as CSSProperties}>
    <header className="finance-metric-head">
      <div className="finance-metric-title">{icon ? <span>{icon}</span> : null}<div><strong>{title}</strong>{subtitle ? <small>{subtitle}</small> : null}</div>{compact ? null : <div className="finance-view-toggle" role="group" aria-label={labels["finance.chart.type"]}><button aria-label={labels["finance.chart.showLine"]} aria-pressed={view === "line"} onClick={() => setView("line")} type="button"><LineChart size={14} /></button><button aria-label={labels["finance.chart.showBars"]} aria-pressed={view === "bar"} onClick={() => setView("bar")} type="button"><BarChart3 size={14} /></button></div>}</div>
      <div className="finance-metric-tools"><span className={percent >= 0 ? "is-positive" : "is-negative"}>{percent >= 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}{Math.abs(percent).toFixed(1)}%</span><div className="finance-period-select"><button aria-expanded={periodOpen} onClick={() => setPeriodOpen((open) => !open)} type="button">{selectedPeriod}<ChevronDown size={13} /></button>{periodOpen ? <div role="menu">{periods.map(([value, label]) => <button key={value} onClick={() => { setPeriod(value); setPeriodOpen(false); }} role="menuitem" type="button"><span>{label}</span>{value === period ? <Check size={13} /> : null}</button>)}</div> : null}</div>{action}</div>
    </header>
    <div className="finance-metric-value"><strong>{formatCurrency(current, currency, locale)}</strong>{!compact ? <span className={delta >= 0 ? "is-positive" : "is-negative"}>{delta >= 0 ? "+" : ""}{formatCurrency(delta, currency, locale)} {labels["finance.chart.today"]}</span> : null}</div>
    {!compact ? <div className="finance-metric-stats"><span>{labels["finance.chart.high"]} <strong>{formatCurrency(high, currency, locale)}</strong></span><span>{labels["finance.chart.low"]} <strong>{formatCurrency(low, currency, locale)}</strong></span><span>{labels["finance.chart.change"]} <strong className={periodDelta >= 0 ? "is-positive" : "is-negative"}>{periodDelta >= 0 ? "+" : ""}{formatCurrency(periodDelta, currency, locale)}</strong></span></div> : null}
    <div className="finance-metric-plot">
      {visible.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={visible} margin={compact ? { top: 10, right: 2, bottom: 0, left: 2 } : { top: 18, right: 12, bottom: 10, left: 4 }}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <CartesianGrid stroke="var(--line-soft)" strokeDasharray="3 7" vertical={false} />
        <XAxis axisLine={false} dataKey="date" hide={compact} minTickGap={38} tick={{ fill: "var(--muted)", fontSize: 10 }} tickFormatter={(date) => new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en", { day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`))} tickLine={false} />
        <YAxis axisLine={false} domain={["auto", "auto"]} hide={compact} tick={{ fill: "var(--muted)", fontSize: 10 }} tickFormatter={(value) => formatCurrency(Number(value), currency, locale, true)} tickLine={false} width={64} />
        <Tooltip content={<FinanceTooltip currency={currency} locale={locale} />} cursor={{ stroke: color, strokeDasharray: "4 4", strokeWidth: 1 }} />
        {view === "line" ? <><Area dataKey="value" fill={`url(#${gradientId})`} stroke="none" type="monotone" /><Line activeDot={{ fill: color, r: 5, stroke: "var(--bg)", strokeWidth: 2 }} dataKey="value" dot={false} stroke={color} strokeWidth={compact ? 2 : 2.4} type="monotone" /></> : <Bar dataKey="value" fill={color} maxBarSize={compact ? 14 : 32} radius={[6, 6, 0, 0]} />}
      </ComposedChart></ResponsiveContainer> : <div className="finance-metric-empty">{labels["finance.chart.empty"]}</div>}
    </div>
    <footer className="finance-metric-footer"><span><strong className={delta >= 0 ? "is-positive" : "is-negative"}>{delta >= 0 ? "+" : ""}{formatCurrency(delta, currency, locale)}</strong> {labels["finance.chart.latestReading"]}</span><div><span><b>{formatCurrency(high, currency, locale, true)}</b> {labels["finance.chart.high"]}</span><i>·</i><span><b>{formatCurrency(low, currency, locale, true)}</b> {labels["finance.chart.low"]}</span><i>·</i><span><b>{formatCurrency(average, currency, locale, true)}</b> {labels["finance.chart.averageShort"]}</span></div></footer>
  </section>;
}
