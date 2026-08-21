"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { cn } from "@/lib/utils";

export interface FileNode {
  name: string;
  type: "file" | "folder";
  children?: FileNode[];
  extension?: string;
  path?: string;
  protected?: boolean;
}

/** Rangée telle que le clavier la voit : niveau d'indentation et état du triangle. */
export interface TreeRow {
  level: number;
  expanded?: boolean;
}

/**
 * Navigation clavier du Finder : ↑↓ parcourent les lignes visibles, → ouvre le
 * dossier puis descend, ← le referme puis remonte au parent, ⇱/⇲ aux extrémités.
 */
export function treeKeyTarget(key: string, rows: TreeRow[], index: number): { focus: number } | { toggle: true } | null {
  const row = rows[index];
  if (!row) return null;
  switch (key) {
    case "ArrowDown":
      return index + 1 < rows.length ? { focus: index + 1 } : null;
    case "ArrowUp":
      return index > 0 ? { focus: index - 1 } : null;
    case "Home":
      return { focus: 0 };
    case "End":
      return { focus: rows.length - 1 };
    case "ArrowRight":
      if (row.expanded === false) return { toggle: true };
      return index + 1 < rows.length ? { focus: index + 1 } : null;
    case "ArrowLeft": {
      if (row.expanded === true) return { toggle: true };
      for (let i = index - 1; i >= 0; i -= 1) if (rows[i].level < row.level) return { focus: i };
      return null;
    }
    default:
      return null;
  }
}

function containsPath(nodes: FileNode[], path: string): boolean {
  return nodes.some((node) => node.path === path || containsPath(node.children || [], path));
}

export function FileTree({ data, activePath, onSelect, onRename, className }: {
  data: FileNode[];
  activePath?: string;
  onSelect?: (path: string) => void;
  onRename?: (path: string, filename: string) => Promise<void>;
  className?: string;
}) {
  // Tabindex mobile : une seule rangée est atteignable au Tab, le reste au clavier
  // directionnel. Sans rangée active, la première sert de point d'entrée.
  const entryPath = activePath && containsPath(data, activePath) ? activePath : data[0]?.path;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[role='treeitem']"));
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const target = treeKeyTarget(event.key, rows.map((row) => ({
      level: Number(row.getAttribute("aria-level")),
      expanded: row.hasAttribute("aria-expanded") ? row.getAttribute("aria-expanded") === "true" : undefined,
    })), index);
    if (!target) return;
    event.preventDefault();
    if ("toggle" in target) rows[index].click();
    else rows[target.focus].focus();
  }

  return (
    <div className={cn("vault-tree", className)}>
      <div className="vault-tree-header">Vault</div>
      <div className="vault-tree-body" role="tree" aria-label="Vault" onKeyDown={onKeyDown}>
        {data.map((node) => <FileItem activePath={activePath} depth={0} entryPath={entryPath} key={`${node.type}:${node.path || node.name}`} node={node} onRename={onRename} onSelect={onSelect} />)}
      </div>
    </div>
  );
}

