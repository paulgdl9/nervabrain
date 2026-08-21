"use client";

import {
  BrainCircuit,
  CalendarCheck2,
  ChartNoAxesColumnIncreasing,
  Eye,
  EyeOff,
  GripVertical,
  Inbox,
  ListChecks,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import {
  DASHBOARD_WIDGET_IDS,
  type DashboardWidgetId,
} from "@/lib/dashboard-modules";
import type { DashboardLayoutPreference } from "@/lib/ui-preferences";
export type DashboardWidgetSize = "standard" | "wide";
export type DashboardWidget = {
  id: DashboardWidgetId;
  title: string;
  description: string;
  href?: string;
  preview: ReactNode;
  size?: DashboardWidgetSize;
  visual?: "hero" | "focus" | "landscape" | "compact" | "module";
  /** @deprecated Use `size: "wide"` for new widgets. */
  wide?: boolean;
  content: ReactNode;
};

type CustomBlockKind = "text" | "metric" | "progress" | "links";
type CustomBlock = {
  id: string;
  kind: CustomBlockKind;
  title: string;
  body: string;
  value: string;
};
export type DashboardState = {
  order: string[];
  hidden: string[];
  custom: CustomBlock[];
  sizes: Record<string, DashboardWidgetSize>;
};

const STORAGE_KEY = "sb-dashboard-layout:v7";
const DEFAULT_STATE: DashboardState = {
  order: [...DASHBOARD_WIDGET_IDS],
  hidden: [],
  custom: [],
  sizes: {},
};

const WIDGET_ICONS: Partial<Record<DashboardWidgetId, ReactNode>> = {
  today: <CalendarCheck2 size={19} aria-hidden />,
  brief: <BrainCircuit size={19} aria-hidden />,
  objectives: <Target size={19} aria-hidden />,
  projects: <Target size={19} aria-hidden />,
  activity: <ChartNoAxesColumnIncreasing size={19} aria-hidden />,
  areas: <Inbox size={19} aria-hidden />,
};

function widgetIcon(id: DashboardWidgetId) {
  if (WIDGET_ICONS[id]) return WIDGET_ICONS[id];
  if (id.startsWith("module:revisions")) return <ListChecks size={19} aria-hidden />;
  if (id.startsWith("module:custom")) return <Inbox size={19} aria-hidden />;
  if (id.startsWith("module:business")) return <Target size={19} aria-hidden />;
  if (id.startsWith("module:budget")) return <CalendarCheck2 size={19} aria-hidden />;
  return <ChartNoAxesColumnIncreasing size={19} aria-hidden />;
}

export function normalizeDashboardState(value: unknown): DashboardState {
  const input = value && typeof value === "object" ? value as Partial<DashboardState> : {};
  const custom = Array.isArray(input.custom)
    ? input.custom.flatMap((item): CustomBlock[] => {
        if (!item || typeof item !== "object") return [];
        const block = item as Partial<CustomBlock>;
        if (!String(block.id || "").startsWith("custom:") || !["text", "metric", "progress", "links"].includes(String(block.kind))) return [];
        return [{
          id: String(block.id),
          kind: block.kind as CustomBlockKind,
          title: String(block.title || ""),
          body: String(block.body || ""),
          value: String(block.value || ""),
        }];
      })
    : [];
  const valid = new Set<string>([...DASHBOARD_WIDGET_IDS, ...custom.map((block) => block.id)]);
  const hidden = Array.isArray(input.hidden)
    ? [...new Set(input.hidden.map(String).filter((id) => valid.has(id)))]
    : [];
  const hiddenSet = new Set(hidden);
  const order = Array.isArray(input.order)
    ? [...new Set(input.order.map(String).filter((id) => valid.has(id) && !hiddenSet.has(id)))]
    : [];
  const seen = new Set([...order, ...hidden]);
  for (const id of valid) if (!seen.has(id)) order.push(id);
  const rawSizes = input.sizes && typeof input.sizes === "object" && !Array.isArray(input.sizes)
    ? input.sizes
    : {};
  const sizes = Object.fromEntries(
    Object.entries(rawSizes).filter(([id, size]) => valid.has(id) && (size === "standard" || size === "wide")),
  ) as Record<string, DashboardWidgetSize>;
  return { order, hidden, custom, sizes };
}

export function defaultDashboardWidgetSize(widget?: Pick<DashboardWidget, "size" | "wide">): DashboardWidgetSize {
  return widget?.size || (widget?.wide ? "wide" : "standard");
}

export function dashboardWidgetSize(
  state: Pick<DashboardState, "sizes">,
  id: string,
  widget?: Pick<DashboardWidget, "size" | "wide">,
): DashboardWidgetSize {
  return state.sizes[id] || defaultDashboardWidgetSize(widget);
}

export function resizeDashboardBlock(state: DashboardState, id: string, size: DashboardWidgetSize): DashboardState {
  if (!state.order.includes(id) && !state.hidden.includes(id)) return state;
  if (state.sizes[id] === size) return state;
  return { ...state, sizes: { ...state.sizes, [id]: size } };
}

export function hideDashboardBlock(state: DashboardState, id: string): DashboardState {
  if (!state.order.includes(id)) return state;
  return { ...state, order: state.order.filter((item) => item !== id), hidden: [...new Set([...state.hidden, id])] };
}

export function restoreDashboardBlock(state: DashboardState, id: string): DashboardState {
  if (!state.hidden.includes(id)) return state;
  return { ...state, order: [...state.order, id], hidden: state.hidden.filter((item) => item !== id) };
}

export function moveDashboardBlock(state: DashboardState, id: string, targetId: string): DashboardState {
  if (!id || id === targetId) return state;
  const from = state.order.indexOf(id);
  const to = state.order.indexOf(targetId);
  if (from < 0 || to < 0) return state;
  const order = [...state.order];
  order.splice(to, 0, order.splice(from, 1)[0]);
  return { ...state, order };
}

export type DashboardDropRect = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function closestDashboardDropTarget(draggedId: string, x: number, y: number, rects: DashboardDropRect[]): string {
  const candidates = rects.filter((rect) => rect.id !== draggedId);
  const direct = candidates.find((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  if (direct) return direct.id;
  return candidates.reduce<{ id: string; distance: number } | null>((nearest, rect) => {
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    const distance = dx * dx + dy * dy;
    return !nearest || distance < nearest.distance ? { id: rect.id, distance } : nearest;
  }, null)?.id || "";
}

export function compactDashboardOrder(order: string[], spans: Readonly<Record<string, number>>, columns = 12): string[] {
  const pending = [...order];
  const packed: string[] = [];
  while (pending.length) {
    let remaining = columns;
    let placedInRow = false;
    for (let index = 0; index < pending.length;) {
      const span = Math.max(1, Math.min(columns, spans[pending[index]] || columns));
      if (span <= remaining) {
        packed.push(pending.splice(index, 1)[0]);
        remaining -= span;
        placedInRow = true;
        if (remaining === 0) break;
      } else {
        index += 1;
      }
    }
    if (!placedInRow) packed.push(pending.shift()!);
  }
  return packed;
}

export function compactDashboardStateOrder(
  state: DashboardState,
  widgets: readonly Pick<DashboardWidget, "id" | "visual" | "size" | "wide">[],
): DashboardState {
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const customIds = new Set(state.custom.map((block) => block.id));
  const visibleIds = new Set(state.order.filter((id) => byId.has(id as DashboardWidgetId) || customIds.has(id)));
  const visibleOrder = state.order.filter((id) => visibleIds.has(id));
  const spans = Object.fromEntries(visibleOrder.map((id) => {
    const widget = byId.get(id as DashboardWidgetId);
    const visual = widget?.visual || "module";
    const span = customIds.has(id)
      ? (dashboardWidgetSize(state, id, widget) === "wide" ? 12 : 6)
      : visual === "landscape" || visual === "hero"
        ? 12
        : 6;
    return [id, span];
  }));
  const packedVisible = compactDashboardOrder(visibleOrder, spans);
  let visibleIndex = 0;
  const order = state.order.map((id) => visibleIds.has(id) ? packedVisible[visibleIndex++] : id);
  return order.every((id, index) => id === state.order[index]) ? state : { ...state, order };
}

export function moveAndCompactDashboardBlock(
  state: DashboardState,
  id: string,
  targetId: string,
  widgets: readonly Pick<DashboardWidget, "id" | "visual" | "size" | "wide">[],
): DashboardState {
  return compactDashboardStateOrder(moveDashboardBlock(state, id, targetId), widgets);
}

export function dashboardAutoScrollDelta(pointerY: number, viewportHeight: number, edge = 72, maxSpeed = 18): number {
  if (pointerY < edge) return -Math.ceil((edge - Math.max(0, pointerY)) / edge * maxSpeed);
  if (pointerY > viewportHeight - edge) return Math.ceil((Math.min(viewportHeight, pointerY) - (viewportHeight - edge)) / edge * maxSpeed);
  return 0;
}

/**
 * Append connected module blocks that became available after this layout was
 * saved (e.g. a returning user, or a module just enabled), without re-adding
 * any block the user deliberately hid or reordering the ones they kept.
 */
export function reconcileAvailableModules(state: DashboardState, availableIds: readonly string[]): DashboardState {
  const known = new Set([...state.order, ...state.hidden]);
  const missing = availableIds.filter((id) => id.startsWith("module:") && !known.has(id));
  return missing.length ? { ...state, order: [...state.order, ...missing] } : state;
}

export function deletePersonalDashboardBlock(state: DashboardState, id: string): DashboardState {
  if (!state.custom.some((block) => block.id === id)) return state;
  const sizes = { ...state.sizes };
  delete sizes[id];
  return {
    ...state,
    order: state.order.filter((item) => item !== id),
    hidden: state.hidden.filter((item) => item !== id),
    custom: state.custom.filter((block) => block.id !== id),
    sizes,
  };
}

function loadState(): DashboardState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeDashboardState(raw ? JSON.parse(raw) : DEFAULT_STATE);
  } catch {
    return DEFAULT_STATE;
  }
}

function storeState(state: DashboardState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Browser storage is optional; the dashboard still works for this session.
  }
}

