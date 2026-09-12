"use client";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";
import { cn } from "./cn";

/**
 * Closing is passed down rather than caught by a click on the panel.
 *
 * A menu item must stop propagation — the tile behind it is a link, and choosing "Rename" should not
 * also navigate — which means a click handler on the panel would never see the event. So the panel
 * hands each item the means to close itself.
 */
const CloseMenu = createContext<() => void>(() => {});

/**
 * The actions that do not earn a button of their own, behind three dots.
 *
 * Deliberately NOT a generic popover: the trigger is always the overflow glyph, the content is
 * always a vertical list of actions, and the menu closes as soon as one is chosen. A tile that needs
 * a different kind of popover needs a different component, not an option on this one.
 *
 * `align` exists because the trigger usually sits at the right edge of a tile, where a left-aligned
 * panel would hang off the card.
 */
export default function MenuButton({
  label = "More actions",
  align = "end",
  children,
  className,
}: {
  /** The trigger's accessible name. Say what it acts ON — "Actions for Main Binder". */
  label?: string;
  align?: "start" | "end";
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Capture phase: an item that stops propagation must not be able to leave the menu stuck open.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          // The tile behind this is usually a link; opening a menu must not follow it.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full text-muted transition-colors",
          "hover:bg-hairline-soft hover:text-ink",
          open && "bg-hairline-soft text-ink"
        )}
      >
        <Icon name="more" size="md" />
      </button>

      {open && (
        <div
          id={id}
          role="menu"
          className={cn(
            "absolute top-9 z-50 flex min-w-44 flex-col gap-0.5 rounded-tile border border-hairline bg-surface p-1 shadow-tile",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          <CloseMenu.Provider value={() => setOpen(false)}>{children}</CloseMenu.Provider>
        </div>
      )}
    </div>
  );
}

/**
 * One action inside a {@link MenuButton}.
 *
 * `tone="danger"` is for the irreversible one. It is styled, not merely placed last — a destructive
 * item that is only distinguished by position is easy to hit by accident.
 */
export function MenuItem({
  onClick,
  tone = "default",
  children,
}: {
  onClick: () => void;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  const close = useContext(CloseMenu);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
        onClick();
      }}
      className={cn(
        "w-full rounded-[10px] px-3 py-2 text-left text-base transition-colors",
        tone === "danger" ? "text-accent hover:bg-accent/10" : "text-ink hover:bg-hairline-soft"
      )}
    >
      {children}
    </button>
  );
}
