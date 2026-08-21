"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function GarminResyncButton({ onError }: { onError?: (message: string) => void }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  async function resync() {
    if (syncing) return;
    setSyncing(true);
    setError("");
    onError?.("");
    try {
      const response = await fetch("/api/trail/resync", { method: "POST" });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; pending?: boolean };
      if (!response.ok || !result.ok) {
        if (result.pending) router.refresh();
        throw new Error(result.error || "Synchronisation impossible");
      }
      router.refresh();
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Synchronisation impossible";
      setError(message);
      onError?.(message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button type="button" className={`garmin-resync${error ? " is-error" : ""}`} onClick={resync} disabled={syncing} aria-label={syncing ? "Synchronisation Garmin en cours" : "Resynchroniser Garmin"} title={error || "Resynchroniser Garmin"}>
      <RefreshCw size={14} className={syncing ? "is-spinning" : ""} aria-hidden />
    </button>
  );
}
