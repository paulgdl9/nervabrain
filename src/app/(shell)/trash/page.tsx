import { TrashView } from "@/components/TrashView";
import { listTrash } from "@/lib/vault";
import { getTranslations } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function TrashPage() {
  const [items, t] = await Promise.all([listTrash(), getTranslations()]);

  return (
    <>
      <div className="dash">
        <header className="dash-header">
          <div className="dash-greeting">
            <p className="eyebrow">{t["page.trash.eyebrow"]}</p>
            <h1>{t["page.trash.title"]}</h1>
            <p className="muted">{t["page.trash.description"]}</p>
          </div>
        </header>
        <TrashView items={items} />
      </div>
    </>
  );
}