function FileItem({ node, depth, activePath, entryPath, onSelect, onRename }: {
  node: FileNode;
  depth: number;
  activePath?: string;
  entryPath?: string;
  onSelect?: (path: string) => void;
  onRename?: (path: string, filename: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(() => Boolean(
    node.path && activePath && (node.path === activePath || activePath.startsWith(`${node.path}/`)),
  ));
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [renameError, setRenameError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameBusy = useRef(false);
  const renameCancelled = useRef(false);
  const isFolder = node.type === "folder";
  const hasChildren = Boolean(isFolder && node.children?.length);
  const active = node.path === activePath;
  const canRename = Boolean(!isFolder && !node.protected && node.path && onRename);

  useEffect(() => {
    if (!renaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming]);

  function startRename() {
    if (!canRename) return;
    setDraft(node.name.replace(/\.md$/i, ""));
    setRenameError(false);
    renameCancelled.current = false;
    setRenaming(true);
  }

  async function finishRename() {
    if (!node.path || !onRename || renameBusy.current) return;
    const filename = draft.trim().replace(/\.md$/i, "").trim();
    if (!filename) {
      setRenameError(true);
      inputRef.current?.focus();
      return;
    }
    if (`${filename}.md` === node.name) {
      setRenaming(false);
      return;
    }
    renameBusy.current = true;
    try {
      await onRename(node.path, filename);
      setRenaming(false);
    } catch {
      setRenameError(true);
      inputRef.current?.focus();
    } finally {
      renameBusy.current = false;
    }
  }

  if (renaming) {
    return (
      <div className="select-none">
        <form
          className={cn("vault-tree-row is-renaming", active && "is-active")}
          onSubmit={(event) => { event.preventDefault(); void finishRename(); }}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={active}
        >
          <Twisty hidden open={false} />
          <span className="vault-tree-icon"><DocGlyph /></span>
          <input
            ref={inputRef}
            className="vault-tree-rename-input"
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setRenameError(false); }}
            onBlur={() => {
              if (!renameCancelled.current) void finishRename();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              renameCancelled.current = true;
              setRenaming(false);
            }}
            aria-invalid={renameError}
            aria-label={t("notes.renameFile")}
            title={renameError ? t("notes.renameError") : t("notes.renameFile")}
          />
          <span className="vault-tree-extension">.md</span>
        </form>
      </div>
    );
  }

  return (
    <div className="select-none">
      <button
        // Tout le style vit dans globals.css : tailles, couleur d'accent, tactile.
        className={cn("vault-tree-row", active && "is-active")}
        onClick={() => isFolder ? setIsOpen((open) => !open) : node.path && onSelect?.(node.path)}
        onDoubleClick={(event) => { event.preventDefault(); startRename(); }}
        onKeyDown={(event) => {
          if (event.key !== "F2") return;
          event.preventDefault();
          startRename();
        }}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        title={node.protected ? `${node.path} — ${t("notes.protected")}` : canRename ? `${node.path} — ${t("notes.renameHint")}` : node.path || node.name}
        type="button"
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={active}
        aria-expanded={hasChildren ? isOpen : undefined}
        tabIndex={node.path && node.path === entryPath ? 0 : -1}
      >
        <Twisty hidden={!hasChildren} open={hasChildren && isOpen} />
        <span className="vault-tree-icon">{isFolder ? <FolderGlyph /> : <DocGlyph />}</span>
        <span className="vault-tree-name">{node.name}</span>
        {node.protected ? <LockKeyhole className="vault-tree-lock" size={11} aria-label={t("notes.protected")} /> : null}
      </button>
      {hasChildren && isOpen ? (
        <div
          className="vault-tree-group"
          style={{ "--guide": `${depth * 16 + 18}px` } as CSSProperties}
          role="group"
        >
          {node.children!.map((child) => <FileItem activePath={activePath} depth={depth + 1} entryPath={entryPath} key={`${child.type}:${child.path || child.name}`} node={child} onRename={onRename} onSelect={onSelect} />)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Icônes maison plutôt qu'un jeu générique : le Finder n'a qu'un dossier et une
 * page, teintés par la couleur d'accent. Un icône différent par dossier racine
 * faisait sapin de Noël.
 */
function FolderGlyph() {
  return (
    <svg className="vault-tree-glyph" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M1.1 4.15c0-.9.73-1.63 1.63-1.63h3.05c.4 0 .78.15 1.07.42l1.05.98h6.37c.9 0 1.63.73 1.63 1.63v.72H1.1V4.15Z" fill="currentColor" fillOpacity=".55" />
      <path d="M1.1 6.35h13.8v5.5c0 .9-.73 1.63-1.63 1.63H2.73c-.9 0-1.63-.73-1.63-1.63v-5.5Z" fill="currentColor" />
    </svg>
  );
}

function DocGlyph() {
  return (
    <svg className="vault-tree-glyph" viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
      <path d="M9.05 1.85H4.4c-.72 0-1.3.58-1.3 1.3v9.7c0 .72.58 1.3 1.3 1.3h7.2c.72 0 1.3-.58 1.3-1.3V5.75L9.05 1.85Z" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeOpacity=".6" strokeWidth="1.05" strokeLinejoin="round" />
      <path d="M8.95 2v2.5c0 .72.58 1.3 1.3 1.3h2.5" stroke="currentColor" strokeOpacity=".6" strokeWidth="1.05" strokeLinejoin="round" />
    </svg>
  );
}

/** Chevron de la barre latérale macOS : trait fin, extrémités arrondies. */
function Twisty({ open, hidden }: { open: boolean; hidden: boolean }) {
  return (
    <svg
      className={cn("vault-tree-twisty", open && "is-open", hidden && "is-hidden")}
      viewBox="0 0 10 10"
      aria-hidden
      focusable="false"
    >
      <path d="M3.7 2.3 6.6 5 3.7 7.7" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
