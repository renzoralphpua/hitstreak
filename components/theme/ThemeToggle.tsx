"use client";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

// Tiny external store over <html data-theme>. useSyncExternalStore keeps this
// hydration-safe (server snapshot is "light"; the client re-renders to the real
// value) without a setState-in-effect, and lets the click re-render synchronously.
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = (): Theme => (document.documentElement.dataset.theme as Theme) || "light";
const getServerSnapshot = (): Theme => "light";

/** Writes the same `theme` key the root layout's no-flash script reads. */
function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* storage blocked — theme still applies for this page */
  }
  listeners.forEach((l) => l());
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-hairline text-muted hover:text-ink md:h-9 md:w-9"
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
