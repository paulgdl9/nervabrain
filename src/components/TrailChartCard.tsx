"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export function TrailChartCard({
  className,
  kicker,
  title,
  headerAside,
  children,
}: {
  className: string;
  kicker: string;
  title: string;
  headerAside?: ReactNode;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { t } = useLanguage();
  const replaceTitle = (value: string) => value.replace("{title}", title);

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(document.fullscreenElement === cardRef.current);
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  async function toggleFullscreen() {
    if (document.fullscreenElement === cardRef.current) {
      await document.exitFullscreen();
      return;
    }
    await cardRef.current?.requestFullscreen();
  }

  return (
    <section className={`trail-card chart-card ${className}`} ref={cardRef}>
      <div className="trail-card-head">
        <div><span className="trail-card-kicker">{kicker}</span><h2>{title}</h2></div>
        <div className="trail-chart-head-actions">
          {headerAside}
          <button
            type="button"
            className="chart-fullscreen-button"
            onClick={toggleFullscreen}
            aria-label={replaceTitle(t(isFullscreen ? "training.chart.exitFullscreen" : "training.chart.enterFullscreen"))}
            title={t(isFullscreen ? "training.chart.exitFullscreenShort" : "training.chart.enterFullscreenShort")}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>
      {children}
    </section>
  );
}
