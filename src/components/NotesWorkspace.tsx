"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { ArrowLeft, Bold, BrainCircuit, Check, ChevronLeft, ChevronRight, Code2, GripVertical, Heading1, Italic, List, ListOrdered, ListTodo, LockKeyhole, Move, PenLine, Plus, Quote, Search, StickyNote, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorState, Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { sql } from "@codemirror/lang-sql";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags as highlightTags } from "@lezer/highlight";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import type { VaultNote } from "@/lib/vault";
import { verticalBlockNavigation } from "@/lib/note-block-navigation";
import { normalizePastedMarkdown } from "@/lib/note-paste";
import { useLanguage } from "@/components/LanguageProvider";
import { DonutChart } from "@/components/ui/DonutChart";
import { FileTree, type FileNode } from "@/components/ui/file-tree";
import { isProtectedVaultPath } from "@/lib/vault-protection";
import styles from "./NotesWorkspace.module.css";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type BlockType = "heading" | "text" | "todo" | "field" | "toggle" | "quote" | "callout" | "code" | "bullet" | "number" | "divider" | "table" | "chart";
type MobileNoteAction = "bold" | "italic" | "heading" | "checklist" | "bullet" | "number" | "quote" | "code";

type ChartKind = "pie" | "bar" | "line";
type ChartPoint = { label: string; value: number };
type ChartSpec = { kind: ChartKind; points: ChartPoint[] };
type BlockColor = "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";

type NoteBlock = {
  id: string;
  type: BlockType;
  text: string;
  label?: string;
  checked?: boolean;
  level?: 1 | 2 | 3;
  indent?: number;
  /** table block: rows[0] is the header row */
  rows?: string[][];
  /** chart block: pie / bar / line config */
  chart?: ChartSpec;
  color?: BlockColor;
  background?: BlockColor;
};

type BlockDragSession = {
  blockId: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  handle: HTMLButtonElement;
};

const chartPalette = ["#ededee", "#b9bac0", "#8d8e96", "#6a6b74", "#4c4d56", "#a3a4ac", "#cfd0d5", "#5c5d66"];

function prepareHref(relativePath: string) {
  return `/assistant?prepare=${encodeURIComponent(relativePath)}`;
}

const notionColors: Record<BlockColor, { text: string; background: string }> = {
  default: { text: "var(--ink)", background: "transparent" },
  gray: { text: "#787774", background: "rgba(120, 119, 116, .14)" },
  brown: { text: "#9f6b53", background: "rgba(159, 107, 83, .16)" },
  orange: { text: "#d9730d", background: "rgba(217, 115, 13, .16)" },
  yellow: { text: "#cb912f", background: "rgba(203, 145, 47, .18)" },
  green: { text: "#448361", background: "rgba(68, 131, 97, .17)" },
  blue: { text: "#337ea9", background: "rgba(51, 126, 169, .17)" },
  purple: { text: "#9065b0", background: "rgba(144, 101, 176, .17)" },
  pink: { text: "#c14c8a", background: "rgba(193, 76, 138, .16)" },
  red: { text: "#d44c47", background: "rgba(212, 76, 71, .16)" },
};

function defaultTableRows(): string[][] {
  return [
    ["Colonne 1", "Colonne 2"],
    ["", ""],
    ["", ""],
  ];
}

function defaultChart(kind: ChartKind = "pie"): ChartSpec {
  return {
    kind,
    points: [
      { label: "A", value: 30 },
      { label: "B", value: 45 },
      { label: "C", value: 25 },
    ],
  };
}

type EditableNote = VaultNote & {
  draftTitle: string;
  blocks: NoteBlock[];
};

function noteTree(notes: EditableNote[]): FileNode[] {
  const root: FileNode[] = [];
  for (const note of notes) {
    const parts = note.relativePath.split("/");
    let level = root;
    for (const [index, name] of parts.entries()) {
      const file = index === parts.length - 1;
      let node = level.find((item) => item.name === name && item.type === (file ? "file" : "folder"));
      if (!node) {
        node = file
          ? { name, type: "file", extension: name.split(".").pop(), path: note.relativePath, protected: isProtectedVaultPath(note.relativePath) }
          : { name, type: "folder", children: [], path: parts.slice(0, index + 1).join("/") };
        level.push(node);
      }
      level = node.children || [];
    }
  }
  const sort = (nodes: FileNode[]) => nodes.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1).map((node) => {
    if (node.children) sort(node.children);
    return node;
  });
  return sort(root);
}

const slashCommands: Array<{
  command: string;
  label: string;
  hint: string;
  type: BlockType;
  level?: 1 | 2 | 3;
  labelValue?: string;
  chartKind?: ChartKind;
}> = [
  { command: "/text", label: "Text", hint: "Plain paragraph", type: "text" },
  { command: "/h1", label: "Heading 1", hint: "Large heading", type: "heading", level: 1 },
  { command: "/h2", label: "Heading 2", hint: "Section heading", type: "heading", level: 2 },
  { command: "/h3", label: "Heading 3", hint: "Small heading", type: "heading", level: 3 },
  { command: "/todo", label: "To-do", hint: "Checkbox item", type: "todo" },
  { command: "/to-do", label: "To-do", hint: "Checkbox item", type: "todo" },
  { command: "/toggle", label: "Toggle", hint: "Collapsible section", type: "toggle" },
  { command: "/toggle-list", label: "Toggle", hint: "Collapsible section", type: "toggle" },
  { command: "/bullet", label: "Bullet list", hint: "Unordered list", type: "bullet" },
  { command: "/bullet-list", label: "Bullet list", hint: "Unordered list", type: "bullet" },
  { command: "/number", label: "Number list", hint: "Ordered list", type: "number" },
  { command: "/number-list", label: "Number list", hint: "Ordered list", type: "number" },
  { command: "/quote", label: "Quote", hint: "Quoted text", type: "quote" },
  { command: "/callout", label: "Callout", hint: "Highlighted note", type: "callout", labelValue: "NOTE" },
  { command: "/divider", label: "Divider", hint: "Visual separator", type: "divider" },
  { command: "/separator", label: "Divider", hint: "Visual separator", type: "divider" },
  { command: "/table", label: "Table", hint: "Rows and columns", type: "table" },
  { command: "/chart", label: "Chart", hint: "Pie, bar or line", type: "chart", chartKind: "pie" },
  { command: "/pie", label: "Pie chart", hint: "Répartition", type: "chart", chartKind: "pie" },
  { command: "/camembert", label: "Répartition", hint: "Diagramme circulaire", type: "chart", chartKind: "pie" },
  { command: "/bar", label: "Bar chart", hint: "Histogramme", type: "chart", chartKind: "bar" },
  { command: "/line", label: "Line chart", hint: "Courbe", type: "chart", chartKind: "line" },
  { command: "/code", label: "Code", hint: "Code block", type: "code" },
];

const codeLanguages = ["text", "javascript", "typescript", "tsx", "jsx", "python", "bash", "json", "css", "html", "markdown", "sql", "yaml", "dockerfile"];

type FloatingMenuPosition = {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

const codeEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--code-editor-ink)",
    fontSize: "13px",
  },
  ".cm-scroller": {
    fontFamily: "\"SFMono-Regular\", Consolas, \"Liberation Mono\", monospace",
    lineHeight: "1.58",
  },
  ".cm-content": {
    caretColor: "var(--code-editor-caret)",
    padding: "8px 0",
  },
  ".cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid var(--code-editor-line)",
    color: "var(--code-editor-muted)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--code-editor-active-line)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--code-editor-active-line)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--code-editor-selection)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--code-editor-caret)" },
}, { dark: false });

const codeHighlightStyle = HighlightStyle.define([
  { tag: highlightTags.comment, color: "var(--code-comment)" },
  { tag: highlightTags.keyword, color: "var(--code-keyword)" },
  { tag: [highlightTags.string, highlightTags.regexp], color: "var(--code-string)" },
  { tag: [highlightTags.number, highlightTags.bool, highlightTags.null], color: "var(--code-number)" },
  { tag: [highlightTags.definition(highlightTags.variableName), highlightTags.propertyName], color: "var(--code-definition)" },
  { tag: [highlightTags.typeName, highlightTags.className], color: "var(--code-type)" },
  { tag: [highlightTags.operator, highlightTags.punctuation], color: "var(--code-operator)" },
  { tag: highlightTags.variableName, color: "var(--code-editor-ink)" },
]);

