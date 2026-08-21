import { getTranslations } from "@/lib/i18n-server";

/**
 * Every route in this group is force-dynamic, so a click waits on a full server
 * round-trip. Without a Suspense fallback the old page just sat there and the
 * app felt frozen; this skeleton paints immediately instead.
 *
 * Deliberately server-rendered and text-free: no dictionary lookup, no client
 * bundle, nothing that could itself delay the very frame it exists to show.
 */
export default async function ShellLoading() {
  const t = await getTranslations();
  return (
    <div className="dash route-skeleton" role="status" aria-busy="true">
      <span className="sr-only">{t["common.loading"]}</span>
      <div className="route-skeleton-head">
        <span className="skeleton-line is-eyebrow" />
        <span className="skeleton-line is-title" />
      </div>
      <div className="route-skeleton-cards">
        {[0, 1, 2].map((index) => (
          <div className="route-skeleton-card" key={index}>
            <span className="skeleton-line is-label" />
            <span className="skeleton-line" />
            <span className="skeleton-line is-short" />
          </div>
        ))}
      </div>
    </div>
  );
}
