import { NotesWorkspace } from "@/components/NotesWorkspace";
import { getDashboard, noteForClient } from "@/lib/vault";
import { getTranslations } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const [data, t] = await Promise.all([getDashboard(), getTranslations()]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t["page.notes.eyebrow"]}</p>
          <h1>{t["page.notes.title"]}</h1>
          <p className="muted">{data.allNotes.length} {t["page.notes.count"]}</p>
        </div>
      </header>

      <NotesWorkspace notes={data.allNotes.map(noteForClient)} />
    </>
  );
}
