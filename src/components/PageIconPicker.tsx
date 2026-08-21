"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCustomPageIconAction } from "@/app/actions";
import { useLanguage } from "@/components/LanguageProvider";

const SUGGESTED = ["📄", "📝", "📌", "⭐", "🚀", "💡", "🎯", "📊", "📁", "🗂️", "🔥", "✅", "📅", "🧠", "💰", "🏷️", "🔗", "📈", "🛠️", "🌱", "🎨"];

// Notion-style page icon: click the emoji to open a picker; pick one or type
// your own. Persists to the registry note so the sidebar shows it.
export function PageIconPicker({ slug, icon: initial }: { slug: string; icon: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [icon, setIcon] = useState(initial || "📄");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function save(next: string) {
    const clean = [...next.trim()].slice(0, 2).join("") || "📄";
    const previous = icon;
    setError("");
    setIcon(clean);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("slug", slug);
      formData.set("icon", clean);
      const result = await setCustomPageIconAction(formData);
      if (!result?.ok) {
        setIcon(previous);
        setError(result?.error || t("notes.iconSaveFailed"));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="page-icon-pick" ref={ref}>
      <button type="button" className="page-icon-btn" onClick={() => setOpen((v) => !v)} title={t("notes.pageIcon")} disabled={pending}>
        {icon}
      </button>
      {open && (
        <div className="page-icon-pop">
          <input
            autoFocus
            defaultValue=""
            placeholder={t("notes.pasteEmoji")}
            onChange={(event) => {
              if (event.target.value.trim()) {
                save(event.target.value);
                setOpen(false);
              }
            }}
          />
          <div className="page-icon-grid">
            {SUGGESTED.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  save(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
      {error ? <span className="page-icon-error" role="alert">{error}</span> : null}
    </div>
  );
}
