"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceAppearancePreference } from "@/lib/ui-preferences";

const DEFAULT_WORKSPACE_APPEARANCE: WorkspaceAppearancePreference = {
  customAreas: [],
  hiddenAreas: [],
  areaColors: {},
};

function legacyPreference(): WorkspaceAppearancePreference {
  try {
    const customAreas = JSON.parse(localStorage.getItem("obj-custom-areas") || "[]");
    const hiddenAreas = JSON.parse(localStorage.getItem("obj-hidden-areas") || "[]");
    const areaColors = JSON.parse(localStorage.getItem("obj-area-colors") || "{}");
    return {
      customAreas: Array.isArray(customAreas) ? customAreas.map(String) : [],
      hiddenAreas: Array.isArray(hiddenAreas) ? hiddenAreas.map(String) : [],
      areaColors: areaColors && typeof areaColors === "object" && !Array.isArray(areaColors) ? areaColors : {},
    };
  } catch {
    return DEFAULT_WORKSPACE_APPEARANCE;
  }
}

function cachePreference(value: WorkspaceAppearancePreference) {
  try {
    localStorage.setItem("obj-custom-areas", JSON.stringify(value.customAreas));
    localStorage.setItem("obj-hidden-areas", JSON.stringify(value.hiddenAreas));
    localStorage.setItem("obj-area-colors", JSON.stringify(value.areaColors));
  } catch {
    // The vault-backed copy remains the source of truth.
  }
}

function persistPreference(value: WorkspaceAppearancePreference) {
  return fetch("/api/ui-preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ kind: "workspace-appearance", value }),
  }).then(() => undefined).catch(() => undefined);
}

export function useWorkspaceAppearance(initial: WorkspaceAppearancePreference | null) {
  const [preference, setPreference] = useState<WorkspaceAppearancePreference>(initial ?? DEFAULT_WORKSPACE_APPEARANCE);
  const preferenceRef = useRef(preference);
  const saveChain = useRef(Promise.resolve());

  useEffect(() => {
    const selected = initial ?? legacyPreference();
    preferenceRef.current = selected;
    queueMicrotask(() => setPreference(selected));
    cachePreference(selected);
    if (initial === null) saveChain.current = saveChain.current.then(() => persistPreference(selected));
  }, [initial]);

  const update = useCallback((change: (current: WorkspaceAppearancePreference) => WorkspaceAppearancePreference) => {
    const next = change(preferenceRef.current);
    preferenceRef.current = next;
    setPreference(next);
    cachePreference(next);
    saveChain.current = saveChain.current.then(() => persistPreference(next));
    return next;
  }, []);

  return { preference, update };
}
