/**
 * Switching between settings tabs (e.g. Appearance -> Assistant IA) is a
 * sibling navigation under the already-mounted shell layout: the (shell)
 * loading.tsx sits above that shared layout, so it never re-triggers here
 * and the old tab just sat frozen on screen until the new one resolved.
 * A loading.tsx at this exact segment re-fires on every [section] change.
 */
export default async function SettingsSectionLoading() {
  const t = await getTranslations();
  return (
    <>
      <header className="page-header settings-detail-header" aria-hidden>
        <span className="settings-back" style={{ opacity: 0 }}>&nbsp;</span>
        <div>
          <span className="skeleton-line is-title" />
        </div>
      </header>
      <div className="settings-detail" role="status" aria-busy="true">
        <span className="sr-only">{t["common.loading"]}</span>
        {[0, 1, 2].map((index) => (
          <div className="settings-group-card" key={index}>
            <span className="skeleton-line is-label" />
            <span className="skeleton-line" />
            <span className="skeleton-line is-short" />
          </div>
        ))}
      </div>
    </>
  );
}
import { getTranslations } from "@/lib/i18n-server";