export function NotesWorkspace({
  notes: initialNotes,
  singleNote = false,
  isPage = false,
  backHref,
  dailyToggle,
  pageIcon,
}: {
  notes: VaultNote[];
  singleNote?: boolean;
  /** Rendered as a free-form custom page (Notion-style), not a vault note. */
  isPage?: boolean;
  backHref?: string;
  /** Optional control (e.g. include-in-daily) shown in the page status bar. */
  dailyToggle?: ReactNode;
  /** Optional icon picker shown next to the page title. */
  pageIcon?: ReactNode;
}) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [notes, setNotes] = useState<EditableNote[]>(() => initialNotes.map(toEditable));
  const [activeId, setActiveId] = useState(initialNotes.find((note) => note.folder === "02-Raw")?.id || initialNotes[0]?.id || "");
  const [query, setQuery] = useState("");
  const [mobileEditorOpen, setMobileEditorOpen] = useState(singleNote);
  const [mobileDrafts, setMobileDrafts] = useState<Record<string, string>>(() => Object.fromEntries(
    initialNotes.map((note) => {
      const editable = toEditable(note);
      return [editable.id, blocksToMarkdown(editable.blocks)];
    }),
  ));
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [draggingBlock, setDraggingBlock] = useState("");
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const [activeBlockId, setActiveBlockId] = useState("");
  const [copiedBlockId, setCopiedBlockId] = useState("");
  const [collapsedHeadings, setCollapsedHeadings] = useState<Set<string>>(new Set());
  const [insertMenu, setInsertMenu] = useState<{ afterId: string; rect: DOMRect } | null>(null);
  const [blockMenu, setBlockMenu] = useState<{ blockId: string; rect: DOMRect } | null>(null);
  const [blockTransformOpen, setBlockTransformOpen] = useState(false);
  const [blockColorOpen, setBlockColorOpen] = useState(false);
  const notesRef = useRef<EditableNote[]>(notes);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveVersions = useRef(new Map<string, number>());
  const saveChains = useRef(new Map<string, Promise<void>>());
  const serverMtimes = useRef(new Map(initialNotes.map((note) => [note.id, note.mtime])));
  const saveNoteRef = useRef<(note: EditableNote, version?: number) => Promise<void>>(async () => undefined);
  const copyFeedbackTimer = useRef<number | null>(null);
  const mobileTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const blockCounter = useRef(0);
  const undoStack = useRef<Array<{ noteId: string; blocks: NoteBlock[]; prevActiveBlockId: string }>>([]);
  const undoRef = useRef<() => void>(() => undefined);
  const dragSessionRef = useRef<BlockDragSession | null>(null);
  const pendingBlockFocus = useRef<{ blockId: string; edge: "start" | "end" } | null>(null);

  const active = notes.find((note) => note.id === activeId) || notes[0];
  const activeProtected = isProtectedVaultPath(active?.relativePath || "");
  const activeSaveState = active ? saveStates[active.id] || "idle" : "idle";
  const canPrepare = singleNote && ["task", "project", "objective"].includes(active?.kind || "");
  const activeBlockType = active?.blocks.find((block) => block.id === activeBlockId)?.type;
  const financeQuantity = Number(active?.data.quantity);
  const financeUnitPrice = Number(active?.data.unit_price);
  const financeCurrency = String(active?.data.currency || "EUR");
  const formatMoney = (value: number) => new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en", {
    style: "currency",
    currency: financeCurrency,
    maximumFractionDigits: 2,
  }).format(value);
  const saveStatesRef = useRef(saveStates);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    saveStatesRef.current = saveStates;
  }, [saveStates]);

  useEffect(() => () => document.body.classList.remove("is-block-dragging"), []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter((note) => {
      const haystack = [
        note.draftTitle,
        note.relativePath,
        note.status,
        note.blocks.map((block) => `${block.label || ""} ${block.text}`).join(" "),
        note.tags.join(" "),
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [notes, query]);

  const folders = useMemo(() => [...new Set(notes
    .map((note) => note.relativePath.slice(0, note.relativePath.lastIndexOf("/")))
    .filter((folder) => folder && !isProtectedVaultPath(`${folder}/placeholder.md`)))].sort(), [notes]);
  const tree = useMemo(() => noteTree(filtered), [filtered]);

  const { visibleBlocks, hiddenCounts } = useMemo(() => {
    if (!active) return { visibleBlocks: [] as NoteBlock[], hiddenCounts: new Map<string, number>() };
    const visible: NoteBlock[] = [];
    const counts = new Map<string, number>();
    let hiddenLevel: number | null = null;
    let hiddenIndent: number | null = null;
    let collapsingId: string | null = null;
    for (const block of active.blocks) {
      const indent = block.indent || 0;
      if (hiddenIndent !== null) {
        if (indent <= hiddenIndent) {
          hiddenIndent = null;
          collapsingId = null;
        } else {
          if (collapsingId) counts.set(collapsingId, (counts.get(collapsingId) || 0) + 1);
          continue;
        }
      }
      if (hiddenLevel !== null) {
        if (block.type === "heading" && (block.level || 2) <= hiddenLevel) {
          hiddenLevel = null;
          collapsingId = null;
        } else {
          if (collapsingId) counts.set(collapsingId, (counts.get(collapsingId) || 0) + 1);
          continue;
        }
      }
      visible.push(block);
      if (block.type === "heading" && collapsedHeadings.has(block.id)) {
        hiddenLevel = block.level || 2;
        collapsingId = block.id;
      }
      if (block.type === "toggle" && collapsedHeadings.has(block.id)) {
        hiddenIndent = indent;
        collapsingId = block.id;
      }
    }
    return { visibleBlocks: visible, hiddenCounts: counts };
  }, [active, collapsedHeadings]);

  function setNoteState(id: string, state: SaveState) {
    const next = { ...saveStatesRef.current, [id]: state };
    saveStatesRef.current = next;
    setSaveStates(next);
  }

  function nextClientBlockId(type: BlockType) {
    blockCounter.current += 1;
    return `${type}:client:${blockCounter.current}`;
  }

  function commit(next: EditableNote, state: SaveState = "dirty") {
    setNoteState(next.id, state);
    const updated = notesRef.current.map((note) => (note.id === next.id ? next : note));
    notesRef.current = updated;
    setNotes(updated);
    scheduleSave(next);
  }

  function scheduleSave(note: EditableNote) {
    const existing = saveTimers.current.get(note.id);
    if (existing) clearTimeout(existing);
    const version = (saveVersions.current.get(note.id) || 0) + 1;
    saveVersions.current.set(note.id, version);
    const timer = setTimeout(() => saveNoteRef.current(note, version), 520);
    saveTimers.current.set(note.id, timer);
  }

  async function saveNote(note: EditableNote, version = saveVersions.current.get(note.id) || 0) {
    const timer = saveTimers.current.get(note.id);
    if (timer) clearTimeout(timer);
    saveTimers.current.delete(note.id);
    const previous = saveChains.current.get(note.id) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      setNoteState(note.id, "saving");
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          action: "update",
          path: note.relativePath,
          title: note.draftTitle || "Untitled",
          content: blocksToMarkdown(note.blocks),
          status: note.status || "active",
          tags: note.tags,
          area: note.data.area || "",
          priority: note.data.priority || "",
          horizon: note.data.horizon || "",
          expectedMtime: serverMtimes.current.get(note.id) || note.mtime,
        }),
      });

      if (!response.ok) {
        if (version === saveVersions.current.get(note.id)) setNoteState(note.id, "error");
        return;
      }

      const body = await response.json() as { note?: VaultNote };
      const savedNote = body.note;
      const pageTitleChanged = Boolean(isPage && savedNote && savedNote.title !== note.title);
      if (savedNote) serverMtimes.current.set(note.id, savedNote.mtime);
      if (savedNote && version === saveVersions.current.get(note.id)) {
        setNotes((current) => current.map((item) => (
          item.id === note.id
            ? {
              ...item,
              title: savedNote.title,
              data: savedNote.data,
              content: savedNote.content,
              excerpt: savedNote.excerpt,
              mtime: savedNote.mtime,
              relativePath: savedNote.relativePath,
              status: savedNote.status,
              tags: savedNote.tags,
            }
            : item
        )));
        setNoteState(note.id, "saved");
        if (pageTitleChanged) router.refresh();
      }
    }).catch(() => {
      if (version === saveVersions.current.get(note.id)) setNoteState(note.id, "error");
    });
    saveChains.current.set(note.id, operation);
    await operation;
    if (saveChains.current.get(note.id) === operation) saveChains.current.delete(note.id);
  }

  useEffect(() => {
    saveNoteRef.current = saveNote;
  });

  useEffect(() => {
    undoRef.current = () => {
      const last = undoStack.current.pop();
      if (!last) return;
      const note = notesRef.current.find((n) => n.id === last.noteId);
      if (!note) return;
      commit({ ...note, blocks: last.blocks });
      setActiveBlockId(last.prevActiveBlockId);
    };
  });

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "z" || e.shiftKey) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault();
      undoRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function toggleHeading(blockId: string) {
    setCollapsedHeadings((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }

  useEffect(() => {
    const timers = saveTimers.current;
    const flushDirty = () => {
      for (const note of notesRef.current) {
        if ((saveStatesRef.current[note.id] || "idle") === "dirty") void saveNoteRef.current(note);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushDirty();
    };
    window.addEventListener("pagehide", flushDirty);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
      flushDirty();
      window.removeEventListener("pagehide", flushDirty);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  async function createNote() {
    setNoteState("new", "saving");
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", content: "", tags: [] }),
      });
      if (!response.ok) throw new Error("create_failed");
      const body = await response.json() as { note?: VaultNote };
      if (!body.note) throw new Error("missing_note");
      const next = {
        ...toEditable(body.note),
        blocks: [newBlock("text", "", `${body.note.id}:new-text`)],
      };
      setMobileDrafts((current) => ({ ...current, [next.id]: "" }));
      setNotes((current) => [next, ...current]);
      setActiveId(next.id);
      setMobileEditorOpen(true);
      setActiveBlockId(next.blocks[0]?.id || "");
      setNoteState(next.id, "saved");
      router.refresh();
    } catch {
      setNoteState("new", "error");
    }
  }

  function deleteActiveNote() {
    if (!active || activeProtected) return;
    setConfirmDelete(active.id);
  }

  async function moveActiveNote(folder: string) {
    if (!active || activeProtected || moving) return;
    const currentFolder = active.relativePath.slice(0, active.relativePath.lastIndexOf("/"));
    if (!folder || folder === currentFolder) return;
    if (!window.confirm(t("notes.moveConfirm").replace("{folder}", folder))) return;
    const note = active;
    setMoving(true);
    try {
      if (saveTimers.current.has(note.id)) await saveNote(note);
      await saveChains.current.get(note.id)?.catch(() => undefined);
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", path: note.relativePath, folder }),
      });
      const body = await response.json() as { note?: VaultNote };
      if (!response.ok || !body.note) throw new Error("move_failed");
      const moved = toEditable(body.note);
      const next = notesRef.current.map((item) => item.id === note.id ? moved : item);
      notesRef.current = next;
      setNotes(next);
      setActiveId(moved.id);
      serverMtimes.current.delete(note.id);
      serverMtimes.current.set(moved.id, moved.mtime);
      setMobileDrafts((current) => {
        const copy = { ...current, [moved.id]: current[note.id] ?? blocksToMarkdown(moved.blocks) };
        delete copy[note.id];
        return copy;
      });
      router.refresh();
    } catch {
      setNoteState(note.id, "error");
    } finally {
      setMoving(false);
    }
  }

  async function renameNoteFile(relativePath: string, filename: string) {
    const note = notesRef.current.find((item) => item.relativePath === relativePath);
    if (!note || isProtectedVaultPath(note.relativePath)) throw new Error("rename_not_allowed");
    if (saveTimers.current.has(note.id)) await saveNote(note);
    await saveChains.current.get(note.id)?.catch(() => undefined);
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", path: note.relativePath, filename }),
    });
    const body = await response.json() as { note?: VaultNote };
    if (!response.ok || !body.note) throw new Error("rename_failed");
    const renamed = toEditable(body.note);
    const next = notesRef.current.map((item) => item.id === note.id ? renamed : item);
    notesRef.current = next;
    setNotes(next);
    setActiveId((current) => current === note.id ? renamed.id : current);
    serverMtimes.current.delete(note.id);
    serverMtimes.current.set(renamed.id, renamed.mtime);
    setMobileDrafts((current) => {
      const copy = { ...current, [renamed.id]: current[note.id] ?? blocksToMarkdown(renamed.blocks) };
      delete copy[note.id];
      return copy;
    });
    router.refresh();
  }

  function handleConfirmDelete() {
    if (!confirmDelete) return;
    void confirmDeleteNote(confirmDelete);
  }

  const confirmDeleteNote = useCallback(async (noteId: string) => {
    setConfirmDelete(null);
    const note = notesRef.current.find((n) => n.id === noteId);
    if (!note) return;
    const timer = saveTimers.current.get(noteId);
    if (timer) clearTimeout(timer);
    saveTimers.current.delete(noteId);
    await saveChains.current.get(noteId)?.catch(() => undefined);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", path: note.relativePath }),
      });
      if (!response.ok) throw new Error("delete_failed");
    } catch {
      setNoteState(noteId, "error");
      return;
    }
    if (singleNote && backHref) {
      router.push(backHref);
      router.refresh();
      return;
    }
    const remaining = notesRef.current.filter((n) => n.id !== noteId);
    setMobileDrafts((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });
    setNotes(remaining);
    setActiveId(remaining[0]?.id || "");
    setMobileEditorOpen(false);
    router.refresh();
  }, [singleNote, backHref, router]);

  function selectNote(id: string) {
    const current = notesRef.current.find((note) => note.id === activeId);
    if (current && saveTimers.current.has(current.id)) void saveNote(current);
    setActiveId(id);
    setActiveBlockId("");
  }

  function openMobileNote(id: string) {
    selectNote(id);
    setMobileEditorOpen(true);
  }

  function updateActive(patch: Partial<EditableNote>) {
    if (!active) return;
    commit({ ...active, ...patch });
  }

  function updateTitle(title: string) {
    updateActive({ draftTitle: title });
  }

  function updateMobileMarkdown(markdown: string) {
    if (!active) return;
    setMobileDrafts((current) => ({ ...current, [active.id]: markdown }));
    commit({ ...active, blocks: markdownToBlocks(markdown, active.id) });
  }

  function applyMobileMarkdownAction(action: MobileNoteAction) {
    if (!active) return;
    const textarea = mobileTextareaRef.current;
    const value = mobileDrafts[active.id] ?? blocksToMarkdown(active.blocks);
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    const next = formatMobileMarkdown(value, start, end, action);
    updateMobileMarkdown(next.value);
    window.requestAnimationFrame(() => {
      const target = mobileTextareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }

  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const mobileTitleRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    // Both surfaces stay mounted and only one is visible: the hidden one
    // measures 0 and must keep its CSS height instead of collapsing.
    for (const el of [titleRef.current, mobileTitleRef.current]) {
      if (!el) continue;
      el.style.height = "auto";
      if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
    }
  }, [active?.draftTitle, active?.id]);

  useEffect(() => {
    if (!activeBlockId) return;
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>(".note-block"))
        .find((element) => element.dataset.blockId === activeBlockId);
      const pending = pendingBlockFocus.current?.blockId === activeBlockId ? pendingBlockFocus.current : null;
      if (!row || (!pending && row.contains(document.activeElement))) return;
      const controls = Array.from(row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type='checkbox'])"));
      const control = pending
        ? pending.edge === "start" ? controls[0] : controls.at(-1)
        : row.querySelector<HTMLElement>("textarea, input:not([type='checkbox']), [contenteditable='true']");
      if (pending) pendingBlockFocus.current = null;
      control?.focus();
      if (pending && (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
        const position = pending.edge === "start" ? 0 : control.value.length;
        control.setSelectionRange(position, position);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeBlockId, activeBlockType]);

  function handleBlockArrowNavigation(event: KeyboardEvent<HTMLDivElement>) {
    const control = event.target;
    if (event.defaultPrevented || !(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) return;
    const row = control.closest<HTMLElement>(".note-block");
    const index = visibleBlocks.findIndex((block) => block.id === row?.dataset.blockId);
    const block = visibleBlocks[index];
    if (!block || block.type === "table" || block.type === "chart" || block.type === "code" || block.type === "divider") return;

    const direction = verticalBlockNavigation({
      key: event.key,
      selectionStart: control.selectionStart,
      selectionEnd: control.selectionEnd,
      textLength: control.value.length,
      isComposing: event.nativeEvent.isComposing,
      hasModifier: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
    });
    if (!direction || !row) return;

    const controls = Array.from(row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type='checkbox'])"));
    if (direction === "previous" && control !== controls[0]) return;
    if (direction === "next" && control !== controls.at(-1)) return;

    const destination = visibleBlocks[index + (direction === "previous" ? -1 : 1)];
    if (!destination || destination.type === "table" || destination.type === "chart" || destination.type === "code" || destination.type === "divider") return;

    event.preventDefault();
    pendingBlockFocus.current = { blockId: destination.id, edge: direction === "previous" ? "end" : "start" };
    setActiveBlockId(destination.id);
  }

  function updateBlock(blockId: string, patch: Partial<NoteBlock>) {
    if (!active) return;
    const nextBlocks = active.blocks.map((block) => {
      if (block.id !== blockId) return block;
      return normalizeBlockTyping({ ...block, ...patch });
    });
    commit({ ...active, blocks: nextBlocks });
  }

  function addBlock(type: BlockType, afterId?: string, text = "", indent?: number) {
    if (!active) return;
    const after = afterId ? active.blocks.find((item) => item.id === afterId) : undefined;
    const nextIndent = indent ?? (after ? after.indent || 0 : 0);
    const block = { ...newBlock(type, text, nextClientBlockId(type)), indent: nextIndent };
    const index = afterId ? active.blocks.findIndex((item) => item.id === afterId) : -1;
    const nextBlocks = [...active.blocks];
    nextBlocks.splice(index === -1 ? nextBlocks.length : index + 1, 0, block);
    commit({ ...active, blocks: nextBlocks });
    setActiveBlockId(block.id);
  }

  function focusWritingSurface() {
    if (!active) return;
    const last = active.blocks.at(-1);
    if (last?.type === "text" && !last.text) {
      setActiveBlockId(last.id);
      return;
    }
    addBlock("text", last?.id);
  }

  function duplicateBlock(blockId: string) {
    if (!active) return;
    const index = active.blocks.findIndex((block) => block.id === blockId);
    if (index === -1) return;
    const source = active.blocks[index];
    const duplicate: NoteBlock = {
      ...source,
      id: nextClientBlockId(source.type),
      rows: source.rows?.map((row) => [...row]),
      chart: source.chart ? { ...source.chart, points: source.chart.points.map((point) => ({ ...point })) } : undefined,
    };
    const nextBlocks = [...active.blocks];
    nextBlocks.splice(index + 1, 0, duplicate);
    commit({ ...active, blocks: nextBlocks });
    setActiveBlockId(duplicate.id);
  }

  // Insert a fully-typed block from the "+" menu (Notion-style), after a block.
  function insertBlock(spec: InsertSpec, afterId: string) {
    if (!active) return;
    const after = active.blocks.find((item) => item.id === afterId);
    const indent = after ? after.indent || 0 : 0;
    let block: NoteBlock = { ...newBlock(spec.type, "", nextClientBlockId(spec.type)), indent };
    if (spec.level) block = { ...block, level: spec.level };
    if (spec.chartKind) block = { ...block, chart: defaultChart(spec.chartKind) };
    const index = active.blocks.findIndex((item) => item.id === afterId);
    const nextBlocks = [...active.blocks];
    nextBlocks.splice(index === -1 ? nextBlocks.length : index + 1, 0, block);
    commit({ ...active, blocks: nextBlocks });
    setActiveBlockId(block.id);
  }

  function transformBlock(blockId: string, spec: InsertSpec) {
    if (!active) return;
    const nextBlocks = active.blocks.map((block) => {
      if (block.id !== blockId) return block;
      return {
        ...block,
        type: spec.type,
        level: spec.type === "heading" ? spec.level || 2 : undefined,
        checked: spec.type === "todo" ? false : block.checked,
        label: spec.type === "callout"
          ? block.label || "NOTE"
          : spec.type === "toggle"
            ? block.label || block.text || "Toggle"
            : spec.type === "code"
              ? block.label || "text"
              : undefined,
        text: spec.type === "toggle" && !block.label ? "" : block.text,
      } as NoteBlock;
    });
    commit({ ...active, blocks: nextBlocks });
    setActiveBlockId(blockId);
  }

  function handleBlockTransform(event: ReactMouseEvent<HTMLButtonElement>) {
    if (!blockMenu) return;
    const key = event.currentTarget.dataset.transformKey;
    const option = transformOptions.find((item) => `${item.type}:${item.level || ""}` === key);
    if (!option) return;
    transformBlock(blockMenu.blockId, option);
    setBlockMenu(null);
    setBlockTransformOpen(false);
  }

  function setBlockStyle(blockId: string, patch: Pick<NoteBlock, "color" | "background">) {
    if (!active) return;
    commit({
      ...active,
      blocks: active.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block),
    });
    setActiveBlockId(blockId);
  }

  function handleBlockColor(event: ReactMouseEvent<HTMLButtonElement>) {
    if (!blockMenu) return;
    const value = event.currentTarget.dataset.color as BlockColor | undefined;
    const kind = event.currentTarget.dataset.colorKind;
    if (!value || !Object.hasOwn(notionColors, value)) return;
    setBlockStyle(blockMenu.blockId, kind === "background" ? { background: value } : { color: value });
  }

  async function copyBlock(block: NoteBlock) {
    try {
      await writeTextToClipboard(blockClipboardText(block));
      if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
      setCopiedBlockId("");
      window.requestAnimationFrame(() => {
        setCopiedBlockId(block.id);
        copyFeedbackTimer.current = window.setTimeout(() => {
          setCopiedBlockId((current) => current === block.id ? "" : current);
          copyFeedbackTimer.current = null;
        }, 1400);
      });
    } catch {
      setCopiedBlockId("");
    }
  }

  function deleteBlock(blockId: string) {
    if (!active) return;
    undoStack.current.push({ noteId: active.id, blocks: active.blocks, prevActiveBlockId: blockId });
    if (undoStack.current.length > 20) undoStack.current.shift();
    if (active.blocks.length === 1) {
      const replacement = newBlock("text", "", nextClientBlockId("text"));
      commit({ ...active, blocks: [replacement] });
      setActiveBlockId(replacement.id);
      return;
    }
    const index = active.blocks.findIndex((block) => block.id === blockId);
    const nextBlocks = active.blocks.filter((block) => block.id !== blockId);
    commit({ ...active, blocks: nextBlocks });
    setActiveBlockId(nextBlocks[Math.max(0, index - 1)]?.id || nextBlocks[0]?.id || "");
  }

  function setBlockIndent(blockId: string, direction: "in" | "out") {
    if (!active) return;
    const nextBlocks = active.blocks.map((block) => {
      if (block.id !== blockId) return block;
      const current = block.indent || 0;
      return { ...block, indent: direction === "in" ? Math.min(current + 1, 4) : Math.max(current - 1, 0) };
    });
    commit({ ...active, blocks: nextBlocks });
  }

  function addSiblingBlock(afterId: string, type?: BlockType) {
    if (!active) return;
    const block = active.blocks.find((item) => item.id === afterId);
    if (!block) return;
    addBlock(type || block.type, afterId, "", block.indent || 0);
  }

  function addChildBlock(afterId: string, type: BlockType = "text") {
    if (!active) return;
    const block = active.blocks.find((item) => item.id === afterId);
    addBlock(type, afterId, "", (block?.indent || 0) + 1);
  }

  function splitTextBlock(blockId: string, before: string, after: string) {
    if (!active) return;
    const index = active.blocks.findIndex((block) => block.id === blockId);
    if (index === -1) return;
    const source = active.blocks[index];
    const next = { ...newBlock("text", after, nextClientBlockId("text")), indent: source.indent || 0 };
    const nextBlocks = [...active.blocks];
    nextBlocks.splice(index, 1, { ...source, text: before }, next);
    commit({ ...active, blocks: nextBlocks });
    setActiveBlockId(next.id);
  }

  function handleBlockPaste(event: ClipboardEvent<HTMLDivElement>) {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) return;
    if (!control.matches(".text-block-input, .block-heading-input, .todo-block-row input[type='text'], .structured-block-input")) return;
    const pasted = event.clipboardData.getData("text/plain");
    if (!/\r|\n/.test(pasted) || !active) return;

    const row = control.closest<HTMLElement>(".note-block");
    const index = active.blocks.findIndex((block) => block.id === row?.dataset.blockId);
    if (index === -1) return;
    event.preventDefault();

    const source = active.blocks[index];
    const start = control.selectionStart ?? control.value.length;
    const end = control.selectionEnd ?? start;
    const before = control.value.slice(0, start);
    const after = control.value.slice(end);
    const indent = source.indent || 0;
    let inserted = markdownToBlocks(normalizePastedMarkdown(pasted), `${active.id}:paste`)
      .map((block) => ({ ...block, id: nextClientBlockId(block.type), indent: indent + (block.indent || 0) }));
    const replacement: NoteBlock[] = [];

    if (inserted[0]?.type === "text") {
      replacement.push({ ...source, text: before + inserted[0].text });
      inserted = inserted.slice(1);
    } else if (before) {
      replacement.push({ ...source, text: before });
    } else if (inserted[0]) {
      replacement.push({ ...inserted[0], id: source.id });
      inserted = inserted.slice(1);
    }
    replacement.push(...inserted);

    const last = replacement.at(-1);
    if (after && last && !["divider", "table", "chart"].includes(last.type)) {
      replacement[replacement.length - 1] = { ...last, text: last.text + after };
    } else if (after || /(?:\r?\n)$/.test(pasted)) {
      replacement.push({ ...newBlock("text", after, nextClientBlockId("text")), indent });
    }

    const nextBlocks = [...active.blocks];
    nextBlocks.splice(index, 1, ...replacement);
    const focus = replacement.at(-1);
    commit({ ...active, blocks: nextBlocks });
    if (focus) {
      pendingBlockFocus.current = { blockId: focus.id, edge: "end" };
      setActiveBlockId(focus.id);
    }
  }

  function reorderBlock(draggedId: string, targetId: string, position: "before" | "after") {
    if (!active || draggedId === targetId) return;
    const nextBlocks = [...active.blocks];
    const from = nextBlocks.findIndex((block) => block.id === draggedId);
    const to = nextBlocks.findIndex((block) => block.id === targetId);
    if (from === -1 || to === -1) return;
    const [block] = nextBlocks.splice(from, 1);
    const targetIndex = nextBlocks.findIndex((item) => item.id === targetId);
    nextBlocks.splice(position === "before" ? targetIndex : targetIndex + 1, 0, block);
    commit({ ...active, blocks: nextBlocks });
    setDropTarget(null);
  }

  function dropTargetAt(clientX: number, clientY: number, draggedId: string) {
    const row = document.elementsFromPoint(clientX, clientY)
      .map((element) => element.closest<HTMLElement>(".note-block"))
      .find((element) => element && element.dataset.blockId !== draggedId);
    if (!row?.dataset.blockId) return null;
    const box = row.getBoundingClientRect();
    return {
      id: row.dataset.blockId,
      position: clientY < box.top + box.height / 2 ? "before" as const : "after" as const,
    };
  }

  function beginBlockDrag(blockId: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveBlockId(blockId);
    setInsertMenu(null);
    setBlockMenu(null);
    dragSessionRef.current = {
      blockId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      handle: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveBlockDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    if (!session.active && distance < 5) return;
    if (!session.active) {
      session.active = true;
      setDraggingBlock(session.blockId);
      document.body.classList.add("is-block-dragging");
    }
    event.preventDefault();
    setDragPoint({
      x: Math.min(event.clientX, window.innerWidth - 360),
      y: Math.min(event.clientY, window.innerHeight - 84),
    });
    setDropTarget(dropTargetAt(event.clientX, event.clientY, session.blockId));

    const edge = 72;
    if (event.clientY < edge) window.scrollBy({ top: -12, behavior: "auto" });
    else if (event.clientY > window.innerHeight - edge) window.scrollBy({ top: 12, behavior: "auto" });
  }

  function finishBlockDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.handle.hasPointerCapture(event.pointerId)) session.handle.releasePointerCapture(event.pointerId);

    if (session.active && !cancelled) {
      const target = dropTargetAt(event.clientX, event.clientY, session.blockId);
      if (target) reorderBlock(session.blockId, target.id, target.position);
    } else if (!session.active && !cancelled) {
      setBlockTransformOpen(false);
      setBlockColorOpen(false);
      setBlockMenu({ blockId: session.blockId, rect: session.handle.getBoundingClientRect() });
    }

    dragSessionRef.current = null;
    setDraggingBlock("");
    setDragPoint(null);
    setDropTarget(null);
    document.body.classList.remove("is-block-dragging");
  }

  if (!active) {
    return (
      <section className="notes-workspace empty-workspace">
        <div className="notes-empty-icon" aria-hidden><StickyNote size={24} /></div>
        <div>
          <h2>{t("notes.emptyTitle")}</h2>
          <p>{t("notes.emptyDescription")}</p>
        </div>
        <button className="button primary" type="button" onClick={createNote}>
          <span className="nf" aria-hidden><Plus size={16} /></span>
          {t("notes.new")}
        </button>
      </section>
    );
  }

  return (
    <>
    <section className={`${styles.notionWorkspace} notes-workspace notes-desktop-workspace${singleNote ? " is-single" : ""}`}>
      {!singleNote && (
      <aside className="notes-browser">
        <div className="notes-browser-top">
          <div className="notes-search">
            <span className="nf" aria-hidden><Search size={14} /></span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("notes.search")} />
          </div>
          <button className="icon-button" type="button" onClick={createNote} title={t("notes.new")}>
            <span className="nf" aria-hidden><Plus size={15} /></span>
          </button>
        </div>
        <div className="notes-browser-list">
          <FileTree activePath={active.relativePath} className="vault-file-tree" data={tree} onRename={renameNoteFile} onSelect={selectNote} />
          {!filtered.length && <div className="empty small-empty">{t("notes.none")}</div>}
        </div>
      </aside>
      )}

      <article className="direct-note-editor" onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target === event.currentTarget || target.classList.contains("note-block-list")) {
          focusWritingSurface();
        }
      }}>
        <div className="direct-note-status">
          {singleNote && backHref ? (
            <Link className="note-back-link" href={backHref}>
              <ArrowLeft size={14} aria-hidden />
              {t("notes.back")}
            </Link>
          ) : (
            <span>{active.relativePath}</span>
          )}
          <div className="save-status-group">
            {canPrepare && (
              <Link className="button" href={prepareHref(active.relativePath)}>
                <BrainCircuit size={13} aria-hidden />
                {t("assistant.prepare")}
              </Link>
            )}
            {dailyToggle}
            {!isPage && !singleNote && !activeProtected && (
              <label className="note-move-select" title={t("notes.moveFile")}>
                <Move size={13} aria-hidden />
                <select aria-label={t("notes.moveFile")} disabled={moving} value={active.relativePath.slice(0, active.relativePath.lastIndexOf("/"))} onChange={(event) => void moveActiveNote(event.target.value)}>
                  {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
                </select>
              </label>
            )}
            {activeProtected && <span className="note-protected" title={t("notes.protectedDescription")}><LockKeyhole size={13} aria-hidden /> {t("notes.protected")}</span>}
            <strong className={`save-state save-${activeSaveState}`}>{activeSaveState === "dirty" ? t("notes.unsaved") : activeSaveState === "saving" ? t("notes.saving") : activeSaveState === "saved" ? t("notes.saved") : activeSaveState === "error" ? t("notes.saveFailed") : t("notes.ready")}</strong>
            {activeSaveState === "error" && (
              <button className="save-retry" type="button" onClick={() => void saveNote(active)}>{t("notes.retry")}</button>
            )}
            <button className="note-delete-btn" type="button" disabled={activeProtected} onClick={() => void deleteActiveNote()} title={activeProtected ? t("notes.protectedDescription") : t("notes.delete")}>
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
        </div>

        <div className="page-title-row">
          {pageIcon}
          <textarea
            ref={titleRef}
            className="direct-note-title"
            value={active.draftTitle}
            onChange={(event) => updateTitle(event.target.value.replace(/\n/g, ""))}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              focusWritingSurface();
            }}
            placeholder={t("workspace.untitled")}
            rows={1}
          />
        </div>

        {!isPage && !singleNote && (
          <div className="note-editor-meta">
            <span>{active.blocks.length} {t("notes.blocks")}</span>
            <span>{active.status || active.kind}</span>
            {active.kind === "finance-position" && Number.isFinite(financeQuantity) && <span>{t("finance.quantity")} : {financeQuantity}</span>}
            {active.kind === "finance-position" && Number.isFinite(financeUnitPrice) && <span>{t("finance.unitPrice")} : {formatMoney(financeUnitPrice)}</span>}
            {active.kind === "finance-position" && Number.isFinite(financeQuantity * financeUnitPrice) && <span>{t("finance.value")} : {formatMoney(financeQuantity * financeUnitPrice)}</span>}
            {!!active.tags.length && <span>{active.tags.map((tag) => `#${tag}`).join(" ")}</span>}
          </div>
        )}

        <div className="note-block-list" onKeyDown={handleBlockArrowNavigation} onPaste={handleBlockPaste}>
          {visibleBlocks.map((block) => (
            <div
              className={`note-block block-${block.type} ${activeBlockId === block.id ? "is-editing" : ""}${draggingBlock === block.id ? " is-dragging" : ""}${dropTarget?.id === block.id ? ` is-drop-${dropTarget.position}` : ""}`}
              key={block.id}
              data-block-id={block.id}
              data-text-color={block.color && block.color !== "default" ? block.color : undefined}
              data-background-color={block.background && block.background !== "default" ? block.background : undefined}
              style={{
                "--block-indent": block.indent || 0,
                "--block-text-color": notionColors[block.color || "default"].text,
                "--block-background": notionColors[block.background || "default"].background,
              } as CSSProperties}
            >
              <div className="block-side-controls">
                <button type="button" onClick={(event) => {
                  setBlockMenu(null);
                  setInsertMenu({ afterId: block.id, rect: event.currentTarget.getBoundingClientRect() });
                }} title={t("notes.addBlock")}>
                  <span className="nf" aria-hidden><Plus size={14} /></span>
                </button>
                <button
                  className="block-handle"
                  onPointerDown={(event) => beginBlockDrag(block.id, event)}
                  onPointerMove={moveBlockDrag}
                  onPointerUp={(event) => finishBlockDrag(event)}
                  onPointerCancel={(event) => finishBlockDrag(event, true)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setInsertMenu(null);
                    setBlockTransformOpen(false);
                    setBlockColorOpen(false);
                    setBlockMenu({ blockId: block.id, rect: event.currentTarget.getBoundingClientRect() });
                  }}
                  title={t("notes.moveBlock")}
                  type="button"
                >
                  <GripVertical className="block-grip" size={16} strokeWidth={2} aria-hidden />
                </button>
              </div>
              <BlockEditor
                block={block}
                collapsed={collapsedHeadings.has(block.id)}
                editing={activeBlockId === block.id}
                hiddenCount={hiddenCounts.get(block.id)}
                onAdd={() => block.type === "todo" || block.type === "bullet" || block.type === "number" ? addSiblingBlock(block.id, block.type) : block.type === "toggle" ? addChildBlock(block.id) : addSiblingBlock(block.id, "text")}
                onChange={(patch) => updateBlock(block.id, patch)}
                onDelete={() => deleteBlock(block.id)}
                onEdit={() => setActiveBlockId(block.id)}
                onIndent={(direction) => setBlockIndent(block.id, direction)}
                onSplit={(before, after) => splitTextBlock(block.id, before, after)}
                onToggle={block.type === "heading" || block.type === "toggle" ? () => toggleHeading(block.id) : undefined}
              />
            </div>
          ))}
        </div>

        <button className="note-bottom-add" type="button" onClick={focusWritingSurface} aria-label={t("notes.writeCommand")}>
          {!activeBlockId ? (
            <>
              <span className="nf" aria-hidden><PenLine size={14} /></span>
              {t("notes.writeCommand")}
            </>
          ) : null}
        </button>
      </article>
    </section>

    <MobileNotesSurface
      active={active}
      activeSaveState={activeSaveState}
      backHref={backHref}
      confirmDelete={deleteActiveNote}
      createNote={createNote}
      dailyToggle={dailyToggle}
      draft={mobileDrafts[active.id] ?? blocksToMarkdown(active.blocks)}
      editorOpen={mobileEditorOpen}
      filtered={filtered}
      isPage={isPage}
      notes={notes}
      onBack={() => singleNote && backHref ? router.push(backHref) : setMobileEditorOpen(false)}
      onFormat={applyMobileMarkdownAction}
      onOpen={openMobileNote}
      onQueryChange={setQuery}
      onRetry={() => void saveNote(active)}
      onTitleChange={updateTitle}
      onContentChange={updateMobileMarkdown}
      pageIcon={pageIcon}
      query={query}
      singleNote={singleNote}
      canPrepare={canPrepare}
      activeProtected={activeProtected}
      folders={folders}
      moving={moving}
      onMove={moveActiveNote}
      onRename={renameNoteFile}
      textareaRef={mobileTextareaRef}
      titleRef={mobileTitleRef}
    />

    {confirmDelete && (() => {
      const target = notes.find((n) => n.id === confirmDelete);
      return (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon"><Trash2 size={20} /></div>
            <h3>{t("notes.delete")}</h3>
            <p>{t("notes.deleteConfirm").replace("{title}", target?.draftTitle || t("workspace.untitled"))}</p>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setConfirmDelete(null)}>
                {t("workspace.cancel")}
              </button>
              <button className="button danger" type="button" onClick={handleConfirmDelete}>
                {t("workspace.delete")}
              </button>
            </div>
          </div>
        </div>
      );
    })()}

    {insertMenu && (
      <BlockInsertMenu
        rect={insertMenu.rect}
        onClose={() => setInsertMenu(null)}
        onSelect={(spec) => {
          insertBlock(spec, insertMenu.afterId);
          setInsertMenu(null);
        }}
      />
    )}

    {blockMenu && (() => {
      const block = active.blocks.find((item) => item.id === blockMenu.blockId);
      if (!block) return null;
      const pos = insertMenuPos(blockMenu.rect);
      return (
        <>
          <button className={`${styles.menuBackdrop} block-insert-backdrop`} type="button" aria-label={t("common.close")} onMouseDown={() => { setBlockMenu(null); setBlockTransformOpen(false); setBlockColorOpen(false); }} />
          <div className={`${styles.actionsMenu} block-actions-menu`} style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}>
            {blockTransformOpen ? (
              <>
                <button className={styles.actionsMenuBack} type="button" onClick={() => setBlockTransformOpen(false)}>
                  <ChevronLeft size={15} aria-hidden />
                  {locale === "fr" ? "Transformer en" : "Turn into"}
                </button>
                <div className={styles.transformList}>
                  {transformOptions.map((option) => {
                    const copy = localizedInsertOption(option, locale);
                    const isCurrent = block.type === option.type && (option.type !== "heading" || (block.level || 2) === option.level);
                    return (
                      <button className={isCurrent ? styles.currentType : undefined} data-transform-key={`${option.type}:${option.level || ""}`} key={`${option.type}-${option.level || ""}`} type="button" onClick={handleBlockTransform}>
                        <span className={styles.transformIcon}>{option.icon}</span>
                        {copy.label}
                        {isCurrent ? <Check className={styles.menuCheck} size={14} aria-hidden /> : null}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : blockColorOpen ? (
              <>
                <button className={styles.actionsMenuBack} type="button" onClick={() => setBlockColorOpen(false)}>
                  <ChevronLeft size={15} aria-hidden />
                  {locale === "fr" ? "Couleur" : "Color"}
                </button>
                <span className={styles.colorSectionLabel}>{locale === "fr" ? "Couleur du texte" : "Text color"}</span>
                <div className={styles.colorList}>
                  {(Object.keys(notionColors) as BlockColor[]).map((color) => (
                    <button data-color={color} data-color-kind="text" key={`text-${color}`} type="button" onClick={handleBlockColor}>
                      <span className={styles.textColorSwatch} style={{ color: notionColors[color].text }}>A</span>
                      {blockColorLabel(color, locale)}
                      {(block.color || "default") === color ? <Check className={styles.menuCheck} size={14} aria-hidden /> : null}
                    </button>
                  ))}
                </div>
                <span className={styles.colorSectionLabel}>{locale === "fr" ? "Couleur d’arrière-plan" : "Background color"}</span>
                <div className={styles.colorList}>
                  {(Object.keys(notionColors) as BlockColor[]).map((color) => (
                    <button data-color={color} data-color-kind="background" key={`background-${color}`} type="button" onClick={handleBlockColor}>
                      <span className={styles.backgroundColorSwatch} style={{ background: notionColors[color].background }} />
                      {blockColorLabel(color, locale)}
                      {(block.background || "default") === color ? <Check className={styles.menuCheck} size={14} aria-hidden /> : null}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="block-actions-menu-label">{blockTypeLabel(block, locale)}</div>
                <button type="button" onClick={() => setBlockTransformOpen(true)}>
                  <span aria-hidden>↪</span>
                  {locale === "fr" ? "Transformer en" : "Turn into"}
                  <ChevronRight className={styles.menuChevron} size={14} aria-hidden />
                </button>
                <button type="button" onClick={() => setBlockColorOpen(true)}>
                  <span aria-hidden>▣</span>
                  {locale === "fr" ? "Couleur" : "Color"}
                  <ChevronRight className={styles.menuChevron} size={14} aria-hidden />
                </button>
                <div className={styles.menuRule} />
                <button type="button" onClick={() => { duplicateBlock(block.id); setBlockMenu(null); }}>
                  <span aria-hidden>⧉</span>
                  {t("notes.duplicateBlock")}
                </button>
                <button type="button" onClick={() => { void copyBlock(block); setBlockMenu(null); }}>
                  {copiedBlockId === block.id ? <Check size={15} aria-hidden /> : <span aria-hidden>⎘</span>}
                  {copiedBlockId === block.id ? t("notes.copied") : t("notes.copyBlock")}
                </button>
                <button className="is-danger" type="button" onClick={() => { deleteBlock(block.id); setBlockMenu(null); }}>
                  <Trash2 size={15} aria-hidden />
                  {t("notes.deleteBlock")}
                </button>
              </>
            )}
          </div>
        </>
      );
    })()}

    {draggingBlock && dragPoint && (() => {
      const block = active.blocks.find((item) => item.id === draggingBlock);
      if (!block) return null;
      return (
        <div className="block-drag-overlay" style={{ left: dragPoint.x, top: dragPoint.y }} aria-hidden>
          <GripVertical size={16} />
          <div>
            <strong>{blockTypeLabel(block, locale)}</strong>
            <span>{blockDragPreview(block, locale)}</span>
          </div>
        </div>
      );
    })()}
    </>
  );
}

function MobileNotesSurface({
  active,
  activeSaveState,
  backHref,
  confirmDelete,
  createNote,
  dailyToggle,
  draft,
  editorOpen,
  filtered,
  isPage,
  notes,
  onBack,
  onContentChange,
  onFormat,
  onOpen,
  onQueryChange,
  onRetry,
  onTitleChange,
  pageIcon,
  query,
  singleNote,
  canPrepare,
  activeProtected,
  folders,
  moving,
  onMove,
  onRename,
  textareaRef,
  titleRef,
}: {
  active: EditableNote;
  activeSaveState: SaveState;
  backHref?: string;
  confirmDelete: () => void;
  createNote: () => Promise<void>;
  dailyToggle?: ReactNode;
  draft: string;
  editorOpen: boolean;
  filtered: EditableNote[];
  isPage: boolean;
  notes: EditableNote[];
  onBack: () => void;
  onContentChange: (markdown: string) => void;
  onFormat: (action: MobileNoteAction) => void;
  onOpen: (id: string) => void;
  onQueryChange: (query: string) => void;
  onRetry: () => void;
  onTitleChange: (title: string) => void;
  pageIcon?: ReactNode;
  query: string;
  singleNote: boolean;
  canPrepare: boolean;
  activeProtected: boolean;
  folders: string[];
  moving: boolean;
  onMove: (folder: string) => Promise<void>;
  onRename: (path: string, filename: string) => Promise<void>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  titleRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useLanguage();

  const saveLabel = activeSaveState === "dirty"
    ? t("notes.unsaved")
    : activeSaveState === "saving"
      ? t("notes.saving")
      : activeSaveState === "saved"
        ? t("notes.saved")
        : activeSaveState === "error"
          ? t("notes.saveFailed")
          : t("notes.ready");

  const formatItems: Array<{ action: MobileNoteAction; icon: ReactNode; label: string }> = [
    { action: "bold", icon: <Bold size={18} />, label: "Bold" },
    { action: "italic", icon: <Italic size={18} />, label: "Italic" },
    { action: "heading", icon: <Heading1 size={18} />, label: t("notes.heading") },
    { action: "checklist", icon: <ListTodo size={18} />, label: "Checklist" },
    { action: "bullet", icon: <List size={18} />, label: "Bullet" },
    { action: "number", icon: <ListOrdered size={18} />, label: "Number" },
    { action: "quote", icon: <Quote size={18} />, label: "Quote" },
    { action: "code", icon: <Code2 size={18} />, label: "Code" },
  ];

  return (
    <section className={`ios-notes-shell${editorOpen ? " is-editing" : " is-listing"}`}>
      {!editorOpen && !singleNote ? (
        <div className="ios-notes-list-view">
          <div className="ios-notes-list-header">
            <h1>{t("page.notes.title")}</h1>
            <button className="ios-notes-compose" type="button" onClick={() => void createNote()} title={t("notes.new")}>
              <Plus size={20} aria-hidden />
            </button>
          </div>
          <label className="ios-notes-search">
            <Search size={16} aria-hidden />
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("notes.search")} />
          </label>
          <div className="ios-notes-count">{notes.length} {t("page.notes.count")}</div>
          <div className="ios-notes-list">
            <FileTree activePath={active.relativePath} className="vault-file-tree" data={noteTree(filtered)} onRename={onRename} onSelect={onOpen} />
            {!filtered.length && <div className="ios-notes-empty">{t("notes.none")}</div>}
          </div>
        </div>
      ) : (
        <article className="ios-note-editor">
          <div className="ios-note-nav">
            <button className="ios-note-back" type="button" onClick={onBack}>
              <ArrowLeft size={19} aria-hidden />
              <span>{singleNote && backHref ? t("notes.back") : t("page.notes.title")}</span>
            </button>
            <div className="ios-note-actions">
              {canPrepare && (
                <Link
                  className="ios-note-icon-action"
                  href={prepareHref(active.relativePath)}
                  title={t("assistant.prepare")}
                  aria-label={t("assistant.prepare")}
                >
                  <BrainCircuit size={18} aria-hidden />
                </Link>
              )}
              {dailyToggle}
              {activeSaveState === "error" ? (
                <button className="ios-note-text-action" type="button" onClick={onRetry}>{t("notes.retry")}</button>
              ) : (
                <span className={`ios-save-state save-${activeSaveState}`}>{saveLabel}</span>
              )}
              {!isPage && (
                <button className="ios-note-icon-action" type="button" disabled={activeProtected} onClick={confirmDelete} title={activeProtected ? t("notes.protectedDescription") : t("notes.delete")}>
                  {activeProtected ? <LockKeyhole size={18} aria-hidden /> : <Trash2 size={18} aria-hidden />}
                </button>
              )}
            </div>
          </div>
          {!isPage && !singleNote && !activeProtected && (
            <label className="ios-note-location">
              <Move size={14} aria-hidden />
              <select aria-label={t("notes.moveFile")} disabled={moving} value={active.relativePath.slice(0, active.relativePath.lastIndexOf("/"))} onChange={(event) => void onMove(event.target.value)}>
                {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
              </select>
            </label>
          )}
          <div className="ios-note-paper">
            <div className="ios-note-title-row">
              {pageIcon}
              <textarea
                ref={titleRef}
                className="ios-note-title"
                value={active.draftTitle}
                onChange={(event) => onTitleChange(event.target.value.replace(/\n/g, ""))}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  textareaRef.current?.focus();
                }}
                placeholder={t("workspace.untitled")}
                rows={1}
              />
            </div>
            <textarea
              ref={textareaRef}
              className="ios-note-body"
              value={draft}
              onChange={(event) => onContentChange(event.target.value)}
              placeholder="Note"
              spellCheck
            />
          </div>
          <div className="ios-notes-toolbar" role="toolbar">
            {formatItems.map((item) => (
              <button
                key={item.action}
                type="button"
                aria-label={item.label}
                title={item.label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onFormat(item.action)}
              >
                {item.icon}
              </button>
            ))}
            <button className="ios-note-done" type="button" onClick={() => textareaRef.current?.blur()}>
              {t("notes.ready")}
            </button>
          </div>
        </article>
      )}
    </section>
  );
}

function formatMobileMarkdown(value: string, start: number, end: number, action: MobileNoteAction) {
  if (action === "bold") return wrapMarkdown(value, start, end, "**", "Texte");
  if (action === "italic") return wrapMarkdown(value, start, end, "_", "Texte");
  if (action === "code") {
    const selected = value.slice(start, end);
    if (selected.includes("\n")) return wrapMarkdown(value, start, end, "```\n", "\n```", "code");
    return wrapMarkdown(value, start, end, "`", "code");
  }
  if (action === "heading") return prefixSelectedLines(value, start, end, "## ");
  if (action === "checklist") return prefixSelectedLines(value, start, end, "- [ ] ");
  if (action === "bullet") return prefixSelectedLines(value, start, end, "- ");
  if (action === "number") return numberSelectedLines(value, start, end);
  return prefixSelectedLines(value, start, end, "> ");
}

function wrapMarkdown(value: string, start: number, end: number, marker: string, placeholder: string): { value: string; selectionStart: number; selectionEnd: number };
function wrapMarkdown(value: string, start: number, end: number, before: string, after: string, placeholder: string): { value: string; selectionStart: number; selectionEnd: number };
function wrapMarkdown(value: string, start: number, end: number, before: string, afterOrPlaceholder: string, placeholderMaybe?: string) {
  const after = placeholderMaybe === undefined ? before : afterOrPlaceholder;
  const placeholder = placeholderMaybe === undefined ? afterOrPlaceholder : placeholderMaybe;
  const selected = value.slice(start, end) || placeholder;
  const insert = `${before}${selected}${after}`;
  return {
    value: `${value.slice(0, start)}${insert}${value.slice(end)}`,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  };
}

function prefixSelectedLines(value: string, start: number, end: number, prefix: string) {
  const bounds = selectedLineBounds(value, start, end);
  const selected = value.slice(bounds.start, bounds.end);
  const lines = selected.split("\n");
  const allPrefixed = lines.every((line) => !line || line.startsWith(prefix));
  const nextLines = lines.map((line) => {
    if (!line && selected.length) return line;
    return allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`;
  });
  const replacement = nextLines.join("\n");
  const delta = replacement.length - selected.length;
  return {
    value: `${value.slice(0, bounds.start)}${replacement}${value.slice(bounds.end)}`,
    selectionStart: start + (allPrefixed ? -Math.min(prefix.length, start - bounds.start) : prefix.length),
    selectionEnd: Math.max(start, end + delta),
  };
}

function numberSelectedLines(value: string, start: number, end: number) {
  const bounds = selectedLineBounds(value, start, end);
  const selected = value.slice(bounds.start, bounds.end);
  const lines = selected.split("\n");
  const allNumbered = lines.every((line) => !line || /^\d+\.\s/.test(line));
  const nextLines = lines.map((line, index) => {
    if (!line && selected.length) return line;
    return allNumbered ? line.replace(/^\d+\.\s/, "") : `${index + 1}. ${line}`;
  });
  const replacement = nextLines.join("\n");
  const delta = replacement.length - selected.length;
  return {
    value: `${value.slice(0, bounds.start)}${replacement}${value.slice(bounds.end)}`,
    selectionStart: allNumbered ? bounds.start : Math.min(value.length + delta, start + 3),
    selectionEnd: Math.max(start, end + delta),
  };
}

function selectedLineBounds(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf("\n", end);
  return {
    start: lineStart,
    end: nextBreak === -1 ? value.length : nextBreak,
  };
}

type InsertGroup = "basic" | "advanced";
type InsertSpec = { label: string; hint: string; icon: string; type: BlockType; group: InsertGroup; level?: 1 | 2 | 3; chartKind?: ChartKind };

const insertOptions: InsertSpec[] = [
  { label: "Text", hint: "Plain paragraph", icon: "T", type: "text", group: "basic" },
  { label: "Heading 1", hint: "Large heading", icon: "H₁", type: "heading", level: 1, group: "basic" },
  { label: "Heading 2", hint: "Section", icon: "H₂", type: "heading", level: 2, group: "basic" },
  { label: "Heading 3", hint: "Sub-section", icon: "H₃", type: "heading", level: 3, group: "basic" },
  { label: "To-do", hint: "Checkbox", icon: "☑", type: "todo", group: "basic" },
  { label: "Bullet list", hint: "Unordered", icon: "•", type: "bullet", group: "basic" },
  { label: "Numbered list", hint: "Ordered", icon: "1.", type: "number", group: "basic" },
  { label: "Toggle", hint: "Collapsible", icon: "▸", type: "toggle", group: "basic" },
  { label: "Quote", hint: "Quoted text", icon: "❝", type: "quote", group: "basic" },
  { label: "Callout", hint: "Highlighted note", icon: "!", type: "callout", group: "basic" },
  { label: "Divider", hint: "Visual separator", icon: "—", type: "divider", group: "basic" },
  { label: "Code", hint: "Code block", icon: "</>", type: "code", group: "advanced" },
  { label: "Table", hint: "Rows and columns", icon: "▦", type: "table", group: "advanced" },
  { label: "Chart", hint: "Pie, bar or line", icon: "◔", type: "chart", chartKind: "pie", group: "advanced" },
];

const transformOptions = insertOptions.filter((option) => !["table", "chart", "divider"].includes(option.type));

function localizedInsertOption(option: InsertSpec, locale: "fr" | "en") {
  if (locale !== "fr") return option;
  const copy: Partial<Record<BlockType, [string, string]>> = {
    text: ["Texte", "Paragraphe simple"],
    todo: ["Liste de tâches", "Élément à cocher"],
    bullet: ["Liste à puces", "Liste non ordonnée"],
    number: ["Liste numérotée", "Liste ordonnée"],
    toggle: ["Liste dépliable", "Contenu à masquer"],
    quote: ["Citation", "Mettre un texte en valeur"],
    callout: ["Encadré", "Information à retenir"],
    divider: ["Séparateur", "Diviser la page"],
    code: ["Code", "Bloc de code"],
    table: ["Tableau", "Lignes et colonnes"],
    chart: ["Graphique", "Répartition, barres ou courbe"],
  };
  if (option.type === "heading") return { ...option, label: `Titre ${option.level}`, hint: option.level === 1 ? "Grand titre" : "Titre de section" };
  const translated = copy[option.type];
  return translated ? { ...option, label: translated[0], hint: translated[1] } : option;
}

function blockColorLabel(color: BlockColor, locale: "fr" | "en") {
  const labels: Record<BlockColor, [string, string]> = {
    default: ["Par défaut", "Default"],
    gray: ["Gris", "Gray"],
    brown: ["Marron", "Brown"],
    orange: ["Orange", "Orange"],
    yellow: ["Jaune", "Yellow"],
    green: ["Vert", "Green"],
    blue: ["Bleu", "Blue"],
    purple: ["Violet", "Purple"],
    pink: ["Rose", "Pink"],
    red: ["Rouge", "Red"],
  };
  return labels[color][locale === "fr" ? 0 : 1];
}

function isBlockColor(value: string): value is BlockColor {
  return Object.hasOwn(notionColors, value);
}

function insertMenuPos(rect: DOMRect) {
  const width = 280;
  const gap = 6;
  const margin = 8;
  const height = 320;
  const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
  const below = window.innerHeight - rect.bottom - gap - margin;
  if (below < 200 && rect.top - gap > below) {
    return { left, bottom: window.innerHeight - rect.top + gap, maxHeight: Math.max(120, Math.min(height, rect.top - gap - margin)) };
  }
  return { left, top: rect.bottom + gap, maxHeight: Math.max(120, Math.min(height, below)) };
}

function BlockInsertMenu({
  rect,
  onSelect,
  onClose,
}: {
  rect: DOMRect;
  onSelect: (spec: InsertSpec) => void;
  onClose: () => void;
}) {
  const { t, locale } = useLanguage();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const pos = insertMenuPos(rect);
  const visible = insertOptions.map((option) => localizedInsertOption(option, locale)).filter((option) => {
    const needle = query.trim().toLowerCase();
    return !needle || `${option.label} ${option.hint} ${option.type}`.toLowerCase().includes(needle);
  });
  const groups = (["basic", "advanced"] as const)
    .map((group) => ({ group, options: visible.filter((option) => option.group === group) }))
    .filter((group) => group.options.length);

  return (
    <>
      <button className={`${styles.menuBackdrop} block-insert-backdrop`} type="button" aria-label={t("common.close")} onMouseDown={onClose} />
      <div className={`${styles.insertMenu} block-insert-menu`} style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }} role="dialog" aria-label={t("notes.addBlock")}>
        <input
          autoFocus
          className="block-insert-search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(visible.length - 1, current + 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, current - 1));
            }
            if (event.key === "Enter" && visible[activeIndex]) onSelect(visible[activeIndex]);
          }}
          placeholder={t("notes.searchBlockType")}
          aria-label={t("notes.searchBlockType")}
        />
        {groups.map(({ group, options }) => (
          <div className={styles.insertGroup} key={group}>
            <span className={styles.insertGroupLabel}>{locale === "fr" ? group === "basic" ? "Blocs de base" : "Données et média" : group === "basic" ? "Basic blocks" : "Data and media"}</span>
            {options.map((option) => {
              const index = visible.indexOf(option);
              return (
                <button className={index === activeIndex ? styles.activeMenuItem : undefined} key={`${option.type}-${option.level ?? ""}`} type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => onSelect(option)}>
                  <span className="block-insert-ico">{option.icon}</span>
                  <span>{option.label}{option.hint ? <small>{option.hint}</small> : null}</span>
                </button>
              );
            })}
          </div>
        ))}
        {!visible.length && <div className="block-insert-empty">{t("notes.noBlockType")}</div>}
      </div>
    </>
  );
}

function BlockEditor({
  block,
  collapsed,
  editing,
  hiddenCount,
  onAdd,
  onChange,
  onDelete,
  onEdit,
  onIndent,
  onSplit,
  onToggle,
}: {
  block: NoteBlock;
  collapsed?: boolean;
  editing: boolean;
  hiddenCount?: number;
  onAdd: () => void;
  onChange: (patch: Partial<NoteBlock>) => void;
  onDelete: () => void;
  onEdit: () => void;
  onIndent: (direction: "in" | "out") => void;
  onSplit: (before: string, after: string) => void;
  onToggle?: () => void;
}) {
  const { locale, t } = useLanguage();
  if (block.type === "heading") {
    return (
      <div className="heading-block-row">
        <button
          className={`heading-toggle-btn${collapsed ? " is-collapsed" : ""}`}
          type="button"
          onClick={onToggle}
          title={collapsed ? t("notes.expand") : t("notes.collapse")}
        >
          <ChevronRight size={12} />
        </button>
        <input
          className={`block-heading-input block-heading-${block.level || 2}`}
          value={block.text}
          onChange={(event) => onChange({ text: event.target.value })}
          onFocus={onEdit}
          onKeyDown={(event) => handleInlineKeyDown(event, block.text, onAdd, onDelete, onIndent)}
          placeholder={t("notes.heading")}
        />
        <div className={`heading-level-pills${editing ? " is-visible" : ""}`}>
          {([1, 2, 3] as const).map((lvl) => (
            <button
              key={lvl}
              className={`level-pill${(block.level || 2) === lvl ? " is-active" : ""}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange({ level: lvl }); }}
            >
              H{lvl}
            </button>
          ))}
        </div>
        {collapsed && !!hiddenCount && (
          <span className="collapsed-count">{hiddenCount} {locale === "fr" ? `bloc${hiddenCount > 1 ? "s" : ""}` : `block${hiddenCount > 1 ? "s" : ""}`}</span>
        )}
      </div>
    );
  }

  if (block.type === "todo") {
    return (
      <label className="todo-block-row">
        <input checked={!!block.checked} onChange={(event) => onChange({ checked: event.target.checked })} type="checkbox" />
        <input
          type="text"
          value={block.text}
          onChange={(event) => onChange({ text: event.target.value })}
          onFocus={onEdit}
          onKeyDown={(event) => handleInlineKeyDown(event, block.text, onAdd, onDelete, onIndent)}
          placeholder={t("form.task")}
        />
      </label>
    );
  }

  if (block.type === "field") {
    return (
      <div className="field-block-row">
        <input
          value={block.label || ""}
          onChange={(event) => onChange({ label: event.target.value })}
          onFocus={onEdit}
          onKeyDown={(event) => handleInlineKeyDown(event, block.label || "", onAdd, onDelete, onIndent)}
          placeholder={t("notes.field")}
        />
        <textarea
          value={block.text}
          onChange={(event) => onChange({ text: event.target.value })}
          onFocus={onEdit}
          onKeyDown={(event) => {
            if (handleIndentKey(event, onIndent)) return;
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onAdd();
            }
          }}
          placeholder={t("notes.value")}
          rows={1}
        />
      </div>
    );
  }

  if (block.type === "toggle") {
    return (
      <div className="toggle-block-row">
        <button
          className={`heading-toggle-btn${collapsed ? " is-collapsed" : ""}`}
          type="button"
          onClick={onToggle}
          title={collapsed ? t("notes.expand") : t("notes.collapse")}
        >
          <ChevronRight size={12} />
        </button>
        <div className="toggle-block-copy">
          <input
            value={block.label || ""}
            onChange={(event) => onChange({ label: event.target.value })}
            onFocus={onEdit}
            onKeyDown={(event) => handleInlineKeyDown(event, block.label || "", onAdd, onDelete, onIndent)}
            placeholder={t("notes.toggleTitle")}
          />
          {!collapsed && (
            <textarea
              value={block.text}
              onChange={(event) => onChange({ text: event.target.value })}
              onFocus={onEdit}
              onKeyDown={(event) => handleTextareaKeyDown(event, block.text, onAdd, onDelete, onIndent)}
              placeholder={t("notes.toggleContent")}
              rows={1}
            />
          )}
        </div>
        {collapsed && !!hiddenCount && (
          <span className="collapsed-count">{hiddenCount} {locale === "fr" ? `bloc${hiddenCount > 1 ? "s" : ""}` : `block${hiddenCount > 1 ? "s" : ""}`}</span>
        )}
      </div>
    );
  }

  if (block.type === "table") {
    return <TableBlockEditor block={block} onChange={onChange} onEdit={onEdit} />;
  }

  if (block.type === "chart") {
    return <ChartBlockEditor block={block} onChange={onChange} onEdit={onEdit} />;
  }

  if (block.type === "divider") {
    return (
      <button className={styles.dividerBlock} type="button" onClick={onEdit} aria-label={t("notes.blockLabelDivider")}>
        <span />
      </button>
    );
  }

  if (block.type === "quote" || block.type === "callout" || block.type === "code" || block.type === "bullet" || block.type === "number") {
    return (
      <StructuredTextBlockEditor
        block={block}
        onChange={onChange}
        onDelete={onDelete}
        onEdit={onEdit}
        onIndent={onIndent}
        onAdd={onAdd}
      />
    );
  }

  return (
    <TextBlockEditor
      block={block}
      editing={editing}
      onChange={onChange}
      onDelete={onDelete}
      onEdit={onEdit}
      onAdd={onAdd}
      onIndent={onIndent}
      onSplit={onSplit}
    />
  );
}

