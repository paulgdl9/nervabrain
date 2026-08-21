"use client";

import { Languages } from "lucide-react";
import { type Locale } from "@/lib/i18n";
import { useLanguage } from "@/components/LanguageProvider";

const OPTIONS: { id: Locale; nativeLabel: string; translationKey: "language.french" | "language.english" }[] = [
  { id: "fr", nativeLabel: "Français", translationKey: "language.french" },
  { id: "en", nativeLabel: "English", translationKey: "language.english" },
];

export function LanguagePicker() {
  const { locale, setLocale, t } = useLanguage();

  return (
    <div className="language-setting">
      <div className="language-setting-copy">
        <Languages size={20} aria-hidden />
        <div>
          <strong>{t("language.name")}</strong>
          <p className="muted">{t("language.description")}</p>
        </div>
      </div>
      <div className="theme-picker" role="radiogroup" aria-label={t("language.current")}>
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`button theme-picker-option language-option ${locale === option.id ? "primary" : "secondary"}`}
            role="radio"
            aria-checked={locale === option.id}
            onClick={() => locale !== option.id && setLocale(option.id)}
          >
            <span className="language-code" aria-hidden>{option.id.toUpperCase()}</span>
            <span>
              <strong>{option.nativeLabel}</strong>
              <small>{t(option.translationKey)}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
