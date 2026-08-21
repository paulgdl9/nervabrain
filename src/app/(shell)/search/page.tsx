import { NoteCard } from "@/components/NoteCard";
import { searchNotes } from "@/lib/vault";
import { getTranslations } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const [results, t] = await Promise.all([q ? searchNotes(q) : [], getTranslations()]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t["page.search.eyebrow"]}</p>
          <h1>{q || t["page.search.title"]}</h1>
          <p className="muted">{results.length} {t["page.search.results"]}</p>
        </div>
      </header>
      <section className="panel">
        <div className="note-list">
          {results.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
          {q && !results.length && <div className="empty">{t["page.search.noResult"]}</div>}
        </div>
      </section>
    </>
  );
}
