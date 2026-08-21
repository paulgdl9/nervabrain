import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BrainCircuit, Pencil, Pin, PinOff } from "lucide-react";
import { MarkdownView } from "@/components/MarkdownView";
import { NotesWorkspace } from "@/components/NotesWorkspace";
import { noteForClient, readNote } from "@/lib/vault";
import { togglePinNoteAction } from "@/app/actions";
import { getTranslations } from "@/lib/i18n-server";
import { sanitizeBriefOutput } from "@/lib/markdown";

export const dynamic = "force-dynamic";

const BACK_BY_KIND: Record<string, { href: string; labelKey: "nav.objectives" | "nav.tasks" | "nav.inbox" | "nav.notes" | "nav.wiki" }> = {
  objective: { href: "/objectives", labelKey: "nav.objectives" },
  task: { href: "/tasks", labelKey: "nav.tasks" },
  capture: { href: "/inbox", labelKey: "nav.inbox" },
  raw: { href: "/notes", labelKey: "nav.notes" },
  wiki: { href: "/wiki", labelKey: "nav.wiki" },
};

function docHref(relativePath: string) {
  return "/doc/" + relativePath.split("/").map(encodeURIComponent).join("/");
}

function prepareHref(relativePath: string) {
  return `/assistant?prepare=${encodeURIComponent(relativePath)}`;
}

function stripTitleHeading(content: string, title: string) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() === `# ${title}`) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return content;
}

function textField(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

function readTime(content: string, declared: unknown) {
  const minutes = Number(declared);
  if (Number.isFinite(minutes) && minutes > 0) return Math.round(minutes);
  return Math.max(1, Math.ceil(content.trim().split(/\s+/).filter(Boolean).length / 220));
}

export default async function NotePage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const relativePath = path.map(decodeURIComponent).join("/");
  const [note, t] = await Promise.all([readNote(relativePath), getTranslations()]);
  if (!note) notFound();

  const back = BACK_BY_KIND[note.kind] || { href: "/notes", labelKey: "nav.notes" as const };

  // Personal notes open directly in the editor, like the iPhone Notes app:
  // tap a note and it is immediately editable, no separate read mode. Curated
  // wiki articles (and other kinds) keep the calm reading view below.
  if (note.kind === "raw") {
    return <NotesWorkspace notes={[noteForClient(note)]} singleNote backHref={back.href} />;
  }

  const visibleContent = note.kind === "daily" || note.kind === "weekly"
    ? sanitizeBriefOutput(note.content)
    : note.content;
  const body = stripTitleHeading(visibleContent, note.title);
  const isWiki = note.kind === "wiki";
  const description = textField(note.data.description);
  const area = textField(note.data.area);

  return (
    <>
      <article className="note-reader">
        <div className="note-reader-bar">
          <Link className="note-back-link" href={back.href}>
            <ArrowLeft size={14} aria-hidden />
            {t[back.labelKey]}
          </Link>
          <form action={togglePinNoteAction}>
            <input type="hidden" name="path" value={relativePath} />
            <input type="hidden" name="pinned" value={note.data.pinned === true ? "false" : "true"} />
            <button className="button" type="submit" title={note.data.pinned === true ? t["reader.unpinTitle"] : t["reader.pinTitle"]}>
              {note.data.pinned === true ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
              {note.data.pinned === true ? t["reader.unpin"] : t["reader.pin"]}
            </button>
          </form>
          {["task", "project", "objective"].includes(note.kind) ? (
            <Link className="button" href={prepareHref(relativePath)}>
              <BrainCircuit size={14} aria-hidden />
              {t["assistant.prepare"]}
            </Link>
          ) : null}
          <Link className="button primary" href={docHref(relativePath)}>
            <Pencil size={14} aria-hidden />
            {t["reader.edit"]}
          </Link>
        </div>
        <header className="note-reader-head">
          <p className="eyebrow">{isWiki ? area || t["page.wiki.title"] : note.kind}</p>
          <h1>{note.title}</h1>
          {isWiki && description ? <p className="note-reader-dek">{description}</p> : null}
          {(note.status || note.tags.length > 0) && (
            <p className="note-reader-meta">
              {isWiki ? <span>{readTime(note.content, note.data.read_time)} {t["reader.readTime"]}</span> : null}
              {!isWiki && note.status ? <span className="note-reader-status">{note.status}</span> : null}
              {note.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </p>
          )}
        </header>
        <MarkdownView
          content={body}
          editableChecklist={isWiki ? { relativePath: note.relativePath, mtime: note.mtime, errorLabel: t["notes.saveFailed"] } : undefined}
        />
      </article>
    </>
  );
}
