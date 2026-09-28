"use client";

import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { saveNavigationAction } from "@/app/actions";
import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { MAIN_NAV_HREFS, UTILITY_NAV_HREFS, type ConfigurableNavHref } from "@/lib/navigation";

const LABEL_KEYS: Record<ConfigurableNavHref, TranslationKey> = {
  "/": "nav.dashboard",
  "/daily": "nav.daily",
  "/weekly": "nav.weekly",
  "/notes": "nav.notes",
  "/tasks": "nav.tasks",
  "/objectives": "nav.objectives",
  "/business": "nav.business",
  "/applications": "nav.applications",
  "/finances": "nav.finances",
  "/budget": "nav.budget",
  "/training": "nav.trail",
  "/revisions": "nav.radio",
  "/wiki": "nav.wiki",
  "/assistant": "nav.assistant",
  "/setup": "nav.setup",
  "/inbox": "nav.inbox",
  "/feeds": "nav.feeds",
  "/trash": "nav.trash",
};

export function NavigationSettings({ hidden }: { hidden: ConfigurableNavHref[] }) {
  const { t } = useLanguage();
  const hiddenSet = new Set(hidden);

  function group(title: string, hrefs: readonly ConfigurableNavHref[]) {
    return (
      <fieldset className="settings-nav-choices">
        <legend>{title}</legend>
        {hrefs.map((href) => {
          const visible = !hiddenSet.has(href);
          return (
            <label key={href}>
              <input type="checkbox" name="visibleNav" value={href} defaultChecked={visible} />
              <span className="settings-nav-choice-icon" aria-hidden>{visible ? <Eye size={15} /> : <EyeOff size={15} />}</span>
              <span><strong>{t(LABEL_KEYS[href])}</strong><small>{href}</small></span>
            </label>
          );
        })}
      </fieldset>
    );
  }

  return (
    <form action={saveNavigationAction} className="settings-nav-form">
      <div className="settings-nav-groups">
        {group(t("settings.navigationMain"), MAIN_NAV_HREFS)}
        {group(t("settings.navigationUtility"), UTILITY_NAV_HREFS)}
      </div>
      <div className="settings-nav-save">
        <p><LockKeyhole size={14} aria-hidden />{t("settings.navigationRecovery")}</p>
        <button className="button primary" type="submit">{t("settings.navigationSave")}</button>
      </div>
    </form>
  );
}
