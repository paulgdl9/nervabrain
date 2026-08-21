"use client";

import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { useLanguage } from "@/components/LanguageProvider";

export type WeeklyActivityPoint = {
  id: string;
  day: string;
  date: string;
  name: string;
  value: number;
  formatted: string;
  detail: string;
};

function ActivityTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as WeeklyActivityPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="weekly-activity-tooltip">
      <span>{point.date}</span>
      <strong>{point.formatted}</strong>
      <small>{point.name}</small>
    </div>
  );
}

export function WeeklyActivityMiniChart({ points }: { points: WeeklyActivityPoint[] }) {
  const { t } = useLanguage();
  const gradientId = `weekly-activity-${useId().replaceAll(":", "")}`;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const data = points.map((point, index) => ({ ...point, index, chartIndex: points.length === 1 ? 0.5 : index }));
  const selected = data.find((point) => point.id === selectedId) || data.at(-1);

  if (!data.length) return <div className="weekly-activity-empty">{t("training.chart.noSessionWeek")}</div>;

  return (
    <div className="weekly-activity-chart">
      <div className="weekly-activity-plot">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 12, right: 8, bottom: 0, left: 8 }}
            accessibilityLayer
            onClick={(state) => {
              const index = Number(state.activeTooltipIndex);
              if (Number.isInteger(index) && data[index]) setSelectedId(data[index].id);
            }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity=".24" />
                <stop offset="1" stopColor="currentColor" stopOpacity=".03" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line-soft)" strokeDasharray="2 5" />
            <XAxis dataKey="chartIndex" type="number" domain={[0, Math.max(1, data.length - 1)]} ticks={data.map((point) => point.chartIndex)} tickFormatter={(index) => data.find((point) => point.chartIndex === index)?.day || ""} axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 9 }} />
            <YAxis hide domain={[0, (maximum: number) => Math.max(1, maximum * 1.15)]} />
            <Tooltip content={ActivityTooltip} cursor={{ stroke: "currentColor", strokeWidth: 1.5 }} />
            {selected && <ReferenceLine x={selected.chartIndex} stroke="currentColor" strokeOpacity=".55" strokeWidth={1.5} />}
            <Area type="linear" dataKey="value" stroke="currentColor" strokeWidth={2.5} fill={`url(#${gradientId})`} dot={{ r: 4, fill: "var(--card-surface)", stroke: "currentColor", strokeWidth: 2.5 }} activeDot={{ r: 5.5, fill: "currentColor", stroke: "var(--card-surface)", strokeWidth: 2 }} isAnimationActive={false} />
            {selected && <ReferenceDot x={selected.chartIndex} y={selected.value} r={5} fill="currentColor" stroke="var(--card-surface)" strokeWidth={2} />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {selected && (
        <div className="weekly-activity-detail" aria-live="polite">
          <span>{selected.date}</span>
          <strong>{selected.name}</strong>
          <b>{selected.formatted}</b>
          <small>{selected.detail}</small>
        </div>
      )}
    </div>
  );
}
