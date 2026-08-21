"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type AnchorRect = Pick<DOMRect, "top" | "bottom" | "left" | "width">;

export function getWorkspacePopoverPosition(rect: AnchorRect, viewportWidth: number, viewportHeight: number) {
  const gutter = 12;
  const gap = 6;
  const availableWidth = Math.max(0, viewportWidth - gutter * 2);
  const width = Math.min(Math.max(rect.width, 200), Math.min(280, availableWidth));
  const below = Math.max(0, viewportHeight - rect.bottom - gap - gutter);
  const above = Math.max(0, rect.top - gap - gutter);
  const placement = below < 180 && above > below ? "above" as const : "below" as const;
  const left = Math.min(Math.max(gutter, rect.left), Math.max(gutter, viewportWidth - width - gutter));

  return {
    placement,
    left,
    width,
    maxHeight: Math.min(360, placement === "above" ? above : below),
    top: placement === "below" ? rect.bottom + gap : undefined,
    bottom: placement === "above" ? viewportHeight - rect.top + gap : undefined,
  };
}

export function WorkspacePopover({
  anchor,
  children,
  onClose,
}: {
  anchor: HTMLElement | null;
  children: ReactNode;
  onClose: () => void;
}) {
  const [position, setPosition] = useState<ReturnType<typeof getWorkspacePopoverPosition> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const restoreFocusRef = useRef(true);

  useLayoutEffect(() => { closeRef.current = onClose; });

  useLayoutEffect(() => {
    if (!anchor) return;
    restoreFocusRef.current = true;
    const menu = menuRef.current;

    const positionMenu = () => setPosition(getWorkspacePopoverPosition(anchor.getBoundingClientRect(), window.innerWidth, window.innerHeight));
    const followOnScroll = (event: Event) => {
      if (event.target instanceof Node && menu?.contains(event.target)) return;
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        restoreFocusRef.current = false;
        closeRef.current();
        return;
      }
      setPosition(getWorkspacePopoverPosition(rect, window.innerWidth, window.innerHeight));
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu?.contains(target) || anchor.contains(target)) return;
      restoreFocusRef.current = false;
      closeRef.current();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      restoreFocusRef.current = true;
      closeRef.current();
    };

    positionMenu();
    const frame = window.requestAnimationFrame(() => menu?.focus());
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", followOnScroll, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", followOnScroll, true);
      const focusWasInside = menu?.contains(document.activeElement) ?? false;
      if (restoreFocusRef.current && focusWasInside && anchor.isConnected) {
        window.requestAnimationFrame(() => anchor.focus());
      }
    };
  }, [anchor]);

  if (!anchor || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="obj-popover"
      data-placement={position?.placement || "below"}
      ref={menuRef}
      role="dialog"
      aria-label={anchor.getAttribute("aria-label") || anchor.textContent?.trim() || "Options"}
      tabIndex={-1}
      style={{
        position: "fixed",
        top: position?.top ?? "auto",
        right: "auto",
        bottom: position?.bottom ?? "auto",
        left: position?.left ?? 0,
        width: position?.width,
        minWidth: position?.width,
        maxWidth: position?.width,
        maxHeight: position?.maxHeight,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
