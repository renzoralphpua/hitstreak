"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { formatMoney } from "@/lib/format";
import type { PrintingPrice } from "@/lib/catalog";
import Icon from "./Icon";
import SearchField from "./SearchField";
import { cn } from "./cn";

interface Hit {
  cardId: number; name: string; number: string | null; rarity: string | null;
  setName: string; imageUrl: string | null; owned: number; printings: PrintingPrice[];
}
interface Jump { kind: "set" | "deck"; id: number; name: string; caption: string }

/** A row is whatever the keyboard can land on; `href` is where Enter goes. */
interface Row {
  key: string;
  href: string;
  name: string;
  caption: string;
  right?: string;
  imageUrl?: string | null;
  icon?: "grid" | "decks";
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;
const lowest = (ps: PrintingPrice[]) =>
  ps.reduce<number | null>((lo, p) => (p.market != null && (lo == null || p.market < lo) ? p.market : lo), null);

/**
 * Search from anywhere: ⌘K, or the pill in the top bar.
 *
 * It NAVIGATES and nothing else. An earlier draft gave each result an action menu — add to
 * collection, add to deck, set an alert — and it was dropped: every one of those needs a different
 * form (a collection add needs printing, condition, quantity and what you paid), so a menu of forms
 * is just a worse router. Enter opens the card page, which already holds all of it.
 *
 * Results come back in three groups because they answer different questions: what do I own, what
 * exists, and where do I want to go. Owned rows carry their copy count, which is the fastest way to
 * tell "I have this" from "I could have this".
 */
export default function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  // Openness is DERIVED, not stored: the palette is open while the path it opened on is still the
  // path you are on. Navigating therefore closes it with no effect and no cascading render — Enter
  // routes, and a palette left hanging over the new page would look like the navigation failed.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const [query, setQuery] = useState("");
  // Results carry the query they answer, the way useCardSearch does, so a stale page is simply not
  // shown rather than being cleared — which keeps every synchronous setState out of the effect body.
  const [results, setResults] = useState<{ tag: string; hits: Hit[]; jump: Jump[] } | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const close = useCallback(() => setOpenedAt(null), []);
  // Opening clears everything here rather than in an effect watching `open`: the reset belongs to
  // the act of opening, and doing it in an effect is a second render for no reason.
  const openPalette = useCallback(() => {
    setQuery("");
    setResults(null);
    setFailedFor(null);
    setCursor(0);
    setOpenedAt(pathname);
  }, [pathname]);

