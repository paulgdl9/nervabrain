"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  CalendarRange,
  Home,
  Inbox,
  ListChecks,
  MessageCircle,
  Mountain,
  Pin,
  Plus,
  Rss,
  ScanLine,
  StickyNote,
  Target,
  Trash2,
  Wallet,
  WalletCards,
  Wrench,
} from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Lucide SVGs instead of Nerd Font glyphs: private-use-area codepoints render
// as blank tofu on any machine without a patched font installed.
type NavEntry = { href: string; label: string; icon: React.ReactNode };
export type EnabledModules = { finance: boolean; budget: boolean; trail: boolean; business: boolean; revisions: boolean };

const NAV_ORDER_KEY = "sb-nav-order";
const UTILITY_ORDER_KEY = "sb-nav-utility-order";

function loadOrder(key: string, items: NavEntry[]): NavEntry[] {
  if (typeof window === "undefined") return items;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return items;
    const savedHrefs: string[] = JSON.parse(raw);
    if (!Array.isArray(savedHrefs)) return items;
    const byHref = new Map(items.map((item) => [item.href, item]));
    const ordered: NavEntry[] = [];
    for (const href of savedHrefs) {
      const item = byHref.get(href);
      if (item) {
        ordered.push(item);
        byHref.delete(href);
      }
    }
    // Append any items that are new (not present in the saved order) at the end.
    for (const item of items) {
      if (byHref.has(item.href)) ordered.push(item);
    }
    return ordered;
  } catch {
    return items;
  }
}

function saveOrder(key: string, items: NavEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(items.map((item) => item.href)));
  } catch {
    // Storage may be unavailable (private mode, quota); ordering just won't persist.
  }
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function useOrderedItems(key: string, defaultItems: NavEntry[]) {
  const [items, setItems] = useState<NavEntry[]>(defaultItems);
  const itemSignature = defaultItems.map((item) => `${item.href}:${item.label}`).join("|");

  useEffect(() => {
    // Reads localStorage (unavailable during SSR) to sync the persisted
    // drag-and-drop order once the component mounts in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(loadOrder(key, defaultItems));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, itemSignature]);

  const reorder = (fromHref: string, toHref: string) => {
    if (fromHref === toHref) return;
    setItems((current) => {
      const fromIndex = current.findIndex((item) => item.href === fromHref);
      const toIndex = current.findIndex((item) => item.href === toHref);
      if (fromIndex === -1 || toIndex === -1) return current;
      const next = current.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      saveOrder(key, next);
      return next;
    });
  };

  return { items, reorder };
}

export type CustomPageEntry = { slug: string; title: string; icon: string };

function NewPageButton() {
  const router = useRouter();
  const { t } = useLanguage();
  const [creating, setCreating] = useState(false);

  async function createPage() {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/custom-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t("nav.untitledPage") }),
      });
      const json = (await response.json()) as { ok?: boolean; slug?: string };
      if (!json?.ok || !json.slug) return;
      // The sidebar list is server-rendered; refresh re-reads it so the new
      // page shows up immediately after we navigate to it.
      router.push(`/p/${json.slug}`);
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  return (
    <button type="button" className="nav-item nav-new-page" onClick={createPage} disabled={creating}>
      <span className="nav-icon" aria-hidden>
        <Plus size={15} />
      </span>
      <span className="nav-label">{creating ? t("nav.creatingPage") : t("nav.newPage")}</span>
    </button>
  );
}

