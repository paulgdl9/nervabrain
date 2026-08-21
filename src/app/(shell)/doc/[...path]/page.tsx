import { notFound } from "next/navigation";
import { NotesWorkspace } from "@/components/NotesWorkspace";
import { noteForClient, readNote } from "@/lib/vault";

export const dynamic = "force-dynamic";

const BACK_BY_KIND: Record<string, string> = {
  objective: "/objectives",
  task: "/tasks",
  capture: "/inbox",
  raw: "/notes",
  wiki: "/wiki",
};

export default async function DocPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const relativePath = path.map(decodeURIComponent).join("/");
  const note = await readNote(relativePath);
  if (!note) notFound();

  const backHref = BACK_BY_KIND[note.kind] || "/notes";

  return (
    <>
      <NotesWorkspace notes={[noteForClient(note)]} singleNote backHref={backHref} />
    </>
  );
}
