"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ExternalLink, ListPlus, PenLine, Archive, FileText, Play, X } from "lucide-react";
import type { BriefSuggestion, BriefSuggestionKind } from "@/lib/brief-suggestions";
import { useLanguage } from "@/components/LanguageProvider";

const ICONS: Record<BriefSuggestionKind, typeof ListPlus> = {
  create_task: ListPlus,
  update_task: PenLine,
  archive_task: Archive,
  capture_note: FileText,
  execute_task: Play,
};

const KIND_KEYS = {
  create_task: "suggestions.kind.createTask",
  update_task: "suggestions.kind.updateTask",
  archive_task: "suggestions.kind.archiveTask",
  capture_note: "suggestions.kind.captureNote",
  execute_task: "suggestions.kind.executeTask",
} as const;

/** Human-readable summary of what accepting actually changes. */
function detail(suggestion: BriefSuggestion) {
  if (suggestion.kind === "execute_task") {
    return suggestion.edits?.length ? suggestion.edits.map((edit) => edit.path).join(" · ") : suggestion.target || "";
  }
  if (suggestion.kind === "update_task") {
    return Object.entries(suggestion.patch || {})
      .map(([field, value]) => `${field} → ${value}`)
      .join(" · ");
  }
  if (suggestion.kind === "create_task") {
    return [suggestion.task?.area, suggestion.task?.objective].filter(Boolean).join(" · ");
  }
  if (suggestion.kind === "capture_note") return "02-Raw";
  return suggestion.target || "";
}

function resultHref(relativePath: string) {
  return "/note/" + relativePath.split("/").map(encodeURIComponent).join("/");
}

export function BriefSuggestions({ path, initial }: { path: string; initial: BriefSuggestion[] }) {
  const { t } = useLanguage();
  const [suggestions, setSuggestions] = useState(initial);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");

  async function decide(id: string, decision: "accepted" | "rejected") {
    setPendingId(id);
    setError("");
    try {
      const response = await fetch("/api/brief-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, id, decision }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; suggestions?: BriefSuggestion[] };
      if (!response.ok || !result.ok) throw new Error(result.error || t("suggestions.error"));
      if (result.suggestions) setSuggestions(result.suggestions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("suggestions.error"));
    } finally {
      setPendingId("");
    }
  }

  if (!suggestions.length) return null;
  const pending = suggestions.filter((entry) => entry.state === "pending");

  return (
    <section className="brief-suggestions">
      <div className="brief-suggestions-head">
        <h3>{t("suggestions.title")}</h3>
        <span className="muted">{t("suggestions.count").replace("{count}", String(pending.length))}</span>
      </div>
      <p className="muted brief-suggestions-hint">{t("suggestions.hint")}</p>

      <ul className="brief-suggestions-list">
        {suggestions.map((suggestion) => {
          const Icon = ICONS[suggestion.kind];
          const decided = suggestion.state !== "pending";
          const summary = detail(suggestion);
          return (
            <li key={suggestion.id} className={`brief-suggestion is-${suggestion.state}`}>
              <div className="brief-suggestion-body">
                <span className="brief-suggestion-kind">
                  <Icon size={14} aria-hidden /> {t(KIND_KEYS[suggestion.kind])}
                </span>
                <strong>{suggestion.title}</strong>
                {suggestion.why ? <p className="muted">{suggestion.why}</p> : null}
                {suggestion.outcome ? (
                  <details className="brief-suggestion-outcome">
                    <summary>{t("suggestions.outcome")}</summary>
                    <pre>{suggestion.outcome}</pre>
                  </details>
                ) : null}
                {summary ? <p className="brief-suggestion-detail"><strong>{t("suggestions.effect")}</strong> {summary}</p> : null}
                {suggestion.state === "accepted" && suggestion.resultPath ? (
                  <Link className="brief-suggestion-result" href={resultHref(suggestion.resultPath)}>
                    <ExternalLink size={12} aria-hidden /> {t("suggestions.openResult")}
                  </Link>
                ) : null}
                {suggestion.error ? <p className="brief-suggestion-error">{suggestion.error}</p> : null}
              </div>
              {decided ? (
                <span className="brief-suggestion-state">
                  {t(suggestion.state === "accepted" ? "suggestions.accepted" : "suggestions.rejected")}
                </span>
              ) : (
                <div className="brief-suggestion-actions">
                  <button
                    type="button"
                    className="brief-suggestion-btn"
                    onClick={() => decide(suggestion.id, "rejected")}
                    disabled={Boolean(pendingId)}
                  >
                    <X size={16} aria-hidden /> {t("suggestions.reject")}
                  </button>
                  <button
                    type="button"
                    className="brief-suggestion-btn is-accept"
                    onClick={() => decide(suggestion.id, "accepted")}
                    disabled={Boolean(pendingId)}
                  >
                    <Check size={16} aria-hidden /> {t("suggestions.accept")}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error ? <p className="brief-suggestion-error">{error}</p> : null}
    </section>
  );
}
