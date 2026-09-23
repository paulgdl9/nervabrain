"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Watch } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export function GarminPublishButton({ sessionId, scheduledDate }: { sessionId: string; scheduledDate: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function publish() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/trail/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, scheduled_date: scheduledDate }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || t("training.garmin.publishError"));
      router.refresh();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : t("training.garmin.publishError"));
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" className="garmin-publish" onClick={publish} disabled={busy} title={error || t("training.garmin.publishHint")}>
    <Watch size={14} aria-hidden /> {busy ? t("training.garmin.publishing") : t("training.garmin.publish")}
  </button>;
}
