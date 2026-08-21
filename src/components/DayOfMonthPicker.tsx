"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/components/LanguageProvider";

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

// Subscriptions used to store a full YYYY-MM-DD due date, which is more
// precision than "which day does the card get charged" needs. Pull the day
// out of old values so existing data still shows a selection.
function dayFromValue(value: string): number | null {
  const isoMatch = /^\d{4}-\d{2}-(\d{2})$/.exec(value.trim());
  if (isoMatch) return Number(isoMatch[1]);
  const bare = Number(value.trim());
  return Number.isInteger(bare) && bare >= 1 && bare <= 31 ? bare : null;
}

export function DayOfMonthPicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const { locale } = useLanguage();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [placement, setPlacement] = useState<"above" | "below">("below");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedDay = dayFromValue(value);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const openAbove = below < 230 && above > below;
      const menuWidth = Math.min(232, window.innerWidth - 24);
      const menuLeft = Math.min(Math.max(12, rect.left), window.innerWidth - menuWidth - 12);
      setPlacement(openAbove ? "above" : "below");
      setMenuStyle({
        position: "fixed",
        left: menuLeft,
        width: menuWidth,
        ...(openAbove ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  function choose(day: number) {
    onChange(String(day));
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className={`custom-select day-picker ${open ? "is-open" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="custom-select-value">
          <span>{selectedDay ? (locale === "fr" ? `Le ${selectedDay}` : `Day ${selectedDay}`) : (locale === "fr" ? "Choisir un jour" : "Choose a day")}</span>
        </span>
      </button>
      {open && createPortal((
        <div
          className="day-picker-menu"
          data-placement={placement}
          ref={menuRef}
          style={menuStyle}
          role="dialog"
          aria-label={locale === "fr" ? "Jour du mois" : "Day of month"}
        >
          <div className="day-picker-grid">
            {DAYS.map((day) => (
              <button
                key={day}
                type="button"
                className={`day-picker-cell ${day === selectedDay ? "is-selected" : ""}`}
                onClick={() => choose(day)}
              >
                {day}
              </button>
            ))}
          </div>
          {selectedDay !== null && (
            <button
              type="button"
              className="day-picker-clear"
              onClick={() => {
                onChange("");
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              {locale === "fr" ? "Effacer" : "Clear"}
            </button>
          )}
        </div>
      ), document.body)}
    </div>
  );
}
