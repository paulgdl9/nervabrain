"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import {
  ArrowRight,
  Archive,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Circle,
  ExternalLink,
  FileText,
  Inbox as InboxIcon,
  Pencil,
  Search,
  Tags,
} from "lucide-react";
import Link from "next/link";
import type { VaultNote } from "@/lib/vault";
import { useLanguage } from "@/components/LanguageProvider";

type InboxFilter = "open" | "processed" | "archived" | "all";
type WikiMode = "library" | "drafts";

function routeFor(prefix: "doc" | "edit" | "note", relativePath: string) {
  return `/${prefix}/` + relativePath.split("/").map(encodeURIComponent).join("/");
}

function field(value: unknown) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

function compactDate(value: unknown, locale: "fr" | "en") {
  const raw = field(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en", { month: "short", day: "2-digit" }).format(date);
}

function noteText(note: VaultNote) {
  return [
    note.title,
    note.relativePath,
    note.status,
    note.excerpt,
    field(note.data.description),
    note.tags.join(" "),
    field(note.data.source),
    field(note.data.area),
  ].join(" ").toLowerCase();
}

function wikiTopic(note: VaultNote, fallback: string) {
  return field(note.data.area) || fallback;
}

function wikiDescription(note: VaultNote) {
  return field(note.data.description) || note.excerpt;
}

function wikiReadTime(note: VaultNote) {
  const declared = Number(note.data.read_time);
  if (Number.isFinite(declared) && declared > 0) return Math.round(declared);
  const words = note.content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function wikiOrder(note: VaultNote) {
  const order = Number(note.data.order);
  return Number.isFinite(order) ? order : 999;
}

function matchesQuery(note: VaultNote, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || noteText(note).includes(needle);
}

function topValues(notes: VaultNote[], getter: (note: VaultNote) => string[], limit = 8) {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const value of getter(note)) {
      const clean = value.trim();
      if (!clean) continue;
      counts.set(clean, (counts.get(clean) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function stat(label: string, value: number | string, icon: ReactNode) {
  return { label, value, icon };
}

function KnowledgePipelineNotice() {
  const { t } = useLanguage();
  return (
    <section className="kb-side-block" aria-label={t("knowledge.pipeline")}>
      <div className="kb-side-title"><BookOpen size={15} /><span>{t("knowledge.pipeline")}</span></div>
      <div className="muted">{t("knowledge.pipelineExplanation")}</div>
    </section>
  );
}

export function InboxWorkspace({ notes: initialNotes, initialFilter = "all" }: { notes: VaultNote[]; initialFilter?: InboxFilter }) {
  const { locale, t } = useLanguage();
  const [notes] = useState(initialNotes);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InboxFilter>(initialFilter);
  const [activeFacet, setActiveFacet] = useState("");
  const stats = useMemo(() => {
    const open = notes.filter((note) => ["inbox", "needs-ai"].includes(note.status || "inbox")).length;
    const processed = notes.filter((note) => ["briefed", "processed"].includes(note.status)).length;
    const archived = notes.filter((note) => note.status === "archived").length;
    return [
      stat(t("knowledge.captures"), notes.length, <InboxIcon size={16} />),
      stat(t("knowledge.toTriage"), open, <Circle size={16} />),
      stat(t("knowledge.promoted"), processed, <CheckCircle2 size={16} />),
      stat(t("knowledge.archived"), archived, <Archive size={16} />),
    ];
  }, [notes, t]);

  const facets = useMemo(
    () => topValues(notes, (note) => [field(note.data.area), field(note.data.source), ...note.tags], 10),
    [notes],
  );

  const filtered = useMemo(() => notes.filter((note) => {
    const status = note.status || "inbox";
    const inFilter =
      filter === "all" ||
      (filter === "open" && ["inbox", "needs-ai"].includes(status)) ||
      (filter === "processed" && ["briefed", "processed"].includes(status)) ||
      (filter === "archived" && status === "archived");
    const inFacet = !activeFacet || [field(note.data.area), field(note.data.source), ...note.tags].includes(activeFacet);
    return inFilter && inFacet && matchesQuery(note, query);
  }), [activeFacet, filter, notes, query]);

  return (
    <KnowledgeFrame
      stats={stats}
      query={query}
      onQuery={setQuery}
      resultCount={filtered.length}
      filter={
        <Segmented
          value={filter}
          items={[
            ["open", t("knowledge.triage")],
            ["processed", t("knowledge.promoted")],
            ["archived", t("knowledge.archived")],
            ["all", t("knowledge.all")],
          ]}
          onChange={(value) => setFilter(value as InboxFilter)}
        />
      }
      side={
        <SideRail
          title={t("knowledge.pipeline")}
          rows={[
            [t("knowledge.raw"), notes.filter((note) => ["inbox", "needs-ai"].includes(note.status || "inbox")).length],
            [t("form.briefed"), notes.filter((note) => note.status === "briefed").length],
            [t("knowledge.wiki"), notes.filter((note) => note.status === "processed").length],
          ]}
          facets={facets}
          activeFacet={activeFacet}
          onFacet={setActiveFacet}
        />
      }
    >
      {filtered.map((note) => {
        const derivedNotes = Array.isArray(note.data.derived_notes) ? note.data.derived_notes.map(String) : [];
        const linkedNote = note.status === "processed"
          ? derivedNotes[0] || field(note.data.wiki_note)
          : "";
        return (
        <article className="kb-card" key={note.id}>
          <div className="kb-card-main">
            <div className="kb-card-kicker">
              <StatusPill status={note.status || "inbox"} />
              <span>{field(note.data.source) || t("form.manual")}</span>
              <span>{compactDate(note.data.captured_at || note.data.created || note.mtime, locale)}</span>
            </div>
            <Link href={routeFor("doc", note.relativePath)} className="kb-card-title">
              {note.title}
            </Link>
            {note.excerpt ? <p>{note.excerpt}</p> : null}
            <TagRow tags={note.tags} fallback={field(note.data.area)} />
          </div>
          <div className="kb-card-actions">
            <Link className="kb-icon-action" href={routeFor("doc", note.relativePath)} title={t("knowledge.open")}>
              <FileText size={16} />
            </Link>
            <Link className="kb-icon-action" href={routeFor("edit", note.relativePath)} title={t("knowledge.edit")}>
              <Pencil size={16} />
            </Link>
            {field(note.data.url) ? (
              <a className="kb-icon-action" href={field(note.data.url)} target="_blank" rel="noreferrer" title="Source">
                <ExternalLink size={16} />
              </a>
            ) : null}
            {linkedNote ? (
              <Link className="kb-icon-action" href={routeFor("note", linkedNote)} title={t("knowledge.open")}>
                <BookOpen size={16} />
              </Link>
            ) : null}
            {field(note.data.route_destination)
              ? <span className="kb-route-label">{field(note.data.route_destination)}</span>
              : null}
          </div>
        </article>
        );
      })}
      {!filtered.length ? <div className="kb-empty">{t("knowledge.noCapture")}</div> : null}
    </KnowledgeFrame>
  );
}

export function WikiWorkspace({ notes: initialNotes, initialMode = "library" }: { notes: VaultNote[]; initialMode?: WikiMode }) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState(initialNotes);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<WikiMode>(initialMode);
  const [visibleCount, setVisibleCount] = useState(4);
  const [pendingPath, setPendingPath] = useState("");
  const [errorPath, setErrorPath] = useState("");
  const [isPending, startTransition] = useTransition();

  const published = useMemo(() => notes
    .filter((note) => note.status === "active")
    .sort((a, b) => wikiOrder(a) - wikiOrder(b) || a.title.localeCompare(b.title)), [notes]);
  const drafts = useMemo(() => notes
    .filter((note) => (note.status || "draft") === "draft")
    .sort((a, b) => b.mtime.localeCompare(a.mtime)), [notes]);
  const topics = useMemo(() => topValues(published, (note) => [wikiTopic(note, t("wiki.unclassified"))], 7), [published, t]);
  const filtered = useMemo(() => (mode === "library" ? published : drafts).filter((note) => (
    (mode === "drafts" || !topic || wikiTopic(note, t("wiki.unclassified")) === topic) && matchesQuery(note, query)
  )), [drafts, mode, published, query, t, topic]);
  const featured = published.find((note) => note.data.featured === true) || published[0];
  const featuredIsVisible = Boolean(featured && mode === "library" && !query && !topic);
  const browsable = featuredIsVisible ? filtered.filter((note) => note.id !== featured?.id) : filtered;
  const visibleNotes = browsable.slice(0, visibleCount);
  const hasMore = visibleNotes.length < browsable.length;

  function resetResults() {
    setVisibleCount(4);
  }

  function updateWikiStatus(note: VaultNote, status: "active" | "archived") {
    setPendingPath(note.relativePath);
    setErrorPath("");
    startTransition(async () => {
      try {
        const order = Number(note.data.order);
        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update",
            path: note.relativePath,
            title: note.title,
            status,
            area: field(note.data.area),
            priority: field(note.data.priority),
            horizon: field(note.data.horizon),
            order: Number.isFinite(order) ? order : undefined,
            tags: note.tags,
            content: note.content,
            expectedMtime: note.mtime,
          }),
        });
        const body = await response.json() as { note?: VaultNote };
        if (!response.ok || !body.note) {
          setErrorPath(note.relativePath);
          return;
        }
        setNotes((current) => current.map((item) => item.id === note.id ? body.note! : item));
      } catch {
        setErrorPath(note.relativePath);
      } finally {
        setPendingPath("");
      }
    });
  }

  return (
    <div className="wiki-library">
      <KnowledgePipelineNotice />
      {featuredIsVisible && featured ? (
        <section className="wiki-featured">
          <div className="wiki-featured-copy">
            <span className="wiki-kicker">{t("wiki.startHere")} · {wikiTopic(featured, t("wiki.unclassified"))}</span>
            <h2>{featured.title}</h2>
            <p>{wikiDescription(featured)}</p>
            <Link href={routeFor("note", featured.relativePath)} className="wiki-read-link">
              {t("wiki.readGuide")} <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
          <div className="wiki-featured-aside" aria-label={t("wiki.readingInfo")}>
            <BookOpen size={24} aria-hidden />
            <strong>{wikiReadTime(featured)} min</strong>
            <span>{t("wiki.toUnderstand")}</span>
          </div>
        </section>
      ) : null}

      <section className="wiki-explore" aria-labelledby="wiki-explore-title">
        <div className="wiki-section-heading">
          <div>
            <span className="wiki-kicker">{mode === "library" ? t("page.wiki.title") : t("wiki.workspace")}</span>
            <h2 id="wiki-explore-title">{mode === "library" ? t("wiki.explore") : t("wiki.draftsToConsolidate")}</h2>
          </div>
          <span className="wiki-count">{mode === "library" ? `${published.length} ${t(published.length === 1 ? "wiki.consolidatedGuide" : "wiki.consolidatedGuides")}` : `${drafts.length} ${t(drafts.length === 1 ? "wiki.draft" : "wiki.drafts")}`}</span>
        </div>

        {mode === "library" ? <div className="wiki-topics" aria-label={t("wiki.filterTopic")}>
          <button className={!topic ? "is-active" : ""} onClick={() => { setTopic(""); resetResults(); }} type="button">
            {t("knowledge.all")} <span>{published.length}</span>
          </button>
          {topics.map((item) => (
            <button className={topic === item.label ? "is-active" : ""} key={item.label} onClick={() => { setTopic(item.label); resetResults(); }} type="button">
              {item.label} <span>{item.count}</span>
            </button>
          ))}
        </div> : null}
      </section>

      <div className="kb-toolbar wiki-toolbar">
        <label className="kb-search">
          <Search size={15} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); resetResults(); }} placeholder={t("wiki.search")} />
        </label>
        <Segmented
          value={mode}
          items={[["library", t("page.wiki.title")], ["drafts", `${t("wiki.drafts")}${drafts.length ? ` · ${drafts.length}` : ""}`]]}
          onChange={(value) => {
            setMode(value as WikiMode);
            setTopic("");
            resetResults();
          }}
        />
        <span className="kb-count">{filtered.length} {t(filtered.length === 1 ? "wiki.result" : "wiki.results")}</span>
      </div>

      <div className="wiki-grid">
        {visibleNotes.map((note) => mode === "drafts" ? (
          <article className="wiki-tile" key={note.id}>
            <div className="wiki-tile-head">
              <span className="wiki-tile-topic"><BookOpen size={13} aria-hidden /> {wikiTopic(note, t("wiki.unclassified"))}</span>
              <span className="wiki-tile-time"><Clock3 size={13} aria-hidden /> {wikiReadTime(note)} min</span>
            </div>
            <Link className="wiki-tile-title" href={routeFor("edit", note.relativePath)} style={{ textDecoration: "none" }}>{note.title}</Link>
            {wikiDescription(note) ? <p>{wikiDescription(note)}</p> : null}
            <div className="wiki-tile-foot">
              <Link className="wiki-tile-cta" href={routeFor("edit", note.relativePath)}>{t("knowledge.edit")}</Link>
              <div className="kb-card-actions" aria-label={t("wiki.workspace")}>
                <button className="button primary" disabled={isPending && pendingPath === note.relativePath} onClick={() => updateWikiStatus(note, "active")} type="button">
                  <CheckCircle2 size={14} aria-hidden /> {t("wiki.publish")}
                </button>
                <button className="button" disabled={isPending && pendingPath === note.relativePath} onClick={() => updateWikiStatus(note, "archived")} type="button">
                  <Archive size={14} aria-hidden /> {t("wiki.archive")}
                </button>
              </div>
            </div>
            {errorPath === note.relativePath ? <span className="save-state save-error" role="alert">{t("notes.saveFailed")}</span> : null}
          </article>
        ) : (
          <Link
            className="wiki-tile"
            href={routeFor("note", note.relativePath)}
            aria-label={t("wiki.read").replace("{title}", note.title)}
            key={note.id}
          >
            <div className="wiki-tile-head">
              <span className="wiki-tile-topic"><BookOpen size={13} aria-hidden /> {wikiTopic(note, t("wiki.unclassified"))}</span>
              <span className="wiki-tile-time"><Clock3 size={13} aria-hidden /> {wikiReadTime(note)} min</span>
            </div>
            <strong className="wiki-tile-title">{note.title}</strong>
            {wikiDescription(note) ? <p>{wikiDescription(note)}</p> : null}
            <div className="wiki-tile-foot">
              <span className="wiki-tile-cta">{t("wiki.readGuide")}</span>
              <span className="wiki-tile-open" aria-hidden>
                <ArrowRight size={17} aria-hidden />
              </span>
            </div>
          </Link>
        ))}
        {!filtered.length ? <div className="kb-empty">{t("wiki.noMatch")}</div> : null}
      </div>

      {browsable.length > 4 ? (
        <div className="wiki-results-more">
          <button
            type="button"
            onClick={() => setVisibleCount(hasMore ? visibleCount + 4 : 4)}
            aria-expanded={!hasMore}
          >
            {hasMore ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
            {hasMore ? t("wiki.showMore") : t("wiki.showLess")}
            <span>{visibleNotes.length}/{browsable.length}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function KnowledgeFrame({
  stats,
  query,
  onQuery,
  resultCount,
  filter,
  side,
  children,
}: {
  stats: Array<{ label: string; value: number | string; icon: ReactNode }>;
  query: string;
  onQuery: (value: string) => void;
  resultCount: number;
  filter: ReactNode;
  side: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div className="kb-workspace">
      <KnowledgePipelineNotice />
      <section className="kb-stats" aria-label={t("knowledge.summary")}>
        {stats.map((item) => (
          <div className="kb-stat" key={item.label}>
            <span className="kb-stat-icon">{item.icon}</span>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      <div className="kb-toolbar">
        <label className="kb-search">
          <Search size={15} />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("nav.search")} />
        </label>
        {filter}
        <span className="kb-count">{resultCount} {t("knowledge.shown")}</span>
      </div>

      <div className="kb-layout">
        {side}
        <section className="kb-feed" aria-label="Notes">
          {children}
        </section>
      </div>
    </div>
  );
}

function Segmented({
  value,
  items,
  onChange,
}: {
  value: string;
  items: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="kb-segmented">
      {items.map(([key, label]) => (
        <button className={value === key ? "is-active" : ""} key={key} onClick={() => onChange(key)} type="button">
          {label}
        </button>
      ))}
    </div>
  );
}

function SideRail({
  title,
  rows,
  facets,
  activeFacet,
  onFacet,
}: {
  title: string;
  rows: Array<[string, number]>;
  facets: Array<{ label: string; count: number }>;
  activeFacet: string;
  onFacet: (facet: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <aside className="kb-side">
      <div className="kb-side-block">
        <div className="kb-side-title">
          <BookOpen size={15} />
          <span>{title}</span>
        </div>
        <div className="kb-side-rows">
          {rows.map(([label, value]) => (
            <div className="kb-side-row" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="kb-side-block">
        <div className="kb-side-title">
          <Tags size={15} />
          <span>{t("knowledge.signals")}</span>
        </div>
        <div className="kb-facets">
          <button className={!activeFacet ? "is-active" : ""} onClick={() => onFacet("")} type="button">
            {t("knowledge.all")}
          </button>
          {facets.map((facet) => (
            <button
              className={activeFacet === facet.label ? "is-active" : ""}
              key={facet.label}
              onClick={() => onFacet(activeFacet === facet.label ? "" : facet.label)}
              type="button"
            >
              {facet.label}
              <span>{facet.count}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function StatusPill({ status }: { status: string }) {
  const { valueLabel } = useLanguage();
  return <span className={`kb-status kb-status-${status}`}>{valueLabel(status)}</span>;
}

function TagRow({ tags, fallback }: { tags: string[]; fallback?: string }) {
  const values = tags.length ? tags.slice(0, 5) : fallback ? [fallback] : [];
  if (!values.length) return null;
  return (
    <div className="kb-tags">
      {values.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </div>
  );
}
