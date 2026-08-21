"use client";

import { useState, type CSSProperties } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import type { BriefDetail } from "@/lib/vault";
import styles from "./BriefDetailSetting.module.css";

const LEVELS: BriefDetail[] = ["concise", "balanced", "detailed"];

export function BriefDetailSetting({ value }: { value: BriefDetail }) {
  const { locale } = useLanguage();
  const labels = locale === "fr" ? ["Concis", "Équilibré", "Détaillé"] : ["Concise", "Balanced", "Detailed"];
  const [index, setIndex] = useState(Math.max(0, LEVELS.indexOf(value)));
  const title = locale === "fr" ? "Niveau de détail" : "Detail level";

  return (
    <fieldset className={`settings-group ${styles.detail}`}>
      <legend className={styles.legend}>
        {title} · <strong>{labels[index]}</strong>
      </legend>
      <div className={styles.segmented} style={{ "--index": index } as CSSProperties}>
        <span className={styles.pill} aria-hidden="true" />
        {labels.map((label, i) => (
          <label key={label} className={styles.segment}>
            <input
              type="radio"
              name="briefDetail"
              value={i}
              checked={index === i}
              onChange={() => setIndex(i)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <p className="muted">
        {locale === "fr"
          ? "Ajuste la profondeur des synthèses quotidiennes et hebdomadaires."
          : "Adjusts the depth of daily and weekly summaries."}
      </p>
    </fieldset>
  );
}
