"use client";
import { useCallback, useSyncExternalStore } from "react";

/**
 * A preference that survives a reload without appearing in the URL.
 *
 * View mode, filters, folded sections and an in-page search are how YOU like to look at a page, not
 * what the page is — putting them in the query string makes every link you copy carry your habits,
 * and turns a filter into a navigation. They live in localStorage instead. What stays in the URL is
 * what the server needs in order to fetch: `?game=`, `?range=`, `?p=`.
 *
 * Built on `useSyncExternalStore` rather than an effect, the same way `ThemeToggle` reads the theme:
 * the server snapshot is the fallback, the client's first read is the stored value, and nothing
 * calls setState during render or in an effect body.
 *
 * `validate` is not politeness. localStorage is user-writable and outlives deploys, so a value
 * written by an older version of this app must not be trusted to still be a legal one.
 */

/** Parsed values, cached per key. `useSyncExternalStore` compares snapshots with `Object.is`, so
 *  re-parsing on every read would hand back a fresh array each time and spin forever. */
const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  for (const l of listeners.get(key) ?? []) l();
}

// Another tab writing the same key should be reflected here, not silently diverge.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key == null) return;
    cache.delete(e.key);
    notify(e.key);
  });
}

export function usePersisted<T>(
  key: string,
  fallback: T,
  validate: (raw: unknown) => T | null
): [T, (next: T) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const set = listeners.get(key) ?? new Set();
      set.add(onChange);
      listeners.set(key, set);
      return () => set.delete(onChange);
    },
    [key]
  );

  const getSnapshot = useCallback((): T => {
    if (cache.has(key)) return cache.get(key) as T;
    let value = fallback;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) value = validate(JSON.parse(raw)) ?? fallback;
    } catch {
      /* private mode, blocked storage, or unparsable leftovers — the fallback stands */
    }
    cache.set(key, value);
    return value;
  }, [key, fallback, validate]);

  // The server has no storage, so it renders the fallback; the client swaps on hydration.
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: T) => {
      cache.set(key, next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* the preference simply will not outlive this page */
      }
      notify(key);
    },
    [key]
  );

  return [value, set];
}