function StructuredTextBlockEditor({
  block,
  onChange,
  onDelete,
  onEdit,
  onIndent,
  onAdd,
}: {
  block: NoteBlock;
  onChange: (patch: Partial<NoteBlock>) => void;
  onDelete: () => void;
  onEdit: () => void;
  onIndent: (direction: "in" | "out") => void;
  onAdd: () => void;
}) {
  const { t } = useLanguage();
  const label = block.type === "code" ? t("notes.blockLabelCode") : block.type === "callout" ? t("notes.blockLabelCallout") : block.type === "quote" ? t("notes.blockLabelQuote") : block.type === "bullet" ? t("notes.blockLabelBullet") : t("notes.blockLabelNumber");
  const lines = Math.max(1, block.text.split(/\r?\n/).length);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [languageMenuPosition, setLanguageMenuPosition] = useState<FloatingMenuPosition | null>(null);
  const languageTriggerRef = useRef<HTMLButtonElement | null>(null);

  function openLanguageMenu() {
    onEdit();
    const rect = languageTriggerRef.current?.getBoundingClientRect();
    if (!rect) {
      setLanguageMenuOpen((open) => !open);
      return;
    }
    setLanguageMenuPosition(floatingMenuPosition(rect));
    setLanguageMenuOpen((open) => !open);
  }

  return (
    <div className={`${block.type}-block-row structured-block-row`}>
      {block.type === "callout" && (
        <input
          className="structured-block-label"
        value={block.label || "NOTE"}
        onChange={(event) => onChange({ label: event.target.value.toUpperCase() })}
        onFocus={onEdit}
        onKeyDown={(event) => { handleIndentKey(event, onIndent); }}
          placeholder="NOTE"
        />
      )}
      {block.type === "code" && (
        <div className="code-lang-picker">
          <button
            className="code-lang-trigger"
            ref={languageTriggerRef}
            type="button"
            onClick={openLanguageMenu}
          >
            <span>{block.label || "text"}</span>
            <ChevronRight size={12} aria-hidden />
          </button>
          {languageMenuOpen && (
            <CodeLanguageMenu
              anchor={languageMenuPosition}
              onBeforeRender={() => {
                const rect = languageTriggerRef.current?.getBoundingClientRect();
                if (rect) setLanguageMenuPosition(floatingMenuPosition(rect));
              }}
              value={block.label || "text"}
              onClose={() => setLanguageMenuOpen(false)}
              onSelect={(language) => {
                onChange({ label: language });
                setLanguageMenuOpen(false);
              }}
            />
          )}
        </div>
      )}
      {block.type === "code" ? (
        <CodeMirrorEditor
          value={block.text}
          language={block.label || "text"}
          onChange={(text) => onChange({ text })}
          onFocus={onEdit}
          onAdd={onAdd}
        />
      ) : (
      <div className={block.type === "number" || block.type === "bullet" ? "list-edit-row" : undefined}>
        {block.type === "number" && (
          <div className="list-gutter" aria-hidden>
            {Array.from({ length: lines }, (_, index) => <span key={index}>{index + 1}.</span>)}
          </div>
        )}
        {block.type === "bullet" && (
          <div className="list-gutter" aria-hidden>
            {Array.from({ length: lines }, (_, index) => <span key={index}>-</span>)}
          </div>
        )}
        <textarea
          className="structured-block-input"
          value={block.text}
          onChange={(event) => onChange({ text: event.target.value })}
          onFocus={onEdit}
          onKeyDown={(event) => handleTextareaKeyDown(event, block.text, onAdd, onDelete, onIndent)}
          placeholder={label}
          rows={1}
          spellCheck
        />
      </div>
      )}
    </div>
  );
}

