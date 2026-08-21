import { notFound } from "next/navigation";
import { NotesWorkspace } from "@/components/NotesWorkspace";
import { noteForClient, readNote } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function EditNotePage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const relativePath = path.map(decodeURIComponent).join("/");
  const note = await readNote(relativePath);
  if (!note) notFound();

  const backHref = note.kind === "objective"
    ? "/objectives"
    : note.kind === "task"
      ? "/tasks"
      : note.kind === "capture"
        ? "/inbox"
        : note.kind === "wiki"
          ? "/wiki"
          : "/notes";

  return (
    <>
      <NotesWorkspace notes={[noteForClient(note)]} singleNote backHref={backHref} />
    </>
  );
}
