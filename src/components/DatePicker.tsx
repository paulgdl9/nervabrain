"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

function parseIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function DatePicker({
  name,
  value,
  onChange,
  min = "",
  locale = "fr",
  placeholder = "Choisir une date",
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  locale?: "fr" | "en";
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const selected = parseIso(value);
  const minimum = parseIso(min);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const base = selected || minimum || new Date();
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    const position = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(330, window.innerWidth - 24);
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
      const below = window.innerHeight - rect.bottom;
      setMenuStyle({
        position: "fixed",
        width,
        left,
        ...(below < 390 && rect.top > below ? { bottom: window.innerHeight - rect.top + 7 } : { top: rect.bottom + 7 }),
      });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  const year = visibleMonth.getUTCFullYear();
  const month = visibleMonth.getUTCMonth();
  const leading = (visibleMonth.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const days = Array.from({ length: leading + daysInMonth }, (_, index) => index < leading ? null : index - leading + 1);
  const labels = locale === "fr" ? ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const formatted = selected?.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  function shiftMonth(delta: number) {
    setVisibleMonth(new Date(Date.UTC(year, month + delta, 1)));
  }

  return (
    <div className={`custom-date-picker ${open ? "is-open" : ""}`} ref={rootRef}>
      <input type="hidden" name={name} value={value} />
      <button
        ref={triggerRef}
        type="button"
        className="custom-date-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (!open) {
            const base = selected || minimum || new Date();
            setVisibleMonth(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)));
          }
          setOpen((current) => !current);
        }}
      >
        <CalendarDays size={16} aria-hidden />
        <span className={formatted ? "" : "is-placeholder"}>{formatted || placeholder}</span>
      </button>
      {open && createPortal((
        <div className="custom-date-menu" ref={menuRef} role="dialog" aria-label={placeholder} style={menuStyle}>
          <div className="custom-date-head">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label={locale === "fr" ? "Mois précédent" : "Previous month"}><ChevronLeft size={17} /></button>
            <strong>{visibleMonth.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</strong>
            <button type="button" onClick={() => shiftMonth(1)} aria-label={locale === "fr" ? "Mois suivant" : "Next month"}><ChevronRight size={17} /></button>
          </div>
          <div className="custom-date-weekdays">{labels.map((label) => <span key={label}>{label}</span>)}</div>
          <div className="custom-date-grid">
            {days.map((day, index) => {
              if (!day) return <span key={`blank-${index}`} />;
              const date = new Date(Date.UTC(year, month, day));
              const dateIso = iso(date);
              const disabled = Boolean(minimum && date < minimum);
              return (
                <button
                  type="button"
                  key={dateIso}
                  disabled={disabled}
                  className={`${dateIso === value ? "is-selected" : ""}${dateIso === iso(new Date()) ? " is-today" : ""}`}
                  onClick={() => { onChange(dateIso); setOpen(false); triggerRef.current?.focus(); }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
