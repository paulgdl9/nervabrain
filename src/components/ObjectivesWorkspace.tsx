"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutList,
  Columns3,
  Plus,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  Search,
  Check,
  GripVertical,
  FileText,
  Trash2,
  X,
  Eye,
  EyeOff,
} from "lucide-react";
import Link from "next/link";
import type { VaultNote } from "@/lib/vault";
import { filterWorkspaceHistory, isWorkspaceHistory } from "@/lib/workspace-history";
import { useLanguage } from "@/components/LanguageProvider";
import { WorkspacePopover } from "@/components/WorkspacePopover";
import { useWorkspaceAppearance } from "@/components/useWorkspaceAppearance";
import type { WorkspaceAppearancePreference } from "@/lib/ui-preferences";

function editPath(relativePath: string) {
  return "/doc/" + relativePath.split("/").map(encodeURIComponent).join("/");
}

type View = "table" | "board";
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type ColKey = "name" | "status" | "area" | "horizon" | "priority";
type SortDir = "asc" | "desc";

type EditableObjective = {
  id: string;
  relativePath: string;
  title: string;
  status: string;
  area: string;
  priority: string;
  horizon: string;
  description: string;
  order: number;
  tags: string[];
  mtime: string;
};

const BASE_AREAS = ["Projects", "Work", "Learning", "Health", "Finance", "Personal", "Knowledge"];
const PRIORITIES = ["high", "medium", "low"];
const STATUSES = ["active", "paused", "achieved", "abandoned", "archived"];

// Movable columns (Name stays fixed first). Status defaults to the far right.
const DEFAULT_COLS: ColKey[] = ["area", "horizon", "priority", "status"];
const COL_WIDTH: Record<Exclude<ColKey, "name">, string> = {
  status: "118px",
  area: "152px",
  horizon: "132px",
  priority: "120px",
};
const NAME_COL_MIN = 180;
const NAME_COL_MAX = 920;
const NAME_COL_STORAGE_KEY = "obj-name-width";
// Same hues as the dashboard home. Tags pass only the hue via `--tag`;
// CSS derives the translucent fill/border (and the row-hover intensify) from it.
const ORANGE = "#f97316";
const AMBER = "#f59e0b";
const GREEN = "#40c06d"; // dashboard green
const BLUE = "#4d9bff";
const PURPLE = "#a855f7";
const PINK = "#ec4899";
const RED = "#ef4444";
const GRAY = "#9b9a97";

const AREA_HUE: Record<string, string> = {
  business: ORANGE,
  knowledge: GREEN,
  sport: RED,
  finance: GREEN,
  personal: PURPLE,
  career: PINK,
  projects: BLUE,
  work: AMBER,
  learning: GREEN,
  health: GREEN,
};

const PRI_HUE: Record<string, string> = { high: RED, medium: ORANGE, low: BLUE };

const STATUS_HUE: Record<string, string> = { active: BLUE, achieved: GREEN, completed: GREEN, paused: ORANGE, abandoned: RED, archived: GRAY };

// Predefined swatches the user can assign to an area.
const PALETTE: string[] = [GRAY, RED, ORANGE, AMBER, GREEN, "#2ad4c8", BLUE, PURPLE, PINK, "#8d6e63"];

function areaHue(area: string) {
  return AREA_HUE[area.toLowerCase().replace(/\s+/g, "")] ?? GRAY;
}

function priHue(priority: string) {
  return PRI_HUE[priority.toLowerCase()] ?? GRAY;
}

function statusHue(status: string) {
  return STATUS_HUE[status.toLowerCase()] ?? GRAY;
}

function tagVar(hue: string) {
  return { "--tag": hue } as React.CSSProperties;
}

