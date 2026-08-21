"use client";

import { useState, useTransition } from "react";
import { Activity, BookOpenCheck, BriefcaseBusiness, Check, Landmark, RefreshCw, Save, WalletCards } from "lucide-react";
import { saveModuleSettingsAction } from "@/app/actions";
import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import type { SetupState } from "@/lib/vault";

type ModuleKey = "finance" | "budget" | "trail" | "business" | "revisions";

const MODULES: Array<{
  key: ModuleKey;
  label: TranslationKey;
  description: TranslationKey;
  icon: typeof Landmark;
}> = [
  { key: "finance", label: "setup.module.finance", description: "setup.module.financeDescription", icon: Landmark },
  { key: "budget", label: "setup.module.budget", description: "setup.module.budgetDescription", icon: WalletCards },
  { key: "trail", label: "setup.module.trail", description: "setup.module.trailDescription", icon: Activity },
  { key: "business", label: "setup.module.business", description: "setup.module.businessDescription", icon: BriefcaseBusiness },
  { key: "revisions", label: "setup.module.revisions", description: "setup.module.revisionsDescription", icon: BookOpenCheck },
];

export function ModuleSettings({ modules: initialModules }: { modules: SetupState["modules"] }) {
  const { t } = useLanguage();
  const [modules, setModules] = useState<Record<ModuleKey, boolean>>({
    finance: initialModules.finance,
    budget: initialModules.budget,
    trail: initialModules.trail,
    business: initialModules.business,
    revisions: initialModules.revisions,
  });
  // Kept outside MODULES: this switches the Garmin worker off while leaving
  // the training pages in place, so it is not a module of its own.
  const [trailSync, setTrailSync] = useState(initialModules.trailSync);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="settings-modules-form"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setSaved(false);
        startTransition(async () => {
          const result = await saveModuleSettingsAction(formData);
          setSaved(result.ok);
        });
      }}
    >
      <div className="setup-module-grid settings-module-grid">
        {MODULES.map((module) => {
          const Icon = module.icon;
          return (
            <label className={`setup-module-card ${modules[module.key] ? "is-selected" : ""}`} key={module.key}>
              <input
                type="checkbox"
                name={module.key}
                checked={modules[module.key]}
                onChange={(event) => {
                  setSaved(false);
                  setModules((current) => ({ ...current, [module.key]: event.target.checked }));
                }}
              />
              <span className="setup-module-icon"><Icon size={20} /></span>
              <span><strong>{t(module.label)}</strong><small>{t(module.description)}</small></span>
              <span className="setup-module-check" aria-hidden="true"><Check size={14} /></span>
            </label>
          );
        })}
      </div>
      <div className="setup-module-grid settings-module-grid">
        <label className={`setup-module-card ${trailSync ? "is-selected" : ""}`}>
          <input
            type="checkbox"
            name="trailSync"
            checked={trailSync}
            onChange={(event) => {
              setSaved(false);
              setTrailSync(event.target.checked);
            }}
          />
          <span className="setup-module-icon"><RefreshCw size={20} /></span>
          <span><strong>{t("settings.garminSync")}</strong><small>{t("settings.garminSyncDescription")}</small></span>
          <span className="setup-module-check" aria-hidden="true"><Check size={14} /></span>
        </label>
      </div>
      <div className="settings-modules-actions">
        <span role="status">{saved ? t("settings.modulesSaved") : t("settings.modulesHint")}</span>
        <button className="button primary" type="submit" disabled={pending}>
          <Save size={15} aria-hidden />
          {pending ? t("settings.modulesSaving") : t("settings.modulesSave")}
        </button>
      </div>
    </form>
  );
}
