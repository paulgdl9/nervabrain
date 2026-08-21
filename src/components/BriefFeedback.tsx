"use client";

import { useState } from "react";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export type BriefFeedbackValue = "useful" | "not_useful" | "";

type Props = {
  path: string;
  initialVerdict?: BriefFeedbackValue;
  initialReason?: string;
};

export function BriefFeedback({
  path,
  initialVerdict = "",
  initialReason = "",
}: Props) {
  const { t } = useLanguage();
  const [verdict, setVerdict] = useState<BriefFeedbackValue>(initialVerdict);
  const [reason, setReason] = useState(initialReason);
  const [draftReason, setDraftReason] = useState(initialReason);
  const [editingReason, setEditingReason] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(Boolean(initialVerdict));
  const [error, setError] = useState("");

  async function persist(nextVerdict: Exclude<BriefFeedbackValue, "">, nextReason: string) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/brief-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, verdict: nextVerdict, reason: nextReason }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || t("brief.feedback.error"));
      setVerdict(nextVerdict);
      setReason(nextReason.trim());
      setDraftReason(nextReason.trim());
      setSaved(true);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("brief.feedback.error"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function choose(nextVerdict: Exclude<BriefFeedbackValue, "">) {
    if (saving || (nextVerdict === verdict && saved)) return;
    await persist(nextVerdict, reason);
  }

  async function saveReason() {
    if (!verdict || saving) return;
    if (await persist(verdict, draftReason)) setEditingReason(false);
  }

  return (
    <div className="brief-feedback">
      <div className="brief-feedback-main">
        <span>{t("brief.feedback.question")}</span>
        <div className="brief-feedback-choices" role="group" aria-label={t("brief.feedback.question")}>
          <button
            type="button"
            className={verdict === "useful" ? "is-selected" : ""}
            aria-pressed={verdict === "useful"}
            disabled={saving}
            onClick={() => choose("useful")}
          >
            <ThumbsUp size={13} aria-hidden />
            {t("brief.feedback.useful")}
          </button>
          <button
            type="button"
            className={verdict === "not_useful" ? "is-selected" : ""}
            aria-pressed={verdict === "not_useful"}
            disabled={saving}
            onClick={() => choose("not_useful")}
          >
            <ThumbsDown size={13} aria-hidden />
            {t("brief.feedback.notUseful")}
          </button>
        </div>
        {verdict && !editingReason ? (
          <button
            type="button"
            className="brief-feedback-detail-toggle"
            onClick={() => setEditingReason(true)}
          >
            {reason ? t("brief.feedback.editDetail") : t("brief.feedback.addDetail")}
          </button>
        ) : null}
        {saved && !saving ? <small><Check size={12} aria-hidden /> {t("brief.feedback.saved")}</small> : null}
      </div>

      {editingReason && verdict ? (
        <div className="brief-feedback-detail">
          <input
            value={draftReason}
            maxLength={280}
            onChange={(event) => setDraftReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveReason();
              }
              if (event.key === "Escape") {
                setDraftReason(reason);
                setEditingReason(false);
              }
            }}
            placeholder={t("brief.feedback.detailPlaceholder")}
            autoFocus
          />
          <button type="button" disabled={saving} onClick={() => void saveReason()}>
            {saving ? t("brief.feedback.saving") : t("brief.feedback.save")}
          </button>
        </div>
      ) : null}
      {error ? <p className="brief-feedback-error">{error}</p> : null}
    </div>
  );
}
