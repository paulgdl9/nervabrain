import Link from "next/link";
import { ChevronRight, Wrench } from "lucide-react";
import { getTranslations } from "@/lib/i18n-server";
import { SETTINGS_SECTIONS } from "./sections";

export const dynamic = "force-dynamic";

/**
 * An index of sections rather than one long page: every setting used to be
 * stacked on a single screen behind anchor links, which on a phone was an
 * unreadable wall. Each row opens its own screen, the pattern people already
 * know from their phone's own settings.
 */
export default async function SettingsPage() {
  const t = await getTranslations();
  return (
    <>
      <header className="page-header settings-hero">
        <div>
          <p className="eyebrow">{t["settings.eyebrow"]}</p>
          <h1>{t["settings.title"]}</h1>
        </div>
      </header>

      <nav className="settings-index" aria-label={t["settings.title"]}>
        {SETTINGS_SECTIONS.map((section) => (
          <Link className="settings-index-row" href={`/settings/${section.id}`} key={section.id}>
            <span className="settings-index-icon" aria-hidden>{section.icon}</span>
            <span className="settings-index-copy">
              <strong>{t[section.title]}</strong>
              <small>{t[section.description]}</small>
            </span>
            <ChevronRight className="settings-index-chevron" size={17} aria-hidden />
          </Link>
        ))}
      </nav>

      <section className="settings-index-footer">
        <div>
          <strong>{t["settings.setup"]}</strong>
          <small>{t["settings.setupDescription"]}</small>
        </div>
        <Link className="button secondary" href="/setup/language">
          <Wrench size={15} aria-hidden />
          {t["settings.openSetup"]}
        </Link>
      </section>
    </>
  );
}