function sf(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function toEditable(note: VaultNote, index: number): EditableObjective {
  const rawOrder = note.data.order;
  const num = typeof rawOrder === "number" ? rawOrder : Number(rawOrder);
  return {
    id: note.id,
    relativePath: note.relativePath,
    title: note.title,
    status: note.status || "active",
    area: sf(note.data.area),
    priority: sf(note.data.priority).toLowerCase(),
    horizon: sf(note.data.horizon),
    description: note.content,
    order: Number.isFinite(num) ? num : (index + 1) * 100,
    tags: note.tags,
    mtime: note.mtime,
  };
}

function AreaTag({ area, hue }: { area: string; hue?: string }) {
  const { t } = useLanguage();
  if (!area) return <span className="obj-tag obj-tag-empty">+ {t("workspace.area")}</span>;
  return (
    <span className="obj-tag" style={tagVar(hue ?? areaHue(area))}>
      {area}
    </span>
  );
}

function PriTag({ priority }: { priority: string }) {
  const { t, valueLabel } = useLanguage();
  if (!priority) return <span className="obj-tag obj-tag-empty">+ {t("workspace.priority")}</span>;
  return (
    <span className="obj-tag" style={tagVar(priHue(priority))}>
      {valueLabel(priority)}
    </span>
  );
}

function StatusTag({ status }: { status: string }) {
  const { t, valueLabel } = useLanguage();
  if (!status) return <span className="obj-tag obj-tag-empty">+ {t("workspace.status")}</span>;
  return (
    <span className="obj-tag" style={tagVar(statusHue(status))}>
      {valueLabel(status)}
    </span>
  );
}

export function ObjectivesWorkspace({ objectives, initialAppearance }: { objectives: VaultNote[]; initialAppearance: WorkspaceAppearancePreference | null }) {
  const { t, valueLabel } = useLanguage();
  const [items, setItems] = useState<EditableObjective[]>(() => objectives.map(toEditable));
  const [view, setView] = useState<View>("table");
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [filterAreas, setFilterAreas] = useState<Set<string>>(new Set());
  const [filterPris, setFilterPris] = useState<Set<string>>(new Set());
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set());
  const [sortCol, setSortCol] = useState<ColKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [openPanel, setOpenPanel] = useState<"filter" | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: keyof EditableObjective } | null>(null);
  const [dragId, setDragId] = useState("");
  const [overId, setOverId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [colOrder, setColOrder] = useState<ColKey[]>(DEFAULT_COLS);
  const [colDrag, setColDrag] = useState<ColKey | "">("");
  const [colOver, setColOver] = useState<ColKey | "">("");
  const [nameWidth, setNameWidth] = useState<number | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const nameHeadRef = useRef<HTMLDivElement>(null);
  const nameWidthRef = useRef<number | null>(null);

  function toggleEditor(event: React.MouseEvent<HTMLButtonElement>, id: string, field: keyof EditableObjective) {
    setPopoverAnchor(event.currentTarget);
    setEditing((current) => current?.id === id && current.field === field ? null : { id, field });
  }

  useEffect(() => {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(NAME_COL_STORAGE_KEY) : null;
    if (v) {
      const n = Number(v);
      if (n > 0) {
        const clamped = Math.min(NAME_COL_MAX, Math.max(NAME_COL_MIN, Math.round(n)));
        nameWidthRef.current = clamped;
        queueMicrotask(() => setNameWidth(clamped));
      }
    }
  }, []);
  const { preference: workspaceAppearance, update: updateWorkspaceAppearance } = useWorkspaceAppearance(initialAppearance);
  const { customAreas, hiddenAreas, areaColors } = workspaceAppearance;
  const [newArea, setNewArea] = useState("");
  const [addingArea, setAddingArea] = useState(false);
  const [colorEditArea, setColorEditArea] = useState("");

  useEffect(() => {
    try {
      const c = localStorage.getItem("obj-col-order");
      let nextColOrder: ColKey[] | null = null;
      if (c) {
        const parsed = JSON.parse(c) as ColKey[];
        const clean = parsed.filter((k) => DEFAULT_COLS.includes(k));
        if (clean.length) nextColOrder = [...clean, ...DEFAULT_COLS.filter((k) => !clean.includes(k))];
      }
      queueMicrotask(() => {
        if (nextColOrder) setColOrder(nextColOrder);
      });
    } catch {}
  }, []);

  function resolveArea(a: string) {
    return areaColors[a] ?? AREA_HUE[a.toLowerCase().replace(/\s+/g, "")] ?? GRAY;
  }

  function setAreaColor(a: string, hex: string) {
    updateWorkspaceAppearance((current) => ({ ...current, areaColors: { ...current.areaColors, [a]: hex } }));
  }

  function persistCols(next: ColKey[]) {
    setColOrder(next);
    try { localStorage.setItem("obj-col-order", JSON.stringify(next)); } catch {}
  }

  function addArea(raw: string) {
    const name = raw.trim();
    if (!name) return;
    updateWorkspaceAppearance((current) => ({
      ...current,
      hiddenAreas: current.hiddenAreas.filter((x) => x.toLowerCase() !== name.toLowerCase()),
      customAreas: current.customAreas.some((x) => x.toLowerCase() === name.toLowerCase())
        ? current.customAreas
        : [...current.customAreas, name],
    }));
  }

  function deleteArea(name: string) {
    updateWorkspaceAppearance((current) => ({
      ...current,
      customAreas: current.customAreas.filter((x) => x !== name),
      hiddenAreas: current.hiddenAreas.includes(name) ? current.hiddenAreas : [...current.hiddenAreas, name],
    }));
    for (const it of itemsRef.current) {
      if (it.area === name) commit(it.id, { area: "" }, true);
    }
  }

  function moveCol(target: ColKey) {
    if (!colDrag || colDrag === target) { setColDrag(""); setColOver(""); return; }
    const next = colOrder.filter((c) => c !== colDrag);
    const idx = next.indexOf(target);
    next.splice(idx, 0, colDrag);
    persistCols(next);
    setColDrag(""); setColOver("");
  }

  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; });
  const saveStatesRef = useRef(saveStates);
  useEffect(() => { saveStatesRef.current = saveStates; });
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveVersions = useRef(new Map<string, number>());
  const saveChains = useRef(new Map<string, Promise<void>>());
  const serverMtimes = useRef(new Map(objectives.map((note) => [note.id, note.mtime])));
  const saveRef = useRef<(o: EditableObjective, v?: number) => Promise<void>>(async () => undefined);

  const areaOptions = useMemo(() => {
    const hidden = new Set(hiddenAreas.map((h) => h.toLowerCase()));
    const set = new Set<string>();
    for (const a of [...BASE_AREAS, ...customAreas, ...items.map((it) => it.area)]) {
      if (a && !hidden.has(a.toLowerCase())) set.add(a);
    }
    return [...set];
  }, [items, customAreas, hiddenAreas]);

  function startNameResize(startX: number) {
    const startW = nameWidthRef.current ?? nameHeadRef.current?.offsetWidth ?? 320;
    document.body.classList.add("is-col-resizing");
    function onMove(ev: PointerEvent) {
      const w = Math.min(NAME_COL_MAX, Math.max(NAME_COL_MIN, Math.round(startW + ev.clientX - startX)));
      nameWidthRef.current = w;
      setNameWidth(w);
    }
    function onUp() {
      document.body.classList.remove("is-col-resizing");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (nameWidthRef.current) window.localStorage.setItem(NAME_COL_STORAGE_KEY, String(nameWidthRef.current));
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
  }

  function resetNameWidth() {
    nameWidthRef.current = null;
    setNameWidth(null);
    window.localStorage.removeItem(NAME_COL_STORAGE_KEY);
  }

  const gridTemplate = useMemo(
    () => `26px ${nameWidth ? `${nameWidth}px` : `minmax(${NAME_COL_MIN}px, 1fr)`} ${colOrder.map((c) => COL_WIDTH[c as Exclude<ColKey, "name">]).join(" ")} 34px`,
    [colOrder, nameWidth],
  );

  function setState(id: string, s: SaveState) {
    const next = { ...saveStatesRef.current, [id]: s };
    saveStatesRef.current = next;
    setSaveStates(next);
  }

  const saveObjective = useCallback(async (o: EditableObjective, version = saveVersions.current.get(o.id) || 0) => {
    const timer = saveTimers.current.get(o.id);
    if (timer) clearTimeout(timer);
    saveTimers.current.delete(o.id);
    const previous = saveChains.current.get(o.id) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      setState(o.id, "saving");
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          action: "update",
          path: o.relativePath,
          title: o.title || "Untitled",
          content: o.description,
          status: o.status || "active",
          tags: o.tags,
          area: o.area,
          priority: o.priority,
          horizon: o.horizon,
          order: o.order,
          expectedMtime: serverMtimes.current.get(o.id) || o.mtime,
        }),
      });
      if (!res.ok) {
        if (version === (saveVersions.current.get(o.id) || 0)) setState(o.id, "error");
        return;
      }
      const body = (await res.json()) as { note?: VaultNote };
      if (body.note) serverMtimes.current.set(o.id, body.note.mtime);
      if (body.note && version === (saveVersions.current.get(o.id) || 0)) {
        const saved = body.note;
        setItems((cur) => cur.map((it) => (it.id === o.id ? {
          ...it,
          relativePath: saved.relativePath,
          mtime: saved.mtime,
        } : it)));
        setState(o.id, "saved");
      }
    }).catch(() => {
      if (version === (saveVersions.current.get(o.id) || 0)) setState(o.id, "error");
    });
    saveChains.current.set(o.id, operation);
    await operation;
    if (saveChains.current.get(o.id) === operation) saveChains.current.delete(o.id);
  }, []);

  useEffect(() => { saveRef.current = saveObjective; });

  const commit = useCallback((id: string, patch: Partial<EditableObjective>, immediate = false) => {
    const version = (saveVersions.current.get(id) || 0) + 1;
    saveVersions.current.set(id, version);
    let next: EditableObjective | undefined;
    setItems((cur) => cur.map((it) => {
      if (it.id !== id) return it;
      next = { ...it, ...patch };
      return next;
    }));
    setState(id, "dirty");
    const prev = saveTimers.current.get(id);
    if (prev) clearTimeout(prev);
    const run = () => { if (next) saveRef.current(next, version); };
    if (immediate) run();
    else saveTimers.current.set(id, setTimeout(run, 520));
  }, []);

  useEffect(() => {
    const timers = saveTimers.current;
    const flushDirty = () => {
      for (const item of itemsRef.current) {
        if ((saveStatesRef.current[item.id] || "idle") === "dirty") void saveRef.current(item);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushDirty();
    };
    window.addEventListener("pagehide", flushDirty);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      flushDirty();
      window.removeEventListener("pagehide", flushDirty);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const historyCount = useMemo(() => items.filter((item) => isWorkspaceHistory("objective", item.status)).length, [items]);
  const includeHistory = showHistory || [...filterStatuses].some((status) => isWorkspaceHistory("objective", status));

  const visible = useMemo(() => {
    let list = filterWorkspaceHistory("objective", items, includeHistory);
    if (filterAreas.size) list = list.filter((it) => filterAreas.has(it.area));
    if (filterPris.size) list = list.filter((it) => filterPris.has(it.priority || "none"));
    if (filterStatuses.size) list = list.filter((it) => filterStatuses.has(it.status));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((it) => (it.title + " " + it.description).toLowerCase().includes(q));
    if (!sortCol) {
      list.sort((a, b) => a.order - b.order);
    } else {
      const dir = sortDir === "asc" ? 1 : -1;
      const w: Record<string, number> = { high: 0, medium: 1, low: 2 };
      list.sort((a, b) => {
        let c = 0;
        if (sortCol === "name") c = a.title.localeCompare(b.title);
        else if (sortCol === "status") c = a.status.localeCompare(b.status);
        else if (sortCol === "area") c = a.area.localeCompare(b.area);
        else if (sortCol === "horizon") c = a.horizon.localeCompare(b.horizon);
        else c = (w[a.priority] ?? 3) - (w[b.priority] ?? 3);
        return c * dir || a.order - b.order;
      });
    }
    return list;
  }, [items, includeHistory, filterAreas, filterPris, filterStatuses, query, sortCol, sortDir]);

  function onSortClick(col: ColKey) {
    if (sortCol !== col) { setSortCol(col); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortCol(null); setSortDir("asc"); }
  }

  async function createObjective() {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-objective", title: t("workspace.newObjective"), priority: "medium" }),
    });
    if (!res.ok) return;
    const body = (await res.json()) as { note?: VaultNote };
    if (!body.note) return;
    const minOrder = items.reduce((m, it) => Math.min(m, it.order), 0);
    const fresh = { ...toEditable(body.note, 0), order: minOrder - 100, status: "active", priority: "medium" };
    setItems((cur) => [fresh, ...cur]);
    setSortCol(null);
    setEditing({ id: fresh.id, field: "title" });
    saveRef.current(fresh, (saveVersions.current.get(fresh.id) || 0));
  }

  async function deleteObjective(id: string) {
    const it = itemsRef.current.find((o) => o.id === id);
    setConfirmDelete(null);
    if (!it) return;
    const timer = saveTimers.current.get(id);
    if (timer) clearTimeout(timer);
    saveTimers.current.delete(id);
    await saveChains.current.get(id)?.catch(() => undefined);
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ action: "delete", path: it.relativePath }),
    });
    if (!response.ok) {
      setState(id, "error");
      return;
    }
    setItems((cur) => cur.filter((o) => o.id !== id));
  }

  function onDrop(targetId: string) {
    setOverId("");
    const from = dragId;
    setDragId("");
    if (!from || from === targetId) return;
    const ordered = [...items].sort((a, b) => a.order - b.order);
    const fromIdx = ordered.findIndex((it) => it.id === from);
    const toIdx = ordered.findIndex((it) => it.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    const reindexed = ordered.map((it, i) => ({ ...it, order: (i + 1) * 100 }));
    setItems(reindexed);
    setSortCol(null);
    const byId = new Map(items.map((it) => [it.id, it.order]));
    for (const it of reindexed) {
      if (byId.get(it.id) !== it.order) commit(it.id, { order: it.order }, true);
    }
  }

  function cellFor(it: EditableObjective, col: ColKey) {
    const isEditing = editing?.id === it.id && editing.field === col;
    if (col === "status") {
      return (
        <>
          {isEditing && (
            <WorkspacePopover anchor={popoverAnchor} onClose={() => setEditing(null)}>
              <div className="obj-pop-chips">
                {STATUSES.map((st) => (
                  <button key={st} type="button" className={`obj-pop-chip${it.status === st ? " is-on" : ""}`}
                    onClick={() => { commit(it.id, { status: st }); setEditing(null); }}>
                    {valueLabel(st)}
                  </button>
                ))}
              </div>
            </WorkspacePopover>
          )}
          <button type="button" className="obj-tag-btn" aria-expanded={isEditing} aria-haspopup="dialog" onClick={(event) => toggleEditor(event, it.id, "status")}>
            <StatusTag status={it.status} />
          </button>
        </>
      );
    }
    if (col === "area") {
      return (
        <>
          {isEditing && (
            <WorkspacePopover anchor={popoverAnchor} onClose={() => { setEditing(null); setNewArea(""); setAddingArea(false); setColorEditArea(""); }}>
              <div className="obj-pop-chips">
                {areaOptions.map((a) => (
                  <span key={a} className={`obj-pop-chip-wrap${it.area === a ? " is-on" : ""}`} style={tagVar(resolveArea(a))}>
                    <button type="button" className="obj-pop-dot" title={t("workspace.changeColor")} style={{ background: resolveArea(a) }}
                      onClick={(e) => { e.stopPropagation(); setColorEditArea(colorEditArea === a ? "" : a); }} />
                    <button type="button" className="obj-pop-chip" onClick={() => { commit(it.id, { area: it.area === a ? "" : a }); setEditing(null); }}>
                      {a}
                    </button>
                    <button type="button" className="obj-pop-chip-del" title={t("workspace.removeArea")} onClick={() => { deleteArea(a); if (it.area === a) commit(it.id, { area: "" }); }}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {addingArea ? (
                  <input
                    autoFocus
                    className="obj-pop-add-input"
                    size={Math.max(2, newArea.length)}
                    value={newArea}
                    placeholder={t("workspace.newArea")}
                    onChange={(e) => setNewArea(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); const v = newArea.trim(); if (v) { addArea(v); commit(it.id, { area: v }); } setNewArea(""); setAddingArea(false); setEditing(null); }
                      else if (e.key === "Escape") { e.preventDefault(); setNewArea(""); setAddingArea(false); }
                    }}
                    onBlur={() => { const v = newArea.trim(); if (v) { addArea(v); commit(it.id, { area: v }); } setNewArea(""); setAddingArea(false); }}
                  />
                ) : (
                  <button type="button" className="obj-pop-add" title={t("workspace.newArea")} onClick={() => { setNewArea(""); setAddingArea(true); }}>
                    <Plus size={12} />
                  </button>
                )}
              </div>
              {colorEditArea && (
                <div className="obj-pop-swatches">
                  {PALETTE.map((hex) => (
                    <button key={hex} type="button" className={`obj-swatch${resolveArea(colorEditArea) === hex ? " is-on" : ""}`}
                      style={{ background: hex }} title={hex}
                      onClick={() => { setAreaColor(colorEditArea, hex); setColorEditArea(""); }} />
                  ))}
                </div>
              )}
            </WorkspacePopover>
          )}
          <button type="button" className="obj-tag-btn" aria-expanded={isEditing} aria-haspopup="dialog" onClick={(event) => toggleEditor(event, it.id, "area")}>
            <AreaTag area={it.area} hue={resolveArea(it.area)} />
          </button>
        </>
      );
    }
    if (col === "horizon") {
      return isEditing ? (
        <input
          autoFocus
          className="obj-cell-input"
          value={it.horizon}
          placeholder="Now, Q3…"
          onChange={(e) => commit(it.id, { horizon: e.target.value })}
          onBlur={() => setEditing(null)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setEditing(null); } }}
        />
      ) : (
        <button type="button" className="obj-horizon-btn" onClick={() => setEditing({ id: it.id, field: "horizon" })}>
          {it.horizon || <span className="obj-placeholder">+ {t("workspace.horizon")}</span>}
        </button>
      );
    }
    return (
      <>
        {isEditing && (
          <WorkspacePopover anchor={popoverAnchor} onClose={() => setEditing(null)}>
            <div className="obj-pop-chips">
              {PRIORITIES.map((p) => (
                <button key={p} type="button" className={`obj-pop-chip${it.priority === p ? " is-on" : ""}`}
                  onClick={() => { commit(it.id, { priority: it.priority === p ? "" : p }); setEditing(null); }}>
                  {valueLabel(p)}
                </button>
              ))}
            </div>
          </WorkspacePopover>
        )}
        <button type="button" className="obj-tag-btn" aria-expanded={isEditing} aria-haspopup="dialog" onClick={(event) => toggleEditor(event, it.id, "priority")}>
          <PriTag priority={it.priority} />
        </button>
      </>
    );
  }

  const dirty = Object.values(saveStates).some((s) => s === "saving" || s === "dirty");

  return (
    <div className="obj-workspace">
      <div className="obj-toolbar">
        <div className="obj-view-tabs">
          <button type="button" className={`obj-view-tab${view === "table" ? " is-active" : ""}`} onClick={() => setView("table")}>
            <LayoutList size={14} />
            {t("workspace.table")}
          </button>
          <button type="button" className={`obj-view-tab${view === "board" ? " is-active" : ""}`} onClick={() => setView("board")}>
            <Columns3 size={14} />
            {t("workspace.board")}
          </button>
        </div>
        <div className="obj-toolbar-right">
          {historyCount > 0 && (
            <button
              type="button"
              className={`obj-toolbar-btn${showHistory ? " is-on" : ""}`}
              aria-pressed={showHistory}
              onClick={() => setShowHistory((shown) => !shown)}
            >
              {showHistory ? <EyeOff size={13} /> : <Eye size={13} />}
              {t(showHistory ? "workspace.hideHistory" : "workspace.showHistory")} · {historyCount}
            </button>
          )}
          <span className={`obj-save-pill obj-save-${dirty ? "saving" : "saved"}`}>{dirty ? t("workspace.saving") : t("workspace.saved")}</span>
          <div className="obj-pop-anchor">
            <button type="button" className={`obj-toolbar-btn${filterAreas.size || filterPris.size || filterStatuses.size ? " is-on" : ""}`} aria-expanded={openPanel === "filter"} aria-haspopup="dialog" onClick={(event) => { setPopoverAnchor(event.currentTarget); setOpenPanel(openPanel === "filter" ? null : "filter"); }}>
              <SlidersHorizontal size={13} />
              {t("workspace.filter")}{filterAreas.size + filterPris.size + filterStatuses.size ? ` · ${filterAreas.size + filterPris.size + filterStatuses.size}` : ""}
            </button>
            {openPanel === "filter" && (
              <WorkspacePopover anchor={popoverAnchor} onClose={() => setOpenPanel(null)}>
                <div className="obj-pop-title">{t("workspace.status")}</div>
                <div className="obj-pop-chips">
                  {STATUSES.map((st) => (
                    <button key={st} type="button" className={`obj-pop-chip${filterStatuses.has(st) ? " is-on" : ""}`}
                      onClick={() => setFilterStatuses((s) => { const n = new Set(s); if (n.has(st)) n.delete(st); else n.add(st); return n; })}>
                      {filterStatuses.has(st) && <Check size={11} />}{valueLabel(st)}
                    </button>
                  ))}
                </div>
                <div className="obj-pop-title">{t("workspace.area")}</div>
                <div className="obj-pop-chips">
                  {areaOptions.map((a) => (
                    <button key={a} type="button" className={`obj-pop-chip${filterAreas.has(a) ? " is-on" : ""}`}
                      onClick={() => setFilterAreas((p) => { const n = new Set(p); if (n.has(a)) n.delete(a); else n.add(a); return n; })}>
                      {filterAreas.has(a) && <Check size={11} />}{a}
                    </button>
                  ))}
                </div>
                <div className="obj-pop-title">{t("workspace.priority")}</div>
                <div className="obj-pop-chips">
                  {PRIORITIES.map((p) => (
                    <button key={p} type="button" className={`obj-pop-chip${filterPris.has(p) ? " is-on" : ""}`}
                      onClick={() => setFilterPris((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; })}>
                      {filterPris.has(p) && <Check size={11} />}{valueLabel(p)}
                    </button>
                  ))}
                </div>
                {(filterAreas.size > 0 || filterPris.size > 0 || filterStatuses.size > 0) && (
                  <button type="button" className="obj-pop-clear" onClick={() => { setFilterAreas(new Set()); setFilterPris(new Set()); setFilterStatuses(new Set()); }}>
                    {t("workspace.clearAll")}
                  </button>
                )}
              </WorkspacePopover>
            )}
          </div>
          {searchOpen ? (
            <input autoFocus className="obj-search-input" placeholder={t("workspace.search")} value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => { if (!query) setSearchOpen(false); }} />
          ) : (
            <button type="button" className="obj-toolbar-btn obj-toolbar-icon" onClick={() => setSearchOpen(true)}>
              <Search size={13} />
            </button>
          )}
          <button type="button" className="obj-new-btn" onClick={createObjective}>
            <Plus size={14} />
            {t("workspace.new")}
          </button>
        </div>
      </div>

      {view === "table" ? (
        <div className="obj-table-shell">
          <div className="obj-grid obj-grid-head" style={{ gridTemplateColumns: gridTemplate }}>
            <span />
            <div className="obj-th-name-wrap" ref={nameHeadRef}>
              <SortHeader label={t("workspace.name")} col="name" sortCol={sortCol} sortDir={sortDir} onClick={onSortClick} className="obj-th-name" />
              <span
                className="obj-col-resizer"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); startNameResize(e.clientX); }}
                onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); resetNameWidth(); }}
                title={t("workspace.resizeColumn")}
              />
            </div>
            {colOrder.map((col) => (
              <div
                key={col}
                className={`obj-colhead${colOver === col ? " is-colover" : ""}${colDrag === col ? " is-coldrag" : ""}`}
                draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setColDrag(col); }}
                onDragEnd={() => { setColDrag(""); setColOver(""); }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (colDrag && colOver !== col) setColOver(col); }}
                onDrop={() => moveCol(col)}
                title={t("workspace.dragColumn")}
              >
                <GripVertical size={12} className="obj-colhead-grip" />
                <SortHeader label={t(col === "status" ? "workspace.status" : col === "area" ? "workspace.area" : col === "horizon" ? "workspace.horizon" : "workspace.priority")} col={col} sortCol={sortCol} sortDir={sortDir} onClick={onSortClick} />
              </div>
            ))}
            <span />
          </div>
          {visible.map((it) => {
            const lastCol = colOrder[colOrder.length - 1];
            return (
              <div
                key={it.id}
                className={`obj-rowgroup${dragId === it.id ? " is-dragging" : ""}${overId === it.id ? " is-over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragId && overId !== it.id) setOverId(it.id); }}
                onDrop={() => onDrop(it.id)}
              >
                <div className="obj-grid obj-row" style={{ gridTemplateColumns: gridTemplate }}>
                  <span
                    className="obj-drag"
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(it.id); }}
                    onDragEnd={() => { setDragId(""); setOverId(""); }}
                    title={t("workspace.dragRow")}
                  >
                    <GripVertical size={14} />
                  </span>
                  <div className="obj-name-cell">
                    <Link href={editPath(it.relativePath)} className="obj-open-page" title={t("workspace.openPage")}>
                      <FileText size={15} />
                    </Link>
                    {editing?.id === it.id && editing.field === "title" ? (
                      <input
                        autoFocus
                        className="obj-cell-input obj-title-input"
                        value={it.title}
                        onChange={(e) => commit(it.id, { title: e.target.value })}
                        onBlur={() => setEditing(null)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setEditing(null); } }}
                      />
                    ) : (
                      <button type="button" className="obj-title-btn" onClick={() => setEditing({ id: it.id, field: "title" })}>
                        {it.title || <span className="obj-placeholder">{t("workspace.untitled")}</span>}
                      </button>
                    )}
                  </div>

                  {colOrder.map((col) => (
                    <div
                      key={col}
                      className={`obj-cell${col === lastCol ? " obj-cell-end" : ""}`}
                      data-label={t(col === "status" ? "workspace.status" : col === "area" ? "workspace.area" : col === "horizon" ? "workspace.horizon" : "workspace.priority")}
                    >
                      {cellFor(it, col)}
                    </div>
                  ))}

                  <button type="button" className="obj-row-del" onClick={() => setConfirmDelete(it.id)} title={t("workspace.deleteObjective")}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
          {!visible.length && <div className="obj-empty">{t("workspace.noObjectives")}</div>}
        </div>
      ) : (
        <BoardView
          items={visible}
          onPriority={(id, p) => commit(id, { priority: p })}
          onStatus={(id, s) => commit(id, { status: s })}
          areaColor={resolveArea}
          includeHistory={includeHistory}
        />
      )}

      {confirmDelete && (() => {
        const it = items.find((o) => o.id === confirmDelete);
        return (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmDelete(null)}>
            <div className="modal-dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-icon"><Trash2 size={18} /></div>
              <h3>{t("workspace.deleteObjective")}</h3>
              <p className="muted">{t("workspace.deleteConfirm").replace("{title}", it?.title || t("workspace.untitled"))}</p>
              <div className="modal-actions">
                <button type="button" className="button" onClick={() => setConfirmDelete(null)}>{t("workspace.cancel")}</button>
                <button type="button" className="button danger" onClick={() => deleteObjective(confirmDelete)}>{t("workspace.delete")}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SortHeader({ label, col, sortCol, sortDir, onClick, className }: {
  label: string;
  col: ColKey;
  sortCol: ColKey | null;
  sortDir: SortDir;
  onClick: (col: ColKey) => void;
  className?: string;
}) {
  const active = sortCol === col;
  return (
    <button type="button" className={`obj-sort-header${active ? " is-active" : ""} ${className || ""}`} onClick={() => onClick(col)}>
      {label}
      {active && (sortDir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
    </button>
  );
}

function BoardView({ items, onPriority, onStatus, areaColor, includeHistory }: {
  areaColor: (a: string) => string;
  items: EditableObjective[];
  onPriority: (id: string, p: string) => void;
  onStatus: (id: string, s: string) => void;
  includeHistory: boolean;
}) {
  const { t, valueLabel } = useLanguage();
  const [group, setGroup] = useState<"status" | "priority">("status");
  const [dragId, setDragId] = useState("");
  const [overCol, setOverCol] = useState("");

  const cols = group === "status"
    ? [...new Set([...STATUSES, ...items.map((item) => item.status)])]
        .filter((status) => includeHistory || !isWorkspaceHistory("objective", status))
        .map((s) => ({ key: s, label: valueLabel(s), hue: STATUS_HUE[s] ?? GRAY }))
    : [
        { key: "high", label: valueLabel("high"), hue: priHue("high") },
        { key: "medium", label: valueLabel("medium"), hue: priHue("medium") },
        { key: "low", label: valueLabel("low"), hue: priHue("low") },
        { key: "none", label: t("workspace.noPriority"), hue: GRAY },
      ];

  function valueOf(it: EditableObjective) {
    return group === "status" ? (it.status || "active") : (it.priority || "none");
  }

  function apply(id: string, key: string) {
    if (group === "status") onStatus(id, key);
    else onPriority(id, key === "none" ? "" : key);
  }

  return (
    <>
      <div className="obj-board-bar">
        <div className="obj-view-tabs obj-board-toggle">
          <button type="button" className={`obj-view-tab${group === "status" ? " is-active" : ""}`} onClick={() => setGroup("status")}>{t("workspace.status")}</button>
          <button type="button" className={`obj-view-tab${group === "priority" ? " is-active" : ""}`} onClick={() => setGroup("priority")}>{t("workspace.priority")}</button>
        </div>
      </div>
      <div className="obj-board">
        {cols.map((col) => {
          const list = items.filter((it) => valueOf(it) === col.key);
          if (group === "priority" && col.key === "none" && !list.length && dragId === "") return null;
          const hue = col.hue;
          return (
            <div
              key={col.key}
              className={`obj-col${overCol === col.key ? " is-drop" : ""}`}
              style={{ background: hue + "12", borderColor: overCol === col.key ? hue + "88" : undefined }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overCol !== col.key) setOverCol(col.key); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol(""); }}
              onDrop={() => { if (dragId) apply(dragId, col.key); setDragId(""); setOverCol(""); }}
            >
              <div className="obj-col-header">
                <span className="obj-col-badge" style={tagVar(hue)}>{col.label}</span>
                <span className="obj-col-count">{list.length}</span>
              </div>
              <div className="obj-card-list">
                {list.map((it) => (
                  <Link
                    key={it.id}
                    href={editPath(it.relativePath)}
                    className={`obj-card${dragId === it.id ? " is-dragging" : ""}`}
                    draggable
                    onDragStart={(e) => { setDragId(it.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragId(""); setOverCol(""); }}
                  >
                    <div className="obj-card-title">{it.title || t("workspace.untitled")}</div>
                    {it.area && <div className="obj-card-footer"><AreaTag area={it.area} hue={areaColor(it.area)} /></div>}
                  </Link>
                ))}
                {!list.length && <div className="obj-col-empty">{t("workspace.dropHere")}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