function CodeLanguageMenu({
  anchor,
  value,
  onSelect,
  onClose,
  onBeforeRender,
}: {
  anchor: FloatingMenuPosition | null;
  value: string;
  onSelect: (language: string) => void;
  onClose: () => void;
  onBeforeRender: () => void;
}) {
  const { t } = useLanguage();
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onWindowChange() {
      onBeforeRender();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [onBeforeRender, onClose]);

  return (
    <>
      <button className="code-lang-backdrop" type="button" aria-label={t("notes.closeLanguage")} onMouseDown={onClose} />
      <div
        className="code-lang-menu"
        style={anchor ? {
          left: anchor.left,
          top: anchor.top,
          bottom: anchor.bottom,
          maxHeight: anchor.maxHeight,
        } : undefined}
      >
        {codeLanguages.map((language) => (
          <button
            className={`code-lang-option${value === language ? " is-active" : ""}`}
            key={language}
            type="button"
            onClick={() => onSelect(language)}
          >
            {language}
          </button>
        ))}
      </div>
    </>
  );
}

function floatingMenuPosition(rect: DOMRect): FloatingMenuPosition {
  const menuWidth = 180;
  const gap = 6;
  const margin = 8;
  const preferredHeight = 250;
  const minimumUsefulHeight = 96;
  const left = Math.min(Math.max(rect.left, margin), window.innerWidth - menuWidth - margin);
  const below = window.innerHeight - rect.bottom - gap - margin;
  const above = rect.top - gap - margin;

  if (below < minimumUsefulHeight && above > below) {
    return {
      left,
      bottom: window.innerHeight - rect.top + gap,
      maxHeight: Math.max(72, Math.min(preferredHeight, above)),
    };
  }

  return {
    left,
    top: rect.bottom + gap,
    maxHeight: Math.max(72, Math.min(preferredHeight, below)),
  };
}

