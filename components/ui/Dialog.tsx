"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import Panel from "./Panel";
import { cn } from "./cn";

/**
 * A modal panel over a scrim.
 *
 * Extracted the third time this shell was written by hand (the add-card dialog and the command
 * palette still carry their own, because both trap focus in ways specific to their content). It owns
 * the three things every dialog needs and nobody remembers: Escape closes it, a click on the scrim
 * closes it, and focus returns to whatever opened it.
 *
 * The caller owns `open` — this renders nothing when closed rather than hiding itself, so the
 * content's effects do not run behind a closed dialog.
 */
export default function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** Rendered as the heading AND used as the dialog's accessible name. */
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Captured on open, restored on close: losing focus to the top of the page is disorienting for
  // anyone navigating by keyboard, and invisible to everyone else — so it never gets noticed.
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // jsdom has no layout, and a real browser may not have painted yet; neither should throw.
    panel.current?.focus?.();
    return () => {
      document.removeEventListener("keydown", onKey);
      opener.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-16"
      // Only a click that STARTS and ends on the scrim closes: a drag that begins inside the panel
      // and releases outside it is a text selection, not a dismissal.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Panel
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={cn("w-full max-w-lg outline-none", className)}
      >
        <div className="flex flex-col gap-4">
          <h2 id={headingId} className="font-display text-title leading-none text-ink">
            {title}
          </h2>
          {children}
        </div>
      </Panel>
    </div>
  );
}
