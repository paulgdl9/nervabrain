"use client";

import Link from "next/link";
import { Children, cloneElement, isValidElement, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLanguage } from "@/components/LanguageProvider";
import { setMarkdownChecklistState, stripTaskMetaComments } from "@/lib/markdown";

function withWikiLinks(content: string) {
  return content.replace(/(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, label: string) => {
    const text = label || target;
    const href = target.includes("/") && target.endsWith(".md")
      ? "/note/" + target.split("/").map(encodeURIComponent).join("/")
      : `/search?q=${encodeURIComponent(target)}`;
    return `[${text}](${href})`;
  });
}

// AI-written notes often separate every `> line` with a blank line, which
// Markdown renders as a stack of one-line blockquotes. Bridge those gaps with
// a `>` continuation so they read as one quote with paragraph breaks.
function mergeAdjacentBlockquotes(content: string) {
  return content.replace(/((?:^|\n)>[^\n]*)\n[ \t]*\n(?=>)/g, "$1\n>\n");
}

function plainText(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? plainText(child.props.children) : "";
  }).join(" ").replace(/\s+/g, " ").trim();
}

export function revealMarkdownImageFallback(image: { hidden: boolean | string }, fallback: { hidden: boolean | string } | null) {
  image.hidden = true;
  if (fallback) fallback.hidden = false;
}

export function resizeMarkdownColumn(widths: number[], column: number, delta: number) {
  return widths.map((width, index) => index === column ? Math.max(96, width + delta) : width);
}

