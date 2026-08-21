import { notFound } from "next/navigation";
import { NotesWorkspace } from "@/components/NotesWorkspace";
import { PageDailyToggle } from "@/components/PageDailyToggle";
import { PageIconPicker } from "@/components/PageIconPicker";
import { getCustomPage, noteForClient, readNote } from "@/lib/vault";

export const dynamic = "force-dynamic";

// A custom page is just a free-form Markdown document (its registry note),
// edited with the full block editor — headings, tables, charts, code, etc.
export default async function CustomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getCustomPage(slug);
  if (!page) notFound();

  const note = await readNote(page.relativePath);
  if (!note) notFound();

  return (
    <>
      <NotesWorkspace
        notes={[noteForClient(note)]}
        singleNote
        isPage
        backHref="/"
        dailyToggle={<PageDailyToggle slug={slug} enabled={note.data.daily === true} />}
        pageIcon={<PageIconPicker slug={slug} icon={typeof note.data.icon === "string" ? note.data.icon : ""} />}
      />
    </>
  );
}