function persistState(state: DashboardState) {
  return fetch("/api/ui-preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ kind: "dashboard", value: state }),
  }).then(() => undefined).catch(() => undefined);
}

function linksFromBody(body: string) {
  return body.split("\n").flatMap((line) => {
    const [label, url] = line.split("|").map((part) => part.trim());
    return label && /^https?:\/\//.test(url || "") ? [{ label, url }] : [];
  });
}

function CustomBlockContent({ block }: { block: CustomBlock }) {
  if (block.kind === "metric") {
    return (
      <section className="dashboard-custom-card is-metric">
        <span>{block.title}</span>
        <strong>{block.value || "—"}</strong>
        {block.body ? <p>{block.body}</p> : null}
      </section>
    );
  }
  if (block.kind === "progress") {
    const progress = Math.max(0, Math.min(100, Number(block.value) || 0));
    return (
      <section className="dashboard-custom-card">
        <div className="dashboard-custom-head"><h2>{block.title}</h2><strong>{progress}%</strong></div>
        <div className="dashboard-custom-progress" aria-label={`${block.title}: ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
        {block.body ? <p>{block.body}</p> : null}
      </section>
    );
  }
  if (block.kind === "links") {
    return (
      <section className="dashboard-custom-card">
        <h2>{block.title}</h2>
        <div className="dashboard-custom-links">
          {linksFromBody(block.body).map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={`${link.label}:${link.url}`}>{link.label}</a>)}
        </div>
      </section>
    );
  }
  return <section className="dashboard-custom-card"><h2>{block.title}</h2><p>{block.body}</p></section>;
}

export function DashboardLayout({ widgets, initialState }: { widgets: DashboardWidget[]; initialState: DashboardLayoutPreference | null }) {
  const { t } = useLanguage();
  const router = useRouter();
  const addBlockButtonRef = useRef<HTMLButtonElement>(null);
  const catalogRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [state, setState] = useState<DashboardState>(DEFAULT_STATE);
  const [stateReady, setStateReady] = useState(false);
  const stateRef = useRef<DashboardState>(DEFAULT_STATE);
  const saveChainRef = useRef(Promise.resolve());
  const [draggedId, setDraggedId] = useState("");
  const [dropTargetId, setDropTargetId] = useState("");
  const draggedIdRef = useRef("");
  const dragTargetRef = useRef("");
  const dragOriginRef = useRef({ x: 0, y: 0, scrollY: 0 });
  const dragPointerRef = useRef({ x: 0, y: 0 });
  const autoScrollFrameRef = useRef<number | null>(null);
  const draggedElementRef = useRef<HTMLElement | null>(null);
  const byId = useMemo(() => new Map<string, DashboardWidget>(widgets.map((widget) => [widget.id, widget])), [widgets]);
  const customById = useMemo(() => new Map(state.custom.map((block) => [block.id, block])), [state.custom]);
  const hiddenWidgets = useMemo(
    () => widgets.filter((widget) => state.hidden.includes(widget.id)),
    [state.hidden, widgets],
  );
  const hiddenCustomBlocks = useMemo(
    () => state.custom.filter((block) => state.hidden.includes(block.id)),
    [state.custom, state.hidden],
  );
  useLayoutEffect(() => {
    // The vault is authoritative once it contains a layout. On the first run
    // after this migration, promote the browser-only v7 layout into the vault.
    const stored = initialState === null ? loadState() : normalizeDashboardState(initialState);
    // A returning user's saved order predates any newly-available connected
    // module block; surface the new ones without a manual re-add.
    const reconciled = compactDashboardStateOrder(
      reconcileAvailableModules(stored, widgets.map((widget) => widget.id)),
      widgets,
    );
    stateRef.current = reconciled;
    // This is deliberately a layout effect: revealing the server-default
    // order for one frame is the visual flash this synchronization prevents.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(reconciled);
    setStateReady(true);
    storeState(reconciled);
    if (initialState === null || reconciled !== stored) {
      saveChainRef.current = saveChainRef.current.then(() => persistState(reconciled));
    }
  }, [initialState, widgets]);

  useEffect(() => {
    if (!catalogOpen) return;
    const catalog = catalogRef.current;
    const focusable = catalog
      ? [...catalog.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])")]
      : [];
    focusable[0]?.focus();

    function keepFocusInCatalog(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        closeCatalog();
        return;
      }
      if (event.key !== "Tab" || !focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keepFocusInCatalog);
    return () => document.removeEventListener("keydown", keepFocusInCatalog);
  }, [catalogOpen]);

  function update(next: DashboardState) {
    stateRef.current = next;
    setState(next);
    storeState(next);
    // Serialize writes so rapid drag events and custom-field edits cannot let
    // an older request finish after the newest layout.
    saveChainRef.current = saveChainRef.current.then(() => persistState(next));
  }

  function closeCatalog() {
    setCatalogOpen(false);
    requestAnimationFrame(() => addBlockButtonRef.current?.focus());
  }

  function reorder(id: string, targetId: string) {
    const current = stateRef.current;
    const next = moveAndCompactDashboardBlock(current, id, targetId, widgets);
    if (next !== current) update(next);
  }

  function moveByKeyboard(id: string, direction: -1 | 1) {
    const current = stateRef.current;
    const visibleOrder = current.order.filter((item) => byId.has(item) || customById.has(item));
    const index = visibleOrder.indexOf(id);
    const target = visibleOrder[index + direction];
    if (target) reorder(id, target);
  }

  function hide(id: string) {
    update(compactDashboardStateOrder(hideDashboardBlock(stateRef.current, id), widgets));
  }

  function show(id: string) {
    update(compactDashboardStateOrder(restoreDashboardBlock(stateRef.current, id), widgets));
    closeCatalog();
  }

  function editCustom(id: string, patch: Partial<CustomBlock>) {
    update({ ...state, custom: state.custom.map((block) => block.id === id ? { ...block, ...patch, id: block.id, kind: block.kind } : block) });
  }

  function deleteCustom(id: string) {
    if (!window.confirm(t("trash.confirm").replace("{title}", titleFor(id)))) return;
    update(compactDashboardStateOrder(deletePersonalDashboardBlock(stateRef.current, id), widgets));
  }

  function reset() {
    update(compactDashboardStateOrder({
      order: [...DEFAULT_STATE.order, ...state.custom.map((block) => block.id)],
      hidden: [...DEFAULT_STATE.hidden],
      custom: state.custom,
      sizes: {},
    }, widgets));
    setCatalogOpen(false);
  }

  function titleFor(id: string) {
    return byId.get(id)?.title || customById.get(id)?.title || t("dashboard.untitledBlock");
  }

  function updatePointerDrag(x: number, y: number) {
    const draggedElement = draggedElementRef.current;
    if (draggedElement) {
      draggedElement.style.setProperty("--dashboard-drag-x", `${x - dragOriginRef.current.x}px`);
      draggedElement.style.setProperty("--dashboard-drag-y", `${y - dragOriginRef.current.y + window.scrollY - dragOriginRef.current.scrollY}px`);
    }
    const grid = draggedElement?.closest<HTMLElement>(".dashboard-layout-grid");
    const gridBounds = grid?.getBoundingClientRect();
    if (!grid || !gridBounds || x < gridBounds.left || x > gridBounds.right || y < gridBounds.top || y > gridBounds.bottom) {
      dragOver("");
      return;
    }
    const rects = [...grid.querySelectorAll<HTMLElement>("[data-dashboard-widget]")].map((element) => {
      const bounds = element.getBoundingClientRect();
      return { id: element.dataset.dashboardWidget || "", left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    });
    dragOver(closestDashboardDropTarget(draggedIdRef.current, x, y, rects));
  }

  function keepAutoScrolling() {
    autoScrollFrameRef.current = null;
    if (!draggedIdRef.current) return;
    const delta = dashboardAutoScrollDelta(dragPointerRef.current.y, window.innerHeight);
    if (!delta) return;
    window.scrollBy({ top: delta, behavior: "auto" });
    updatePointerDrag(dragPointerRef.current.x, dragPointerRef.current.y);
    autoScrollFrameRef.current = window.requestAnimationFrame(keepAutoScrolling);
  }

  function moveWithPointer(event: PointerEvent<HTMLButtonElement>) {
    if (!draggedIdRef.current) return;
    dragPointerRef.current = { x: event.clientX, y: event.clientY };
    updatePointerDrag(event.clientX, event.clientY);
    const delta = dashboardAutoScrollDelta(event.clientY, window.innerHeight);
    if (delta && autoScrollFrameRef.current === null) autoScrollFrameRef.current = window.requestAnimationFrame(keepAutoScrolling);
    if (!delta && autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }

  function dragOver(targetId: string) {
    if (dragTargetRef.current === targetId) return;
    dragTargetRef.current = targetId;
    setDropTargetId(targetId);
  }

  function setDrag(id: string, element: HTMLElement, x: number, y: number) {
    draggedIdRef.current = id;
    dragTargetRef.current = "";
    draggedElementRef.current = element;
    dragOriginRef.current = { x, y, scrollY: window.scrollY };
    dragPointerRef.current = { x, y };
    setDropTargetId("");
    setDraggedId(id);
  }

  function finishDrag() {
    const dragged = draggedIdRef.current;
    const target = dragTargetRef.current;
    draggedElementRef.current?.style.removeProperty("--dashboard-drag-x");
    draggedElementRef.current?.style.removeProperty("--dashboard-drag-y");
    draggedIdRef.current = "";
    dragTargetRef.current = "";
    draggedElementRef.current = null;
    if (autoScrollFrameRef.current !== null) window.cancelAnimationFrame(autoScrollFrameRef.current);
    autoScrollFrameRef.current = null;
    if (dragged && target) reorder(dragged, target);
    setDragStateIdle();
  }

  function setDragStateIdle() {
    setDraggedId("");
    setDropTargetId("");
  }

  const dashboardReady = stateReady;

  return (
    <div className={`dashboard-layout${editing ? " is-editing" : ""}${dashboardReady ? " is-ready" : " is-loading"}`}>
      <div className="dashboard-layout-toolbar">
        <button
          className="button secondary"
          type="button"
          ref={addBlockButtonRef}
          disabled={!dashboardReady}
          onClick={() => catalogOpen ? closeCatalog() : setCatalogOpen(true)}
          aria-expanded={catalogOpen}
        >
          <Plus size={16} aria-hidden />
          {t("dashboard.addBlock")}
        </button>
        <button className="button secondary" type="button" disabled={!dashboardReady} onClick={() => {
          if (editing) update(compactDashboardStateOrder(stateRef.current, widgets));
          setEditing((value) => !value);
          setCatalogOpen(false);
        }} aria-pressed={editing}>
          <SlidersHorizontal size={16} aria-hidden />
          {editing ? t("dashboard.customizeDone") : t("dashboard.customize")}
        </button>
        {editing ? <button className="dashboard-reset" type="button" onClick={reset}><RotateCcw size={15} aria-hidden />{t("dashboard.resetLayout")}</button> : null}
      </div>

      {catalogOpen ? (
        <div className="dashboard-catalog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCatalog(); }}>
          <aside className="dashboard-catalog" ref={catalogRef} aria-describedby="dashboard-catalog-description" aria-label={t("dashboard.blockCatalog")} aria-modal="true" role="dialog">
            <div className="dashboard-catalog-head">
              <div><span>{t("dashboard.blockCatalog")}</span><p id="dashboard-catalog-description">{t("dashboard.blockCatalogHint")}</p></div>
              <button type="button" onClick={closeCatalog} aria-label={t("dashboard.closeCatalog")}><X size={18} aria-hidden /></button>
            </div>
            {hiddenWidgets.length ? (
              <div className="dashboard-catalog-section">
                <div className="dashboard-catalog-section-head"><strong>{t("dashboard.availableBlocks")}</strong><span>{t("dashboard.availableBlocksHint")}</span></div>
                <div className="dashboard-widget-gallery">
                  {hiddenWidgets.map((widget) => (
                    <article className="dashboard-widget-preset" key={widget.id}>
                      <div className="dashboard-widget-preview" aria-hidden>{widget.preview}</div>
                      <div className="dashboard-widget-preset-copy">
                        <span className="dashboard-widget-preset-icon">{widgetIcon(widget.id)}</span>
                        <div><strong>{widget.title}</strong><p>{widget.description}</p></div>
                      </div>
                      <button type="button" onClick={() => show(widget.id)}>{t("trash.restore")}</button>
                    </article>
                  ))}
                </div>
              </div>
            ) : hiddenCustomBlocks.length ? null : (
              <div className="dashboard-catalog-empty">
                <Eye size={24} aria-hidden />
                <strong>{t("dashboard.allBlocksVisible")}</strong>
                <p>{t("dashboard.allBlocksVisibleHint")}</p>
              </div>
            )}
            {hiddenCustomBlocks.length ? (
              <div className="dashboard-catalog-hidden">
                <strong>{t("dashboard.existingPersonalBlocks")}</strong>
                {hiddenCustomBlocks.map((block) => {
                  const restoreLabel = `${t("trash.restore")} ${block.title}`;
                  const deleteLabel = `${t("trash.deletePermanently")} ${block.title}`;
                  return (
                    <span className="dashboard-catalog-hidden-item" key={block.id}>
                      <button type="button" onClick={() => show(block.id)} aria-label={restoreLabel} title={restoreLabel}><Eye size={15} aria-hidden />{block.title}</button>
                      <button className="dashboard-hidden-delete" type="button" onClick={() => deleteCustom(block.id)} aria-label={deleteLabel} title={deleteLabel}><Trash2 size={15} aria-hidden /></button>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

      <div className="dashboard-layout-stage">
      {!dashboardReady ? (
        <div className="dashboard-layout-loading" aria-label={t("dashboard.loading")} role="status">
          <span /><span /><span /><span />
        </div>
      ) : null}
      <div className="dashboard-layout-grid">
        {state.order.map((id) => {
          const widget = byId.get(id);
          const custom = customById.get(id);
          if (!widget && !custom) return null;
          const title = titleFor(id);
          // The existing grid has two columns, so the useful deterministic
          // contract is deliberately limited to one column or both. On phones
          // CSS collapses both sizes to one column without mutating the saved
          // desktop preference.
          const size = dashboardWidgetSize(state, id, widget);
          const isWide = size === "wide";
          const hideLabel = `${t("dashboard.hideWidget")} ${title}`;
          const deleteLabel = `${t("trash.deletePermanently")} ${title}`;
          const visual = widget?.visual || "module";
          return (
            <div
              className={`dashboard-widget is-${visual}${custom && isWide ? " is-wide" : ""}${draggedId === id ? " is-dragging" : ""}${dropTargetId === id && draggedId !== id ? " is-drop-target" : ""}`}
              data-dashboard-widget={id}
              data-dashboard-size={size}
              data-dashboard-visual={visual}
              data-dashboard-href={widget?.href || undefined}
              key={id}
              onClick={(event) => {
                if (editing || !widget?.href || (event.target as HTMLElement).closest("a, button, input, textarea, select, [role='button']")) return;
                router.push(widget.href);
              }}
            >
              {editing ? (
                <div className="dashboard-widget-controls" aria-label={`${t("dashboard.widgetActions")} ${title}`}>
                  <button
                    className="dashboard-drag-handle"
                    type="button"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      const widgetElement = event.currentTarget.closest<HTMLElement>("[data-dashboard-widget]");
                      if (widgetElement) setDrag(id, widgetElement, event.clientX, event.clientY);
                    }}
                    onPointerMove={moveWithPointer}
                    onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); finishDrag(); }}
                    onPointerCancel={finishDrag}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                      event.preventDefault();
                      moveByKeyboard(id, event.key === "ArrowUp" ? -1 : 1);
                    }}
                    aria-label={`${t("dashboard.dragWidget")} ${title}`}
                  ><GripVertical size={18} aria-hidden /></button>
                  <strong>{title}</strong>
                  <button type="button" onClick={() => hide(id)} aria-label={hideLabel} title={hideLabel}><EyeOff size={16} aria-hidden /></button>
                  {custom ? <button type="button" onClick={() => deleteCustom(id)} aria-label={deleteLabel} title={deleteLabel}><Trash2 size={16} aria-hidden /></button> : null}
                </div>
              ) : null}
              {custom && editing ? (
                <div className="dashboard-custom-editor">
                  <label>{t("dashboard.blockTitle")}<input value={custom.title} onChange={(event) => editCustom(id, { title: event.target.value })} /></label>
                  {custom.kind === "metric" ? <label>{t("dashboard.blockValue")}<input value={custom.value} onChange={(event) => editCustom(id, { value: event.target.value })} /></label> : null}
                  {custom.kind === "progress" ? <label>{t("dashboard.blockPercentage")}<input type="number" min="0" max="100" value={custom.value} onChange={(event) => editCustom(id, { value: event.target.value })} /></label> : null}
                  <label>{custom.kind === "links" ? t("dashboard.blockLinksFormat") : t("dashboard.blockContent")}<textarea rows={custom.kind === "links" ? 4 : 3} value={custom.body} onChange={(event) => editCustom(id, { body: event.target.value })} /></label>
                </div>
              ) : custom ? <CustomBlockContent block={custom} /> : widget?.content}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
