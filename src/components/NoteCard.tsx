import Link from "next/link";
import { Hash } from "lucide-react";
import { displayDateTime } from "@/lib/dates";
import { editHref, type VaultNote } from "@/lib/vault";

export function NoteCard({
  note,
  actions,
  dense = false,
}: {
  note: VaultNote;
  actions?: React.ReactNode;
  dense?: boolean;
}) {
  return (
    <article className={dense ? "note-card dense" : "note-card"}>
      <div className="card-topline">
        <span className={`status-dot ${note.status || "neutral"}`} />
        <span>{note.status || note.kind}</span>
        <span>{displayDateTime(String(note.data.updated || note.data.created || note.mtime))}</span>
      </div>
      <div className="card-title-row">
        <h3>
          <Link href={editHref(note)}>{cleanDisplayText(note.title)}</Link>
        </h3>
      </div>
      {note.excerpt && <p>{cleanDisplayText(note.excerpt)}</p>}
      {!!note.tags.length && (
        <div className="tag-list">
          {note.tags.map((tag) => (
            <span key={tag}>
              <span className="nf" aria-hidden><Hash size={11} /></span>
              {tag}
            </span>
          ))}
        </div>
      )}
      {actions && <div className="card-actions">{actions}</div>}
    </article>
  );
}

function cleanDisplayText(value: string) {
  return value
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