function ResizableMarkdownTable({ children, label }: { children: ReactNode; label: string }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const drag = useRef<{ column: number; startX: number; widths: number[] } | null>(null);
  const [widths, setWidths] = useState<number[]>([]);

  function tableWidths() {
    return [...(tableRef.current?.querySelectorAll("thead th") || [])].map((cell) => Math.round(cell.getBoundingClientRect().width));
  }

  function columnFrom(target: EventTarget | null) {
    const handle = target instanceof Element ? target.closest(".markdown-column-resizer") : null;
    const header = handle?.closest("th") as HTMLTableCellElement | null;
    return header?.cellIndex ?? -1;
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    const column = columnFrom(event.target);
    if (column < 0) return;
    const current = tableWidths();
    drag.current = { column, startX: event.clientX, widths: current };
    setWidths(current);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveResize(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const { column, startX, widths: initial } = drag.current;
    setWidths(resizeMarkdownColumn(initial, column, event.clientX - startX));
  }

  function stopResize(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const column = columnFrom(event.target);
    if (column < 0) return;
    const current = widths.length ? widths : tableWidths();
    setWidths(resizeMarkdownColumn(current, column, event.key === "ArrowRight" ? 24 : -24));
    event.preventDefault();
  }

  return (
    <div
      className="markdown-table-scroll markdown-table-resizable"
      role="region"
      aria-label={label}
      tabIndex={0}
      onPointerDown={startResize}
      onPointerMove={moveResize}
      onPointerUp={stopResize}
      onPointerCancel={stopResize}
      onKeyDown={resizeWithKeyboard}
    >
      <table ref={tableRef} style={widths.length ? { tableLayout: "fixed" } : undefined}>
        {widths.length ? <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup> : null}
        {children}
      </table>
    </div>
  );
}

export function MarkdownView({
  content,
  editableChecklist,
}: {
  content: string;
  editableChecklist?: { relativePath: string; mtime: string; errorLabel?: string };
}) {
  const { locale } = useLanguage();
  const [savedChecklist, setSavedChecklist] = useState<{
    relativePath: string;
    sourceContent: string;
    sourceMtime: string;
    content: string;
    mtime: string;
  } | null>(null);
  const [pendingChecklist, setPendingChecklist] = useState<number | null>(null);
  const [saveError, setSaveError] = useState(false);
  const saving = useRef(false);
  const localChecklist = savedChecklist
    && savedChecklist.relativePath === editableChecklist?.relativePath
    && savedChecklist.sourceContent === content
    && savedChecklist.sourceMtime === editableChecklist.mtime
    ? savedChecklist
    : null;
  const visibleContent = localChecklist?.content || content;
  const expectedMtime = localChecklist?.mtime || editableChecklist?.mtime || "";
  let checklistIndex = 0;

  async function saveChecklist(index: number, checked: boolean) {
    if (!editableChecklist || saving.current) return;
    const nextContent = setMarkdownChecklistState(visibleContent, index, checked);
    if (nextContent === null) return;

    saving.current = true;
    setPendingChecklist(index);
    setSaveError(false);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-wiki-checklist",
          path: editableChecklist.relativePath,
          index,
          checked,
          expectedMtime,
        }),
      });
      const body = await response.json() as { note?: { mtime?: string } };
      if (response.status === 409 || !response.ok || !body.note?.mtime) {
        setSaveError(true);
        return;
      }
      setSavedChecklist({
        relativePath: editableChecklist.relativePath,
        sourceContent: localChecklist?.sourceContent || content,
        sourceMtime: localChecklist?.sourceMtime || editableChecklist.mtime,
        content: nextContent,
        mtime: body.note.mtime,
      });
    } catch {
      setSaveError(true);
    } finally {
      saving.current = false;
      setPendingChecklist(null);
    }
  }

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (!href) return <>{children}</>;
            const isInternal = href.startsWith("/");
            return isInternal ? (
              <Link href={href}>{children}</Link>
            ) : (
              <a href={href} rel="noreferrer" target="_blank">
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const safeSrc = typeof src === "string" && src.startsWith("https://") ? src : "";
            const unavailable = locale === "fr" ? "Image indisponible" : "Image unavailable";
            const openImage = locale === "fr" ? "Ouvrir l’image" : "Open image";
            return (
              <span className="markdown-image-frame">
                {/* Markdown images can reference arbitrary remote hosts, so Next Image cannot optimize them safely. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src || undefined}
                  alt={alt || ""}
                  loading="lazy"
                  style={{ maxWidth: "100%", height: "auto" }}
                  onError={(event) => {
                    const fallback = event.currentTarget.nextElementSibling;
                    revealMarkdownImageFallback(event.currentTarget, fallback instanceof HTMLElement ? fallback : null);
                  }}
                />
                <span className="markdown-image-fallback" hidden role="status" aria-live="polite">
                  <strong>{unavailable}</strong>
                  {alt ? <span>{alt}</span> : null}
                  {safeSrc ? <a href={safeSrc} rel="noreferrer" target="_blank">{openImage}</a> : null}
                </span>
              </span>
            );
          },
          li: ({ children }) => {
            const items = Children.toArray(children);
            const first = items[0];
            if (isValidElement<InputHTMLAttributes<HTMLInputElement>>(first) && first.type === "input") {
              const index = checklistIndex++;
              const checkbox = editableChecklist ? cloneElement(first, {
                disabled: pendingChecklist !== null,
                "aria-busy": pendingChecklist === index || undefined,
                "aria-label": plainText(items.slice(1)) || `Checklist ${index + 1}`,
                onChange: (event) => void saveChecklist(index, event.currentTarget.checked),
              }) : first;
              return (
                <li className="task-list-item">
                  <span className="task-list-check">{checkbox}</span>
                  <span className="task-list-copy">{items.slice(1)}</span>
                </li>
              );
            }
            return <li>{children}</li>;
          },
          table: ({ children }) => <ResizableMarkdownTable label={locale === "fr" ? "Tableau redimensionnable" : "Resizable table"}>{children}</ResizableMarkdownTable>,
          th: ({ children }) => (
            <th>
              {children}
              <button
                className="markdown-column-resizer"
                type="button"
                aria-label={`${locale === "fr" ? "Redimensionner la colonne" : "Resize column"} ${plainText(children)}`}
                title={locale === "fr" ? "Glisser pour redimensionner" : "Drag to resize"}
              />
            </th>
          ),
        }}
      >
        {mergeAdjacentBlockquotes(withWikiLinks(stripTaskMetaComments(visibleContent)))}
      </ReactMarkdown>
      {saveError ? <p className="save-state save-error" role="alert">{editableChecklist?.errorLabel || "Checklist update failed"}</p> : null}
    </div>
  );
}