  // ⌘K anywhere, and Escape out of it. Bound on the document so it works wherever focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (openedAt === null) openPalette();
        else close();
      } else if (e.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openedAt, openPalette, close]);

  const q = query.trim();
  const settled = results?.tag === q;
  const failed = failedFor === q;
  const loading = open && q.length >= MIN_QUERY && !settled && !failed;

  useEffect(() => {
    if (!open || q.length < MIN_QUERY) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?jump=1&q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        if (!live) return;
        setResults({ tag: q, hits: body.hits ?? [], jump: body.jump ?? [] });
        // A retry that succeeds must clear the banner the previous attempt left.
        setFailedFor(null);
        setCursor(0);
      } catch {
        if (live) setFailedFor(q);
      }
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, open]);

  // `from` is this page, so the card screen's back arrow returns here rather than to the card's set.
  const from = encodeURIComponent(pathname);
  const groups = useMemo(() => {
    // Unsettled results belong to a previous query, so they are simply not shown — building the
    // arrays inside the memo keeps a fresh [] from invalidating it on every render.
    const hits = settled ? (results?.hits ?? []) : [];
    const jump = settled ? (results?.jump ?? []) : [];
    const owned = hits.filter((h) => h.owned > 0);
    const catalog = hits.filter((h) => h.owned === 0);
    const toRow = (h: Hit): Row => ({
      key: `card-${h.cardId}`,
      href: `/cards/${h.cardId}?from=${from}`,
      name: h.name,
      caption: [h.setName, h.number, h.rarity].filter(Boolean).join(" · "),
      right: formatMoney(lowest(h.printings)),
      imageUrl: h.imageUrl,
    });
    return [
      { label: "In your collection", rows: owned.map((h) => ({ ...toRow(h), right: `×${h.owned}` })) },
      { label: "In the catalog", rows: catalog.map(toRow) },
      {
        label: "Go to",
        rows: jump.map<Row>((j) => ({
          key: `${j.kind}-${j.id}`,
          href: j.kind === "set" ? `/sets/${j.id}` : `/decks/${j.id}`,
          name: j.name,
          caption: j.caption,
          icon: j.kind === "set" ? "grid" : "decks",
        })),
      },
    ].filter((g) => g.rows.length > 0);
  }, [results, settled, from]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  const go = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      close();
      router.push(row.href);
    },
    [router, close]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (flat.length === 0 ? 0 : (c + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (flat.length === 0 ? 0 : (c - 1 + flat.length) % flat.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(flat[cursor]);
    }
  };

  useEffect(() => {
    // Optional call, not optional chaining on the element: scrollIntoView is absent in jsdom and
    // keeping the active row visible is a nicety, never a reason to throw mid-keystroke.
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView?.({ block: "nearest" });
  }, [cursor]);

  return (
    <>
      {/* The visible affordance. Hidden on phones, where the top bar has no room and ⌘K has no
          keyboard — the tab bar is how you get around there. */}
      <button
        type="button"
        onClick={openPalette}
        className="hidden w-72 items-center gap-2.5 rounded-full bg-hairline-soft px-3.5 py-2 text-caption text-dim hover:text-muted md:flex"
      >
        <Icon name="search" />
        <span>Find a card…</span>
        <kbd className="ml-auto rounded border border-hairline px-1.5 py-0.5 text-micro">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-16"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="flex w-full max-w-xl flex-col overflow-hidden rounded-panel border border-hairline bg-surface shadow-art"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onKeyDown}
          >
            <div className="border-b border-hairline-soft p-3">
              <SearchField value={query} onChange={setQuery} placeholder="Search cards, sets and decks…" autoFocus />
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {q.length < MIN_QUERY ? (
                <p className="p-4 text-caption text-dim">Type at least {MIN_QUERY} characters. Try a name, a number, or a rarity like “SIR”.</p>
              ) : failed ? (
                <p role="alert" className="p-4 text-base text-accent">Could not search right now. Try again.</p>
              ) : flat.length === 0 ? (
                <p className="p-4 text-base text-dim">{loading ? "Searching…" : `Nothing matches “${q}”.`}</p>
              ) : (
                <ul ref={listRef} className="flex flex-col p-2">
                  {groups.map((g) => (
                    <li key={g.label}>
                      <p className="px-2 py-1.5 text-micro font-semibold uppercase tracking-label text-muted">{g.label}</p>
                      <ul className="flex flex-col">
                        {g.rows.map((row) => {
                          const active = flat[cursor]?.key === row.key;
                          return (
                            <li key={row.key}>
                              <button
                                type="button"
                                data-active={active}
                                onMouseEnter={() => setCursor(flat.findIndex((r) => r.key === row.key))}
                                onClick={() => go(row)}
                                className={cn(
                                  "flex w-full items-center gap-3 rounded-tile px-2 py-1.5 text-left",
                                  active ? "bg-chip text-chip-ink" : "hover:bg-hairline-soft"
                                )}
                              >
                                {row.icon ? (
                                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-tile bg-hairline-soft text-muted">
                                    <Icon name={row.icon} size="md" />
                                  </span>
                                ) : (
                                  <span
                                    aria-hidden
                                    className="h-12 w-9 shrink-0 rounded bg-hairline-soft bg-cover bg-center"
                                    style={row.imageUrl ? { backgroundImage: `url(${row.imageUrl})` } : undefined}
                                  />
                                )}
                                <span className="flex min-w-0 flex-col">
                                  <span className="truncate font-medium">{row.name}</span>
                                  <span className={cn("truncate text-caption", active ? "text-chip-ink-muted" : "text-dim")}>
                                    {row.caption}
                                  </span>
                                </span>
                                {row.right && <span className="num ml-auto shrink-0 text-caption font-semibold">{row.right}</span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-hairline-soft bg-ground px-3 py-2 text-micro text-dim">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span className="ml-auto">esc close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
