import Link from "next/link";
import { Settings2 } from "lucide-react";
import { FeedsManager } from "@/components/Feeds";
import { readFeeds } from "@/lib/vault";
import { getTranslations } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function FeedsPage() {
  const [config, t] = await Promise.all([readFeeds(), getTranslations()]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t["page.feeds.eyebrow"]}</p>
          <h1>{t["page.feeds.title"]}</h1>
          <p className="muted">{t["page.feeds.description"]}</p>
        </div>
        <Link className="button secondary" href="/settings/feeds"><Settings2 size={15} aria-hidden />{t["page.feeds.settingsCta"]}</Link>
      </header>
      <FeedsManager config={config} />
    </>
  );
}