function CodeMirrorEditor({
  value,
  language,
  onChange,
  onFocus,
  onAdd,
}: {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onAdd: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onFocusRef = useRef(onFocus);
  const onAddRef = useRef(onAdd);
  const valueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
    onFocusRef.current = onFocus;
    onAddRef.current = onAdd;
    valueRef.current = value;
  }, [onChange, onFocus, onAdd, value]);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          basicSetup,
          codeEditorTheme,
          syntaxHighlighting(codeHighlightStyle),
          EditorView.lineWrapping,
          codeLanguageExtension(language),
          Prec.high(keymap.of([{
            key: "Mod-Enter",
            run: () => {
              onAddRef.current();
              return true;
            },
          }])),
          EditorView.domEventHandlers({
            focus: () => {
              onFocusRef.current();
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div className="code-mirror-host" ref={hostRef} />;
}

function codeLanguageExtension(language: string) {
  switch (language.toLowerCase()) {
    case "javascript":
      return javascript({ jsx: false });
    case "jsx":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "python":
      return python();
    case "html":
      return html();
    case "css":
      return css();
    case "json":
      return json();
    case "sql":
      return sql();
    case "markdown":
      return markdown();
    case "yaml":
      return yaml();
    case "bash":
      return StreamLanguage.define(shell);
    case "dockerfile":
      return StreamLanguage.define(dockerFile);
    default:
      return [];
  }
}

function TextBlockEditor({
  block,
  editing,
  onChange,
  onDelete,
  onEdit,
  onAdd,
  onIndent,
  onSplit,
}: {
  block: NoteBlock;
  editing: boolean;
  onChange: (patch: Partial<NoteBlock>) => void;
  onDelete: () => void;
  onEdit: () => void;
  onAdd: () => void;
  onIndent: (direction: "in" | "out") => void;
  onSplit: (before: string, after: string) => void;
}) {
  const { t, locale } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeCommand, setActiveCommand] = useState(0);
  const slashQuery = block.text.match(/^\/[a-z0-9-]*$/i)?.[0] || "";
  const matchingCommands = slashQuery
    ? slashCommands
      .filter((item) => item.command.startsWith(slashQuery.toLowerCase()))
      .filter((item, index, commands) => commands.findIndex((candidate) => `${candidate.type}-${candidate.level || ""}-${candidate.chartKind || ""}` === `${item.type}-${item.level || ""}-${item.chartKind || ""}`) === index)
      .slice(0, 16)
    : [];

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!editing || !textarea || document.activeElement === textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [editing]);

  return (
    <div className="text-edit-wrap">
      <textarea
        className="text-block-input"
        ref={textareaRef}
        value={block.text}
        onChange={(event) => { onChange({ text: event.target.value }); setActiveCommand(0); }}
        onFocus={onEdit}
        onKeyDown={(event) => {
          if (matchingCommands.length && event.key === "ArrowDown") {
            event.preventDefault();
            setActiveCommand((current) => Math.min(matchingCommands.length - 1, current + 1));
            return;
          }
          if (matchingCommands.length && event.key === "ArrowUp") {
            event.preventDefault();
            setActiveCommand((current) => Math.max(0, current - 1));
            return;
          }
          if (matchingCommands.length && (event.key === "Tab" || event.key === "Enter")) {
            event.preventDefault();
            onChange(applySlashCommand(block, matchingCommands[activeCommand] || matchingCommands[0]));
            return;
          }
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSplit(block.text.slice(0, event.currentTarget.selectionStart), block.text.slice(event.currentTarget.selectionEnd));
            return;
          }
          handleTextareaKeyDown(event, block.text, onAdd, onDelete, onIndent);
        }}
        placeholder={editing ? t("notes.writeCommand") : ""}
        rows={1}
      />
      {!!matchingCommands.length && (
        <div className={`${styles.slashMenu} slash-menu`} role="listbox" aria-label={t("notes.addBlock")}>
          {matchingCommands.map((command, index) => {
            const copy = localizedSlashCommand(command, locale);
            return (
            <button
              className={index === activeCommand ? styles.activeMenuItem : undefined}
              key={command.command}
              type="button"
              role="option"
              aria-selected={index === activeCommand}
              onMouseEnter={() => setActiveCommand(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(applySlashCommand(block, command));
              }}
            >
              <span className={styles.slashIcon}>{slashCommandIcon(command)}</span>
              <span>{copy.label}<small>{copy.hint}</small></span>
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function localizedSlashCommand(command: (typeof slashCommands)[number], locale: "fr" | "en") {
  if (locale !== "fr") return command;
  if (command.type === "chart") {
    if (command.chartKind === "bar") return { ...command, label: "Graphique en barres", hint: "Comparer plusieurs valeurs" };
    if (command.chartKind === "line") return { ...command, label: "Courbe", hint: "Suivre une évolution" };
    return { ...command, label: "Graphique en secteurs", hint: "Visualiser une répartition" };
  }
  const option = insertOptions.find((item) => item.type === command.type && (item.level || 0) === (command.level || 0));
  return option ? { ...command, ...localizedInsertOption(option, locale) } : command;
}

function slashCommandIcon(command: (typeof slashCommands)[number]) {
  if (command.type === "heading") return `H${command.level || 2}`;
  if (command.type === "todo") return "☑";
  if (command.type === "bullet") return "•";
  if (command.type === "number") return "1.";
  if (command.type === "toggle") return "▸";
  if (command.type === "quote") return "❝";
  if (command.type === "callout") return "!";
  if (command.type === "divider") return "—";
  if (command.type === "table") return "▦";
  if (command.type === "chart") return "◔";
  if (command.type === "code") return "</>";
  return "T";
}

function handleInlineKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  value: string,
  onAdd: () => void,
  onDelete: () => void,
  onIndent: (direction: "in" | "out") => void,
) {
  if (handleIndentKey(event, onIndent)) return;
  if (event.key === "Enter") {
    event.preventDefault();
    onAdd();
    return;
  }
  if (event.key === "Backspace" && !value) {
    event.preventDefault();
    onDelete();
  }
}

function handleTextareaKeyDown(
  event: KeyboardEvent<HTMLTextAreaElement>,
  value: string,
  onAdd: () => void,
  onDelete: () => void,
  onIndent: (direction: "in" | "out") => void,
) {
  if (handleIndentKey(event, onIndent)) return;
  // Notion-exact: Enter starts a new block, Shift+Enter keeps a soft line
  // break inside the current block. (Cmd/Ctrl+Enter also splits, as before.)
  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
    event.preventDefault();
    onAdd();
    return;
  }
  if (event.key === "Backspace" && !value) {
    event.preventDefault();
    onDelete();
  }
}

function handleIndentKey(
  event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  onIndent: (direction: "in" | "out") => void,
) {
  if (event.key !== "Tab") return false;
  event.preventDefault();
  onIndent(event.shiftKey ? "out" : "in");
  return true;
}

function TableBlockEditor({
  block,
  onChange,
  onEdit,
}: {
  block: NoteBlock;
  onChange: (patch: Partial<NoteBlock>) => void;
  onEdit: () => void;
}) {
  const { t } = useLanguage();
  const rows = block.rows && block.rows.length ? block.rows : defaultTableRows();
  const cols = Math.max(1, ...rows.map((row) => row.length));

  function normalized() {
    return rows.map((row) => {
      const copy = [...row];
      while (copy.length < cols) copy.push("");
      return copy;
    });
  }

  function setCell(r: number, c: number, value: string) {
    const next = normalized();
    next[r][c] = value;
    onChange({ rows: next });
  }

  function addRow() {
    onChange({ rows: [...normalized(), Array.from({ length: cols }, () => "")] });
  }

  function addColumn() {
    onChange({ rows: normalized().map((row) => [...row, ""]) });
  }

  function removeRow(r: number) {
    if (rows.length <= 1) return;
    onChange({ rows: rows.filter((_, index) => index !== r) });
  }

  function removeColumn(c: number) {
    if (cols <= 1) return;
    onChange({ rows: normalized().map((row) => row.filter((_, index) => index !== c)) });
  }

  return (
    <div className="table-block-row" onFocus={onEdit}>
      <div className="table-scroll">
        <table className="editable-table">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className={r === 0 ? "is-header-cell" : undefined}>
                    <input
                      value={row[c] ?? ""}
                      onChange={(event) => setCell(r, c, event.target.value)}
                      onFocus={onEdit}
                      placeholder={r === 0 ? `${t("notes.column")} ${c + 1}` : ""}
                    />
                  </td>
                ))}
                <td className="table-line-remove">
                  <button type="button" onClick={() => removeRow(r)} title={t("notes.deleteRow")} disabled={rows.length <= 1}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
            <tr className="table-col-remove-row">
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <button type="button" onClick={() => removeColumn(c)} title={t("notes.deleteColumn")} disabled={cols <= 1}>
                    ×
                  </button>
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="table-block-actions">
        <button type="button" onClick={addRow}>+ {t("notes.addRow")}</button>
        <button type="button" onClick={addColumn}>+ {t("notes.addColumn")}</button>
      </div>
    </div>
  );
}

function ChartBlockEditor({
  block,
  onChange,
  onEdit,
}: {
  block: NoteBlock;
  onChange: (patch: Partial<NoteBlock>) => void;
  onEdit: () => void;
}) {
  const { t } = useLanguage();
  const chart = block.chart || defaultChart();

  function setKind(kind: ChartKind) {
    onChange({ chart: { ...chart, kind } });
  }

  function setPoint(index: number, patch: Partial<ChartPoint>) {
    onChange({ chart: { ...chart, points: chart.points.map((point, i) => (i === index ? { ...point, ...patch } : point)) } });
  }

  function addPoint() {
    onChange({ chart: { ...chart, points: [...chart.points, { label: "", value: 0 }] } });
  }

  function removePoint(index: number) {
    if (chart.points.length <= 1) return;
    onChange({ chart: { ...chart, points: chart.points.filter((_, i) => i !== index) } });
  }

  const kinds: Array<{ kind: ChartKind; label: string }> = [
    { kind: "pie", label: t("notes.chartPie") },
    { kind: "bar", label: t("notes.chartBar") },
    { kind: "line", label: t("notes.chartLine") },
  ];

  return (
    <div className="chart-block-row" onFocus={onEdit}>
      <div className="chart-block-controls">
        <div className="chart-kind-pills">
          {kinds.map((option) => (
            <button
              key={option.kind}
              type="button"
              className={`level-pill${chart.kind === option.kind ? " is-active" : ""}`}
              onMouseDown={(event) => { event.preventDefault(); setKind(option.kind); }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="chart-data-rows">
          {chart.points.map((point, index) => (
            <div className="chart-data-row" key={index}>
              <span className="chart-data-swatch" style={{ background: chartPalette[index % chartPalette.length] }} />
              <input
                value={point.label}
                onChange={(event) => setPoint(index, { label: event.target.value })}
                onFocus={onEdit}
                placeholder={t("notes.dataLabel")}
              />
              <input
                type="number"
                value={Number.isFinite(point.value) ? point.value : 0}
                onChange={(event) => setPoint(index, { value: Number(event.target.value) })}
                onFocus={onEdit}
                placeholder={t("notes.dataValue")}
              />
              <button type="button" onClick={() => removePoint(index)} disabled={chart.points.length <= 1} title={t("notes.deletePoint")}>
                ×
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="chart-add-point" onClick={addPoint}>+ {t("notes.addPoint")}</button>
      </div>
      <div className="chart-block-preview">
        <ChartPreview chart={chart} />
      </div>
    </div>
  );
}

function ChartPreview({ chart }: { chart: ChartSpec }) {
  const { t } = useLanguage();
  const points = chart.points.filter((point) => (point.label || "").trim() !== "" || point.value !== 0);
  if (!points.length) return <div className="chart-block-empty">—</div>;
  if (chart.kind === "bar") return <BarChartView points={points} />;
  if (chart.kind === "line") return <LineChartView points={points} />;
  const total = points.reduce((sum, point) => sum + Math.max(0, point.value), 0) || 1;
  return (
    <DonutChart
      segments={points.map((point) => ({
        label: point.label || "—",
        value: Math.max(0, point.value),
        formattedValue: `${Math.round((Math.max(0, point.value) / total) * 100)}%`,
      }))}
      centerValue={total}
      centerSub={t("notes.chartTotal")}
    />
  );
}

function BarChartView({ points }: { points: ChartPoint[] }) {
  const { t } = useLanguage();
  const max = Math.max(1, ...points.map((point) => Math.abs(point.value)));
  const width = 240;
  const height = 150;
  const gap = 10;
  const padBottom = 26;
  const barWidth = (width - gap * (points.length - 1)) / points.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={t("notes.chartBar")}>
      {points.map((point, index) => {
        const barHeight = Math.max(2, (Math.abs(point.value) / max) * (height - padBottom - 18));
        const x = index * (barWidth + gap);
        const y = height - padBottom - barHeight;
        return (
          <g key={index}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx="6" fill={chartPalette[index % chartPalette.length]} />
            <text x={x + barWidth / 2} y={height - padBottom + 14} textAnchor="middle" className="chart-mini-label">{point.label}</text>
            <text x={x + barWidth / 2} y={Math.max(12, y - 5)} textAnchor="middle" className="chart-mini-value">{point.value}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChartView({ points }: { points: ChartPoint[] }) {
  const { t } = useLanguage();
  const width = 240;
  const height = 150;
  const padBottom = 26;
  const padTop = 14;
  const max = Math.max(1, ...points.map((point) => point.value));
  const min = Math.min(0, ...points.map((point) => point.value));
  const range = max - min || 1;
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * (width - 12) + 6;
    const y = height - padBottom - ((point.value - min) / range) * (height - padBottom - padTop);
    return { ...point, x, y };
  });
  const line = coords.map((coord) => `${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={t("notes.chartLine")}>
      <polyline points={line} fill="none" stroke={chartPalette[2]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {coords.map((coord, index) => (
        <g key={index}>
          <circle cx={coord.x} cy={coord.y} r="3.5" fill={chartPalette[0]} stroke={chartPalette[4]} strokeWidth="1.5" />
          <text x={coord.x} y={height - padBottom + 14} textAnchor="middle" className="chart-mini-label">{coord.label}</text>
        </g>
      ))}
    </svg>
  );
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function tableToMarkdown(rows: string[][]): string {
  const clean = rows.length ? rows : defaultTableRows();
  const cols = Math.max(1, ...clean.map((row) => row.length));
  const pad = (row: string[]) => {
    const next = row.slice(0, cols);
    while (next.length < cols) next.push("");
    return next;
  };
  const esc = (cell: string) => (cell || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  const header = pad(clean[0] || []);
  const body = clean.slice(1).map(pad);
  return [
    `| ${header.map(esc).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map(esc).join(" | ")} |`),
  ].join("\n");
}

function parseChart(body: string): ChartSpec {
  let kind: ChartKind = "pie";
  const points: ChartPoint[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const typeMatch = line.match(/^type\s*:\s*(pie|bar|line|camembert)$/i);
    if (typeMatch) {
      const value = typeMatch[1].toLowerCase();
      kind = value === "camembert" ? "pie" : (value as ChartKind);
      continue;
    }
    const comma = line.lastIndexOf(",");
    if (comma === -1) continue;
    const label = line.slice(0, comma).trim();
    if (!label) continue;
    const value = Number(line.slice(comma + 1).replace(/[^0-9.-]/g, ""));
    points.push({ label, value: Number.isFinite(value) ? value : 0 });
  }
  return { kind, points: points.length ? points : defaultChart(kind).points };
}

function chartToMarkdown(chart: ChartSpec): string {
  const lines = [`type: ${chart.kind}`];
  for (const point of chart.points) {
    lines.push(`${(point.label || "—").replace(/,/g, " ").trim() || "—"}, ${Number.isFinite(point.value) ? point.value : 0}`);
  }
  return lines.join("\n");
}

function applySlashCommand(block: NoteBlock, command: (typeof slashCommands)[number]): Partial<NoteBlock> {
  const trailing = block.text.slice(command.command.length).trimStart();
  const structured = command.type === "table" || command.type === "chart" || command.type === "divider";
  return {
    type: command.type,
    text: command.type === "toggle" || structured ? "" : trailing,
    label: command.labelValue || (command.type === "toggle" ? trailing || "Toggle" : command.type === "field" ? "Field" : undefined),
    checked: command.type === "todo" ? false : block.checked,
    level: command.type === "heading" ? command.level || 2 : undefined,
    rows: command.type === "table" ? defaultTableRows() : block.rows,
    chart: command.type === "chart" ? defaultChart(command.chartKind || "pie") : block.chart,
  };
}

function toEditable(note: VaultNote): EditableNote {
  return {
    ...note,
    draftTitle: cleanTitle(note.title),
    blocks: markdownToBlocks(stripTitleHeading(note.content, note.title), note.id),
  };
}

function markdownToBlocks(content: string, noteId: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let text: string[] = [];
  let code: string[] | null = null;
  let codeLang = "";
  let toggle: { label: string; lines: string[]; indent: number } | null = null;
  let table: { lines: string[]; indent: number } | null = null;
  let pendingStyle: Pick<NoteBlock, "color" | "background"> = {};
  let lineNumber = 0;

  function nextId(type: BlockType) {
    return `${noteId}:${type}:${lineNumber}:${blocks.length}`;
  }

  function pushParsedBlock(block: NoteBlock) {
    blocks.push({ ...block, ...pendingStyle });
    pendingStyle = {};
  }

  function flushText() {
    const body = text.join("\n").trim();
    if (body) pushParsedBlock(newBlock("text", body, nextId("text")));
    text = [];
  }

  // A GFM table needs a header row and a `| --- |` separator on the second
  // line. If those aren't present the buffered lines are plain text instead.
  function flushTable() {
    if (!table) return;
    const { lines, indent: tableIndent } = table;
    table = null;
    const isTable = lines.length >= 2 && /-/.test(lines[1]) && /^\|?[\s:|-]+\|?$/.test(lines[1].trim());
    if (!isTable) {
      text.push(...lines);
      return;
    }
    const rows = lines.filter((_, index) => index !== 1).map(parseTableRow);
    pushParsedBlock({ ...newBlock("table", "", nextId("table")), rows, indent: tableIndent });
  }

  for (const line of content.split(/\r?\n/)) {
    lineNumber += 1;
    const indent = Math.floor((line.match(/^\s*/)?.[0].replace(/\t/g, "  ").length || 0) / 2);
    const strippedLine = line.replace(/^\s+/, "");
    const fence = strippedLine.match(/^```(.*)$/);

    if (toggle) {
      if (/^<\/details>\s*$/i.test(strippedLine)) {
        const closedToggle = toggle;
        pushParsedBlock({
          ...newBlock("toggle", closedToggle.lines.join("\n").trim(), nextId("toggle")),
          label: closedToggle.label,
          indent: closedToggle.indent,
        });
        const children = markdownToBlocks(closedToggle.lines.join("\n"), `${noteId}:toggle:${lineNumber}`)
          .map((child) => ({ ...child, indent: (child.indent || 0) + closedToggle.indent + 1 }));
        blocks[blocks.length - 1].text = "";
        blocks.push(...children);
        toggle = null;
      } else {
        toggle.lines.push(line);
      }
      continue;
    }

    if (code) {
      if (fence) {
        if (codeLang.toLowerCase() === "chart") {
          pushParsedBlock({ ...newBlock("chart", "", nextId("chart")), chart: parseChart(code.join("\n")) });
        } else {
          pushParsedBlock({
            ...newBlock("code", code.join("\n"), nextId("code")),
            label: codeLang,
          });
        }
        code = null;
        codeLang = "";
      } else {
        code.push(line);
      }
      continue;
    }

    const style = strippedLine.match(/^<!--\s*block-style:\s*color=([a-z]+);\s*background=([a-z]+)\s*-->$/i);
    if (style) {
      flushText();
      const color = style[1].toLowerCase();
      const background = style[2].toLowerCase();
      pendingStyle = {
        color: isBlockColor(color) ? color : "default",
        background: isBlockColor(background) ? background : "default",
      };
      continue;
    }

    const isTableRow = /^\|.*\|\s*$/.test(strippedLine);
    if (table) {
      if (isTableRow) {
        table.lines.push(strippedLine);
        continue;
      }
      flushTable();
      // fall through and process the current (non-table) line normally
    }
    if (isTableRow) {
      flushText();
      table = { lines: [strippedLine], indent };
      continue;
    }

    const heading = strippedLine.match(/^(#{1,3})\s+(.+)$/);
    const task = strippedLine.match(/^-\s+\[([ xX])\]\s+(.*)$/);
    const bullet = strippedLine.match(/^[-*]\s+(.*)$/);
    const number = strippedLine.match(/^\d+\.\s+(.*)$/);
    const quote = strippedLine.match(/^>\s+(.+)$/);
    const callout = strippedLine.match(/^>\s+\[!(\w+)\]\s*(.*)$/);
    const details = strippedLine.match(/^<details>\s*<summary>(.*?)<\/summary>\s*$/i);
    const divider = /^-{3,}\s*$/.test(strippedLine);
    const boldField = strippedLine.match(/^\*\*([^:*]+):\*\*\s*(.*)$/);
    const plainField = strippedLine.match(/^([^:\n]{2,42})::\s*(.*)$/);

    if (fence) {
      flushText();
      code = [];
      codeLang = fence[1].trim();
      continue;
    }

    if (!line.trim()) {
      flushText();
      continue;
    }

    if (heading) {
      flushText();
      pushParsedBlock({
        ...newBlock("heading", heading[2], nextId("heading")),
        level: Math.min(heading[1].length, 3) as 1 | 2 | 3,
        indent,
      });
      continue;
    }

    if (divider) {
      flushText();
      pushParsedBlock({ ...newBlock("divider", "", nextId("divider")), indent });
      continue;
    }

    if (task) {
      flushText();
      pushParsedBlock({
        ...newBlock("todo", task[2], nextId("todo")),
        checked: task[1].toLowerCase() === "x",
        indent,
      });
      continue;
    }

    if (callout) {
      flushText();
      pushParsedBlock({
        ...newBlock("callout", callout[2], nextId("callout")),
        label: callout[1].toUpperCase(),
        indent,
      });
      continue;
    }

    if (quote) {
      flushText();
      // AI-written notes often emit one `> line` per sentence with blank lines
      // between; fold consecutive quote lines into a single quote block instead
      // of a stack of one-line blocks.
      const previous = blocks[blocks.length - 1];
      if (previous && previous.type === "quote" && previous.indent === indent && !pendingStyle.color && !pendingStyle.background) {
        previous.text = `${previous.text}\n${quote[1]}`;
      } else {
        pushParsedBlock({ ...newBlock("quote", quote[1], nextId("quote")), indent });
      }
      continue;
    }

    if (bullet) {
      flushText();
      pushParsedBlock({ ...newBlock("bullet", bullet[1], nextId("bullet")), indent });
      continue;
    }

    if (number) {
      flushText();
      pushParsedBlock({ ...newBlock("number", number[1], nextId("number")), indent });
      continue;
    }

    if (details) {
      flushText();
      toggle = { label: details[1] || "Toggle", lines: [], indent };
      continue;
    }

    if (boldField || plainField) {
      flushText();
      const match = boldField || plainField;
      pushParsedBlock({
        ...newBlock("field", match?.[2] || "", nextId("field")),
        label: cleanHeading(match?.[1] || "Field"),
        indent,
      });
      continue;
    }

    text.push(line);
  }

  if (table) flushTable();
  if (code) {
    if (codeLang.toLowerCase() === "chart") {
      pushParsedBlock({ ...newBlock("chart", "", nextId("chart")), chart: parseChart(code.join("\n")) });
    } else {
      pushParsedBlock({
        ...newBlock("code", code.join("\n"), nextId("code")),
        label: codeLang,
      });
    }
  }
  if (toggle) {
    pushParsedBlock({
      ...newBlock("toggle", toggle.lines.join("\n").trim(), nextId("toggle")),
      label: toggle.label,
      indent: toggle.indent,
    });
  }
  flushText();
  return blocks.length ? blocks : [newBlock("text", "", `${noteId}:empty`)];
}

function blocksToMarkdown(blocks: NoteBlock[]) {
  return serializeBlocks(blocks, 0, 0).markdown.trim();
}

function serializeBlocks(blocks: NoteBlock[], start: number, indent: number): { markdown: string; next: number } {
  const parts: string[] = [];
  let index = start;
  while (index < blocks.length) {
    const block = blocks[index];
    const blockIndent = block.indent || 0;
    if (blockIndent < indent) break;
    if (blockIndent > indent) {
      parts.push(renderBlockMarkdown(block, blockIndent));
      index += 1;
      continue;
    }
    if (block.type === "toggle") {
      const child = serializeBlocks(blocks, index + 1, indent + 1);
      parts.push(renderBlockMarkdown(block, indent, child.markdown));
      index = child.next;
      continue;
    }
    parts.push(renderBlockMarkdown(block, indent));
    index += 1;
  }
  return { markdown: parts.filter(Boolean).join("\n\n"), next: index };
}

function renderBlockMarkdown(block: NoteBlock, indent = 0, childMarkdown = "") {
  const own = (() => {
    if (block.type === "heading") return `${"#".repeat(block.level || 2)} ${block.text.trim() || "Section"}`;
    if (block.type === "todo") return `- [${block.checked ? "x" : " "}] ${block.text.trim()}`;
    if (block.type === "field") return `**${(block.label || "Field").trim()}:** ${block.text.trim()}`;
    if (block.type === "toggle") {
      const body = [block.text.trim(), childMarkdown.trim()].filter(Boolean).join("\n\n");
      return `<details><summary>${(block.label || "Toggle").trim()}</summary>\n\n${body}\n\n</details>`;
    }
    if (block.type === "quote") return block.text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
    if (block.type === "callout") return `> [!${(block.label || "NOTE").trim().toUpperCase()}]\n${block.text.split(/\r?\n/).map((line) => `> ${line}`).join("\n")}`;
    if (block.type === "code") return `\`\`\`${(block.label || "").trim()}\n${block.text.replace(/\n?$/, "\n")}\`\`\``;
    if (block.type === "table") return tableToMarkdown(block.rows || []);
    if (block.type === "chart") return `\`\`\`chart\n${chartToMarkdown(block.chart || defaultChart())}\n\`\`\``;
    if (block.type === "divider") return "---";
    if (block.type === "bullet") return block.text.split(/\r?\n/).filter(Boolean).map((line) => `- ${line.replace(/^[-*]\s+/, "")}`).join("\n");
    if (block.type === "number") return block.text.split(/\r?\n/).filter(Boolean).map((line, index) => `${index + 1}. ${line.replace(/^\d+\.\s+/, "")}`).join("\n");
    return block.text.trim();
  })();
  const style = block.color && block.color !== "default" || block.background && block.background !== "default"
    ? `<!-- block-style: color=${block.color || "default"}; background=${block.background || "default"} -->\n`
    : "";
  const prefix = "  ".repeat(indent);
  return `${style}${own}`
    .split("\n")
    .map((line) => line ? `${prefix}${line}` : line)
    .join("\n");
}

function normalizeBlockTyping(block: NoteBlock): NoteBlock {
  if (block.type !== "text") return block;

  const text = block.text;
  const exactCommand = slashCommands.find((command) => text.toLowerCase() === command.command);
  if (exactCommand) return { ...block, ...applySlashCommand(block, exactCommand), text: "" };

  if (/^#{1,3}\s$/.test(text)) {
    return { ...block, type: "heading", level: text.trim().length as 1 | 2 | 3, text: "" };
  }
  if (/^[-*]\s$/.test(text)) return { ...block, type: "bullet", text: "" };
  if (/^1\.\s$/.test(text)) return { ...block, type: "number", text: "" };
  if (/^-{3}\s?$/.test(text)) return { ...block, type: "divider", text: "" };
  if (/^>\s$/.test(text)) return { ...block, type: "quote", text: "" };
  if (/^(?:\[\s?\]|-\s\[\s\])\s$/.test(text)) return { ...block, type: "todo", text: "", checked: false };

  const slash = text.match(/^(\/[a-z0-9-]+)\s+(.*)$/i);
  if (slash) {
    const command = slashCommands.find((item) => item.command === slash[1].toLowerCase());
    if (command) return { ...block, ...applySlashCommand({ ...block, text }, command) };
  }

  const todo = text.match(/^(?:\/todo|- \[([ xX])\])\s+(.*)$/);
  if (todo) {
    return { ...block, type: "todo", text: todo[2], checked: (todo[1] || " ").toLowerCase() === "x" };
  }

  const callout = text.match(/^>\s+\[!(\w+)\]\s*(.*)$/);
  if (callout) return { ...block, type: "callout", label: callout[1].toUpperCase(), text: callout[2] };

  const quote = text.match(/^>\s+(.+)$/);
  if (quote) return { ...block, type: "quote", text: quote[1] };

  const bullet = text.match(/^[-*]\s+(.+)$/);
  if (bullet) return { ...block, type: "bullet", text: bullet[1] };

  const number = text.match(/^\d+\.\s+(.+)$/);
  if (number) return { ...block, type: "number", text: number[1] };

  const field = text.match(/^(?:\/field\s+)?([^:\n]{2,42})::\s*(.*)$/);
  if (field) {
    return { ...block, type: "field", label: cleanHeading(field[1]), text: field[2] };
  }

  const headingHash = text.match(/^(#{1,3})\s+(.+)$/);
  if (headingHash) {
    return { ...block, type: "heading", level: headingHash[1].length as 1 | 2 | 3, text: cleanHeading(headingHash[2]) };
  }
  const headingCmd = text.match(/^\/h([123])?\s+(.+)$/);
  if (headingCmd) {
    const level = headingCmd[1] ? (parseInt(headingCmd[1]) as 1 | 2 | 3) : 2;
    return { ...block, type: "heading", level, text: cleanHeading(headingCmd[2]) };
  }

  return block;
}

function stripTitleHeading(content: string, title: string) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() === `# ${title}`) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return content;
}

function cleanTitle(value: string) {
  return cleanHeading(value) || value.trim();
}

function cleanHeading(value: string) {
  return value
    .replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]+/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function newBlock(type: BlockType, text: string, id: string): NoteBlock {
  return {
    id,
    type,
    text,
    checked: false,
    label: type === "field" ? "Field" : undefined,
    level: type === "heading" ? 2 : undefined,
    rows: type === "table" ? defaultTableRows() : undefined,
    chart: type === "chart" ? defaultChart() : undefined,
  };
}

function blockClipboardText(block: NoteBlock) {
  if (block.type === "toggle") return [block.label, block.text].filter(Boolean).join("\n");
  if (block.type === "field") return [block.label, block.text].filter(Boolean).join(": ");
  if (block.type === "table") return tableToMarkdown(block.rows || []);
  if (block.type === "chart") return chartToMarkdown(block.chart || defaultChart());
  return block.text;
}

function blockTypeLabel(block: NoteBlock, locale: "fr" | "en") {
  if (block.type === "field") return locale === "fr" ? "Champ" : "Field";
  if (block.type === "chart") {
    const kind = block.chart?.kind || "pie";
    if (locale === "fr") return kind === "bar" ? "Graphique en barres" : kind === "line" ? "Courbe" : "Graphique en secteurs";
    return kind === "bar" ? "Bar chart" : kind === "line" ? "Line chart" : "Pie chart";
  }
  const option = insertOptions.find((item) => item.type === block.type && (item.level || 0) === (block.level || 0));
  return option ? localizedInsertOption(option, locale).label : block.type;
}

function blockDragPreview(block: NoteBlock, locale: "fr" | "en") {
  if (block.type === "table") {
    const rows = block.rows || [];
    return `${rows.length} × ${Math.max(0, ...rows.map((row) => row.length))}`;
  }
  if (block.type === "chart") return `${block.chart?.points.length || 0} ${locale === "fr" ? "données" : "data points"}`;
  const value = [block.label, block.text].filter(Boolean).join(" — ").replace(/\s+/g, " ").trim();
  return value.slice(0, 76) || (locale === "fr" ? "Bloc vide" : "Empty block");
}

async function writeTextToClipboard(text: string) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Some browsers expose Clipboard API but refuse it outside a secure context.
  }

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  Object.assign(textarea.style, {
    position: "fixed",
    left: "-9999px",
    opacity: "0",
  });
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  previousFocus?.focus({ preventScroll: true });
  if (!copied) throw new Error("Clipboard copy failed");
}
