"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toggleCustomPageDailyAction } from "@/app/actions";
import { useLanguage } from "@/components/LanguageProvider";

// Lets a custom page opt into the daily brief. Rendered in the page editor's
// status bar; the flag is persisted on the registry note frontmatter.
export function PageDailyToggle({ slug, enabled: initial }: { slug: string; enabled: boolean }) {
  const { t } = useLanguage();
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("slug", slug);
      formData.set("enabled", next ? "true" : "false");
      const result = await toggleCustomPageDailyAction(formData);
      if (result && !result.ok) setEnabled(!next);
    });
  }

  return (
    <button
      type="button"
      className={`page-daily-toggle${enabled ? " is-on" : ""}`}
      onClick={toggle}
      disabled={pending}
      title={enabled ? t("notes.inDailyOn") : t("notes.inDailyOff")}
      aria-pressed={enabled}
    >
      <Star size={13} aria-hidden fill={enabled ? "currentColor" : "none"} />
      <span>{t("notes.daily")}</span>
    </button>
  );
}