// Custom pages arrive as props from the server (AppShell). A client fetch to
// /api/custom-pages fails on same-origin GET (browsers drop the Origin header,
// so the same-origin auth check rejects it), which left the sidebar empty.
export function AppNav({
  customPages = [],
  modules = { finance: true, budget: true, trail: true, business: true, revisions: false },
}: {
  customPages?: CustomPageEntry[];
  modules?: EnabledModules;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const navItems: NavEntry[] = [
    { href: "/", label: t("nav.dashboard"), icon: <Home size={15} /> },
    { href: "/daily", label: t("nav.daily"), icon: <CalendarDays size={15} /> },
    { href: "/weekly", label: t("nav.weekly"), icon: <CalendarRange size={15} /> },
    { href: "/notes", label: t("nav.notes"), icon: <StickyNote size={15} /> },
    { href: "/tasks", label: t("nav.tasks"), icon: <ListChecks size={15} /> },
    { href: "/objectives", label: t("nav.objectives"), icon: <Target size={15} /> },
    ...(modules.business ? [{ href: "/business", label: t("nav.business"), icon: <BriefcaseBusiness size={15} /> }] : []),
    ...(modules.finance ? [{ href: "/finances", label: t("nav.finances"), icon: <Wallet size={15} /> }] : []),
    ...(modules.budget ? [{ href: "/budget", label: t("nav.budget"), icon: <WalletCards size={15} /> }] : []),
    ...(modules.trail ? [{ href: "/training", label: t("nav.trail"), icon: <Mountain size={15} /> }] : []),
    ...(modules.revisions ? [{ href: "/revisions", label: t("nav.radio"), icon: <ScanLine size={15} /> }] : []),
    { href: "/wiki", label: t("nav.wiki"), icon: <BookOpen size={15} /> },
    { href: "/assistant", label: t("nav.assistant"), icon: <MessageCircle size={15} /> },
  ];
  const customItems: NavEntry[] = customPages.map((page) => ({
    href: `/p/${page.slug}`,
    label: page.title,
    icon: page.icon || "📄",
  }));
  const { items, reorder } = useOrderedItems(NAV_ORDER_KEY, navItems);
  const allItems = [...items, ...customItems];

  return (
    <>
      <ReorderableNavList
        items={allItems}
        pathname={pathname}
        reorder={reorder}
        className="nav-list"
        ariaLabel={t("nav.mainLabel")}
      />
      <NewPageButton />
    </>
  );
}

export function PinnedNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const { t } = useLanguage();

  if (!items.length) return null;

  return (
    <nav className="nav-list nav-pinned" aria-label={t("nav.pinnedLabel")}>
      <span className="nav-label">{t("nav.pinned")}</span>
      {items.map((item) => (
        <NavItem item={{ ...item, icon: <Pin size={15} /> }} pathname={pathname} key={item.href} />
      ))}
    </nav>
  );
}

export function AppUtilityNav({ showSetup = true }: { showSetup?: boolean }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const utilityItems: NavEntry[] = [
    ...(showSetup ? [{ href: "/setup", label: t("nav.setup"), icon: <Wrench size={15} /> }] : []),
    { href: "/inbox", label: t("nav.inbox"), icon: <Inbox size={15} /> },
    { href: "/feeds", label: t("nav.feeds"), icon: <Rss size={15} /> },
    { href: "/trash", label: t("nav.trash"), icon: <Trash2 size={15} /> },
  ];
  const { items, reorder } = useOrderedItems(UTILITY_ORDER_KEY, utilityItems);

  return (
    <ReorderableNavList
      items={items}
      pathname={pathname}
      reorder={reorder}
      className="nav-list nav-utility"
      ariaLabel={t("nav.utilityLabel")}
    />
  );
}

// Shared 1×1 transparent image: hiding the browser's snapshot ghost makes the
// live in-list reordering the only motion the user sees, which reads as the
// item itself following the cursor.
let emptyDragImage: HTMLImageElement | null = null;
function getEmptyDragImage(): HTMLImageElement {
  if (!emptyDragImage) {
    emptyDragImage = new Image();
    emptyDragImage.src =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  }
  return emptyDragImage;
}

function ReorderableNavList({
  items,
  pathname,
  reorder,
  className,
  ariaLabel,
}: {
  items: NavEntry[];
  pathname: string;
  reorder: (fromHref: string, toHref: string) => void;
  className: string;
  ariaLabel: string;
}) {
  const [draggedHref, setDraggedHref] = useState<string | null>(null);

  return (
    <nav className={className} aria-label={ariaLabel}>
      {items.map((item) => (
        <NavItem
          item={item}
          pathname={pathname}
          key={item.href}
          isDragging={draggedHref === item.href}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setDragImage(getEmptyDragImage(), 0, 0);
            setDraggedHref(item.href);
          }}
          onDragEnter={() => {
            // Reorder live while hovering: the list itself previews the drop,
            // instead of a static highlight resolved only on release.
            if (draggedHref && draggedHref !== item.href) reorder(draggedHref, item.href);
          }}
          onDrop={() => setDraggedHref(null)}
          onDragEnd={() => setDraggedHref(null)}
        />
      ))}
    </nav>
  );
}

function NavItem({
  item,
  pathname,
  isDragging = false,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: {
  item: NavEntry;
  pathname: string;
  isDragging?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  const active = isActive(pathname, item.href);
  const draggable = Boolean(onDragStart);

  const link = (
    <Link
      href={item.href}
      className={`nav-item${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <span className="nf nav-icon" aria-hidden>{item.icon}</span>
      <span className="nav-label">{item.label}</span>
      {draggable && (
        <span className="nav-drag-handle" aria-hidden>⠿</span>
      )}
    </Link>
  );

  if (!draggable) return link;

  const classes = ["nav-item-drag", isDragging ? "is-dragging" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={onDragEnter}
      onDrop={(event) => {
        event.preventDefault();
        onDrop?.();
      }}
      onDragEnd={onDragEnd}
    >
      {link}
    </div>
  );
}
