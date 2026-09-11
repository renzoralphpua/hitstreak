"use client";
import { useSyncExternalStore } from "react";
import Icon from "@/components/ui/Icon";

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
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
