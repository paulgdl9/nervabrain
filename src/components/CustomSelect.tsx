"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export type CustomSelectOption = {
  value: string;
  label: string;
  icon?: React.ReactNode;
  hint?: string;
};

export function CustomSelect({
  name,
  options,
  value,
  defaultValue,
  onChange,
  disabled = false,
  searchable = false,
  searchPlaceholder,
}: {
  name: string;
  options: CustomSelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(defaultValue || options[0]?.value || "");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [placement, setPlacement] = useState<"above" | "below">("below");
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const triggerId = useId();
  const currentValue = value ?? internalValue;
  const selected = options.find((option) => option.value === currentValue) || {
    value: currentValue,
    label: currentValue,
  };
  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((option) => `${option.label} ${option.hint || ""}`.toLocaleLowerCase().includes(needle));
  }, [options, query]);

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

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => (searchable ? searchRef.current : menuRef.current)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, filteredOptions, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const openAbove = below < 190 && above > below;
      const menuWidth = Math.min(Math.max(rect.width, 260), Math.min(360, window.innerWidth - 24));
      const menuLeft = Math.min(Math.max(12, rect.left), window.innerWidth - menuWidth - 12);
      setPlacement(openAbove ? "above" : "below");
      setMenuStyle({
        position: "fixed",
        left: menuLeft,
        width: menuWidth,
        maxHeight: Math.min(320, Math.max(150, openAbove ? above - 6 : below - 6)),
        ...(openAbove ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    };
    // Keep the menu glued to its trigger while the page scrolls instead of
    // closing abruptly (that read as "both move / bug" on trackpad momentum).
    // Only bail out once the trigger has scrolled fully out of view.
    const followOnScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect && (rect.bottom < 0 || rect.top > window.innerHeight)) {
        setOpen(false);
        return;
      }
      positionMenu();
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", followOnScroll, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", followOnScroll, true);
    };
  }, [open]);

  function choose(nextValue: string) {
    if (value === undefined) setInternalValue(nextValue);
    onChange?.(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveActive(direction: -1 | 1) {
    if (!filteredOptions.length) return;
    setActiveIndex((current) => (current + direction + filteredOptions.length) % filteredOptions.length);
  }

  function openMenu(direction?: -1 | 1) {
    if (!options.length) return;
    const selectedIndex = Math.max(0, options.findIndex((option) => option.value === currentValue));
    setQuery("");
    setActiveIndex(direction ? (selectedIndex + direction + options.length) % options.length : selectedIndex);
    setOpen(true);
  }

  return (
    <div className={`custom-select ${open ? "is-open" : ""}`} ref={rootRef}>
      <input type="hidden" name={name} value={currentValue} />
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="custom-select-trigger"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (open) moveActive(event.key === "ArrowDown" ? 1 : -1);
            else openMenu(event.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        <span className="custom-select-value">
          {selected.icon && <span className="custom-select-icon">{selected.icon}</span>}
          <span>{selected.label}</span>
        </span>
        <ChevronDown className="custom-select-chevron" size={15} aria-hidden />
      </button>
      {open && createPortal((
        <div
          className={`custom-select-menu${searchable ? " has-search" : ""}`}
          data-placement={placement}
          ref={menuRef}
          style={menuStyle}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={triggerId}
          aria-activedescendant={`${listId}-option-${activeIndex}`}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              moveActive(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              setActiveIndex(event.key === "Home" ? 0 : filteredOptions.length - 1);
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (filteredOptions[activeIndex]) choose(filteredOptions[activeIndex].value);
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          {searchable ? (
            <label className="custom-select-search">
              <Search size={15} aria-hidden />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    moveActive(event.key === "ArrowDown" ? 1 : -1);
                  } else if (event.key === "Enter" && filteredOptions[activeIndex]) {
                    event.preventDefault();
                    choose(filteredOptions[activeIndex].value);
                  }
                }}
            placeholder={searchPlaceholder || t("common.searchPlaceholder")}
                aria-label={searchPlaceholder}
              />
            </label>
          ) : null}
          <div className="custom-select-options">
          {filteredOptions.map((option, index) => (
            <button
              ref={(node) => { optionRefs.current[index] = node; }}
              id={`${listId}-option-${index}`}
              type="button"
              className={`custom-select-option ${index === activeIndex ? "is-active" : ""}`}
              role="option"
              aria-selected={option.value === currentValue}
              tabIndex={-1}
              key={option.value}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(option.value)}
            >
              {option.icon && <span className="custom-select-icon">{option.icon}</span>}
              <span className="custom-select-option-copy">
                <strong>{option.label}</strong>
                {option.hint && <small>{option.hint}</small>}
              </span>
              {option.value === currentValue && <span className="custom-select-check"><Check size={13} aria-hidden /></span>}
            </button>
          ))}
          {!filteredOptions.length ? <p className="custom-select-empty">{t("common.noResults")}</p> : null}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
