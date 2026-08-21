"use client";

import { useState } from "react";
import { DonutChart, type DonutSegment } from "@/components/ui/DonutChart";
import { FinanceMetricChart, type FinanceMetricPoint } from "@/components/ui/FinanceMetricChart";

type View = "allocation" | "curve";

export function FinanceWidget({
  total,
  segments,
  centerValue,
  centerSub,
  emptyLabel,
  netWorthPoints,
  netWorthTitle,
  currency,
  locale,
  allocationLabel,
  curveLabel,
  toggleLabel,
}: {
  total: number;
  segments: DonutSegment[];
  centerValue: string;
  centerSub: string;
  emptyLabel: string;
  netWorthPoints: FinanceMetricPoint[];
  netWorthTitle: string;
  currency: string;
  locale: string;
  allocationLabel: string;
  curveLabel: string;
  toggleLabel: string;
}) {
  const hasHistory = netWorthPoints.length >= 2;
  const [view, setView] = useState<View>("allocation");
  const showCurve = hasHistory && view === "curve";
  return (
    <div className="finance-widget">
      {hasHistory ? (
        <div className="segmented-control finance-widget-toggle" role="radiogroup" aria-label={toggleLabel}>
          <button
            type="button"
            role="radio"
            aria-checked={!showCurve}
            className={showCurve ? "" : "is-active"}
            onClick={() => setView("allocation")}
          >
            {allocationLabel}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={showCurve}
            className={showCurve ? "is-active" : ""}
            onClick={() => setView("curve")}
          >
            {curveLabel}
          </button>
        </div>
      ) : null}
      <div className="finance-widget-body">
        <div className={`finance-widget-panel${showCurve ? " is-inactive" : ""}`}>
          {total > 0 ? (
            <DonutChart segments={segments} centerValue={centerValue} centerSub={centerSub} ariaLabel={allocationLabel} />
          ) : (
            <div className="dashboard-module-empty">{emptyLabel}</div>
          )}
        </div>
        {hasHistory ? (
          <div className={`finance-widget-panel${showCurve ? "" : " is-inactive"}`}>
            <FinanceMetricChart title={netWorthTitle} points={netWorthPoints} currency={currency} locale={locale} compact />
          </div>
        ) : null}
      </div>
    </div>
  );
}
