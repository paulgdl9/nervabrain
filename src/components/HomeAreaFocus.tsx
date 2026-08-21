"use client";

import { useEffect, useState } from "react";
import { DonutChart } from "@/components/ui/DonutChart";

// Same hues as the Tasks/Objectives workspaces, and the same localStorage key
// they use for per-area custom colours, so the dashboard donut matches exactly.
const HUE = {
  orange: "#f97316",
  amber: "#f59e0b",
  green: "#40c06d",
  blue: "#4d9bff",
  purple: "#a855f7",
  pink: "#ec4899",
  red: "#ef4444",
};
const AREA_HUE: Record<string, string> = {
  business: HUE.orange,
  knowledge: HUE.green,
  sport: HUE.red,
  finance: HUE.green,
  personal: HUE.purple,
  career: HUE.pink,
  projects: HUE.blue,
  work: HUE.amber,
  learning: HUE.green,
  health: HUE.green,
};
// Unknown areas fall through to the shared donut palette (undefined colour),
// so two custom areas never render as the same flat grey ring.
function defaultAreaHue(area: string): string | undefined {
  return AREA_HUE[area.toLowerCase().replace(/\s+/g, "")];
}

export function HomeAreaFocus({
  segments,
  total,
  tasksLabel,
}: {
  segments: { name: string; count: number }[];
  total: number;
  tasksLabel: string;
}) {
  // Per-area colours the user set in the workspace live in localStorage; read
  // them so a custom (e.g. purple) area shows its real colour, not the default.
  const [custom, setCustom] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const stored = localStorage.getItem("obj-area-colors");
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, string>;
        queueMicrotask(() => setCustom(parsed));
      }
    } catch {
      // ignore malformed / unavailable storage
    }
  }, []);

  return (
    <DonutChart
      segments={segments.map((segment) => ({
        label: segment.name,
        value: segment.count,
        color: custom[segment.name] ?? defaultAreaHue(segment.name),
      }))}
      centerValue={total}
      centerSub={tasksLabel}
      ariaLabel={tasksLabel}
    />
  );
}
