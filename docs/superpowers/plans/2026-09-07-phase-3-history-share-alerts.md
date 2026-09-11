# Hitstreak Phase 3 — Price History, Collection History, Share Links, Alerts, Sign-up Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the accumulated price data visible and useful: per-card and per-collection value history charts, a nightly job that materializes collection value and evaluates email price alerts, read-only share links for collections, and a sign-up gate so the app can be reachable at a public domain without open registration.

**Architecture:** Three new tables (`collection_history`, `share_links`, `price_alerts`) join the self-initializing schema. History reads live in `lib/history.ts` and honour write-on-change semantics (a series is the carry-in point plus every change in the window; readers step forward). Charts are one new primitive, `LineChart` — a token-coloured SVG step line — plus `RangePills` (`?range=` links, so charts are server-rendered with no client state). The nightly job is `ingest/nightly.ts`, run as a **second step of the existing GitHub Actions "Daily price ingest" job** right after the ingest (it already holds the DB credentials; no HTTP endpoint, no shared secret, no Vercel function limits — a deliberate spec deviation, see "Spec amendments"). Alerts are a pure `evaluateAlert()` state machine (`armed` flag; fire on an inclusive crossing, re-arm when strictly back over the line) wrapped by a Resend mailer with a fake in tests. Share links are 128-bit base64url tokens; `/s/[token]` lives outside `(app)` and exposes exactly one collection at market value with cost basis stripped. The sign-up gate is a Better Auth `hooks.before` allowlist driven by `SIGNUP_ALLOWLIST`.

**Tech Stack:** Next.js 16 App Router (server actions, `searchParams`, `PageProps` generated types), React 19, Tailwind v4 tokens, libSQL, Better Auth 1.7.3 (`hooks.before`, `createAuthMiddleware`, `APIError` from `better-auth/api`), Resend REST API via `fetch` (no SDK), GitHub Actions, vitest + Testing Library.

**Reference:** Spec §5 (data model: `collection_history`, `share_links`, `price_alerts`), §6 step 5 (nightly), §7 (collections chart, card detail chart + "which collections hold it" + alert shortcut, sharing, alerts), §9 (idempotent nightly, alert retry semantics, share 404s), §10 (alert threshold/re-arm unit tests, share-token boundary tests), §13 (gate sign-up). Mockups: `docs/design/Main.dc.html` (collection chart + range row), `Card.dc.html` (price history panel with Low/High), `Alerts.dc.html` (Triggered/Watching lists, New alert panel, "How alerts work").

**Conventions:** as Phase 2b. Every data-layer function that touches user data takes `userId` first and scopes through `collections.user_id` / `price_alerts.user_id`. Server actions return `{ ok, error }` and re-check the session. Money stays `REAL` dollars. DB tests use `tmpDb()` + `seedMiniCatalog()`; component tests are `tests/ui/*.test.tsx` with `// @vitest-environment jsdom` on line 1. Verify each task with `npm test`, `npm run typecheck`, `npm run lint`; commit after each green task on branch `phase-3/history-share-alerts`.

**Deferred to Phase 4 (do NOT build here):** decks, gap analysis, builder, validators, admin curation. Also not here: wishlists, CSV, graded values, push notifications, movers/shakers.

---

## File structure

```
lib/schema.ts                         + HISTORY_SCHEMA_SQL: collection_history, share_links, price_alerts
lib/db.ts                             runs HISTORY_SCHEMA_SQL too
lib/history.ts                        RANGES, parseRange, rangeStart, getPrintingHistory, getCollectionHistory, seriesStats
lib/collections.ts                     deleteCollection also clears collection_history + share_links; getCardHolders
lib/share.ts                          getShareLink, enableShare, regenerateShare, disableShare, getSharedCollection, isShareToken
lib/alerts.ts                         DIRECTIONS, evaluateAlert (pure), listAlerts, createAlert, deleteAlert, getAlertCard
lib/action-utils.ts                   withUser, assertId, ActionResult (moved out of collections/actions.ts)
lib/signup-gate.ts                    parseAllowlist, signupAllowed
lib/auth.ts                           hooks.before → 403 when SIGNUP_ALLOWLIST excludes the email
ingest/mailer.ts                      Mailer interface, createResendMailer (fetch), mailerFromEnv, alertEmail
ingest/nightly.ts                     materializeCollectionHistory, processAlerts, runNightly, CLI
.github/workflows/daily-ingest.yml    + nightly step (if: !cancelled()), RESEND_API_KEY / ALERT_FROM_EMAIL / APP_URL
components/ui/LineChart.tsx           new primitive: SVG step line from Point[] over [from, to]
components/ui/RangePills.tsx          new primitive: 7D 30D 90D 1Y All as Pill hrefs
components/ui/Pill.tsx                + scroll prop (href variant)
components/ui/CardRow.tsx             + tone="inverted" (triggered alert rows)
components/ui/useCardSearch.ts        shared debounced /api/search hook (AddItemDialog + NewAlertForm)
components/ui/index.ts                exports
app/dev/ui/page.tsx                   gallery: LineChart, RangePills, CardRow inverted
app/(app)/cards/[id]/page.tsx         price history panel (range + printing), "In your collections", "Set alert"
app/(app)/collections/[id]/page.tsx    value chart + range row, SharePanel
app/(app)/collections/[id]/SharePanel.tsx   client: on/off, copy, regenerate
app/(app)/collections/actions.ts       + enableShareAction, regenerateShareAction, disableShareAction
app/s/[token]/page.tsx                public read-only collection (no auth, noindex)
app/(app)/alerts/page.tsx             Triggered / Watching + New alert + How alerts work
app/(app)/alerts/actions.ts           createAlertAction, deleteAlertAction
app/(app)/alerts/AlertList.tsx        client: grouped rows + delete
app/(app)/alerts/NewAlertForm.tsx     client: search → printing → direction → threshold → create
app/(auth)/sign-up/page.tsx           "invite-only" note when gated
tests/history.test.ts, tests/share.test.ts, tests/alerts.test.ts, tests/nightly.test.ts, tests/mailer.test.ts,
tests/signup-gate.test.ts, tests/share-actions.test.ts, tests/alert-actions.test.ts, tests/proxy.test.ts (+1)
tests/ui/line-chart.test.tsx, range-pills.test.tsx, share-panel.test.tsx, alert-list.test.tsx, new-alert-form.test.tsx,
tests/ui/card-row-tone.test.tsx
```

---

### Task 1: Schema + history data layer

**Files:** modify `lib/schema.ts`, `lib/db.ts`, `lib/collections.ts`; create `lib/history.ts`, `tests/history.test.ts`

- [x] **Step 1: Schema.** Append to `lib/schema.ts`:

```ts
// Phase 3: materialized collection value, share links, price alerts. FKs are documentation (unenforced
// in SQLite); lib/collections.ts deleteCollection clears the two collection-scoped tables itself.
export const HISTORY_SCHEMA_SQL = `
  -- One row per collection per day, written by ingest/nightly.ts (value as of that day's prices).
  CREATE TABLE IF NOT EXISTS collection_history (
    collection_id INTEGER NOT NULL REFERENCES collections(id),
    date TEXT NOT NULL,             -- YYYY-MM-DD
    total_value REAL NOT NULL,      -- dollars; unpriced copies contribute nothing
    PRIMARY KEY (collection_id, date)
  );

  -- One link per collection. Disabled links 404; regenerating replaces the token.
  CREATE TABLE IF NOT EXISTS share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL UNIQUE REFERENCES collections(id),
    token TEXT NOT NULL UNIQUE,     -- 16 random bytes, base64url (22 chars)
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS price_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    printing_id INTEGER NOT NULL REFERENCES printings(id),
    direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
    threshold REAL NOT NULL CHECK (threshold > 0),   -- dollars
    armed INTEGER NOT NULL DEFAULT 1,  -- 1 = emails on the next crossing; 0 = fired, waiting to re-arm
    last_fired_at TEXT,                -- ISO timestamp of the last email
    last_fired_price REAL,             -- the market price that triggered it
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_user ON price_alerts(user_id);
  CREATE INDEX IF NOT EXISTS idx_alerts_printing ON price_alerts(printing_id);
`;
```

In `lib/db.ts` import it and run `SCHEMA_SQL + AUTH_SCHEMA_SQL + COLLECTION_SCHEMA_SQL + HISTORY_SCHEMA_SQL`; update the comment.

- [x] **Step 2: Cascade.** In `lib/collections.ts` `deleteCollection`, add to the batch before the collections delete:

```ts
      { sql: "DELETE FROM collection_history WHERE collection_id = ?", args: [id] },
      { sql: "DELETE FROM share_links WHERE collection_id = ?", args: [id] },
```

Also add (spec §7 "which collections hold it"):

```ts
export interface CardHolder { collectionId: number; name: string; quantity: number }
/** The signed-in user's collections that hold any printing of `cardId`, with total copies. */
export async function getCardHolders(userId: string, cardId: number): Promise<CardHolder[]> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT po.id, po.name, SUM(ci.quantity) AS quantity
          FROM collection_items ci
          JOIN collections po ON po.id = ci.collection_id AND po.user_id = ?
          JOIN printings p ON p.id = ci.printing_id
          WHERE p.card_id = ?
          GROUP BY po.id ORDER BY quantity DESC, po.name`,
    args: [userId, cardId],
  });
  return r.rows.map((x) => ({ collectionId: Number(x.id), name: String(x.name), quantity: Number(x.quantity) }));
}
```

- [x] **Step 3: Failing tests** — `tests/history.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("history");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { createCollection, addItem, deleteCollection, getCardHolders } from "@/lib/collections";
import { RANGES, RANGE_CAPTION, parseRange, rangeStart, chartFrom, withLivePoint, getPrintingHistory, getCollectionHistory, seriesStats, HISTORY_EPOCH } from "@/lib/history";

let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
beforeAll(async () => { seed = await seedMiniCatalog(); });
afterAll(() => { closeDb(); tmp.clean(); });

describe("ranges", () => {
  it("parses known ranges and falls back to 30d", () => {
    for (const r of RANGES) expect(parseRange(r)).toBe(r);
    expect(parseRange("1w")).toBe("30d");
    expect(parseRange(undefined)).toBe("30d");
    expect(parseRange(["7d"])).toBe("30d");
  });
  it("computes the inclusive start date in UTC", () => {
    expect(rangeStart("7d", "2026-09-07")).toBe("2026-08-31");
    expect(rangeStart("30d", "2026-09-07")).toBe("2026-08-08");
    expect(rangeStart("90d", "2026-09-07")).toBe("2026-06-09");
    expect(rangeStart("1y", "2026-09-07")).toBe("2025-09-07");
    expect(rangeStart("all", "2026-09-07")).toBe(HISTORY_EPOCH);
    expect(rangeStart("7d", "2026-03-03")).toBe("2026-02-24"); // crosses a month boundary
  });
  it("anchors the All chart to the first point and has prose captions", () => {
    const pts = [{ date: "2026-08-17", value: 1 }, { date: "2026-09-07", value: 2 }];
    expect(chartFrom("all", HISTORY_EPOCH, pts, "2026-09-07")).toBe("2026-08-17");
    expect(chartFrom("all", HISTORY_EPOCH, [], "2026-09-07")).toBe("2026-09-07");
    expect(chartFrom("30d", "2026-08-08", pts, "2026-09-07")).toBe("2026-08-08");
    expect(RANGE_CAPTION.all).toBe("all time");
    expect(RANGE_CAPTION["30d"]).toBe("past 30 days");
  });
});

describe("withLivePoint", () => {
  it("appends today's value to an empty or stale series, never duplicates today's row", () => {
    expect(withLivePoint([], "2026-09-07", 42)).toEqual([{ date: "2026-09-07", value: 42 }]);
    expect(withLivePoint([{ date: "2026-09-06", value: 40 }], "2026-09-07", 42)).toEqual([
      { date: "2026-09-06", value: 40 }, { date: "2026-09-07", value: 42 },
    ]);
    const done = [{ date: "2026-09-07", value: 40 }];
    expect(withLivePoint(done, "2026-09-07", 42)).toEqual(done);
  });
});

describe("getPrintingHistory", () => {
  it("starts with the carried-in value at `from`, then every change inside the window", async () => {
    // seed: umbreon 2026-07-01 → 1100, 2026-09-01 → 1465
    expect(await getPrintingHistory(seed.printings.umbreonHolo, "2026-08-08", "2026-09-07")).toEqual([
      { date: "2026-08-08", value: 1100 },
      { date: "2026-09-01", value: 1465 },
    ]);
  });
  it("has no carry-in when the window starts before the first snapshot", async () => {
    expect(await getPrintingHistory(seed.printings.umbreonHolo, "2026-06-01", "2026-09-07")).toEqual([
      { date: "2026-07-01", value: 1100 },
      { date: "2026-09-01", value: 1465 },
    ]);
  });
  it("does not duplicate a snapshot that falls exactly on `from`", async () => {
    expect(await getPrintingHistory(seed.printings.umbreonHolo, "2026-07-01", "2026-08-01")).toEqual([{ date: "2026-07-01", value: 1100 }]);
  });
  it("keeps null markets as gaps and returns [] for an unknown printing", async () => {
    const c = await db();
    await c.execute("INSERT INTO price_snapshots (printing_id, date, market) VALUES (2, '2026-08-01', 0.2), (2, '2026-08-15', NULL), (2, '2026-09-01', 0.25)");
    expect(await getPrintingHistory(seed.printings.pikachuNormal, "2026-07-01", "2026-09-07")).toEqual([
      { date: "2026-08-01", value: 0.2 }, { date: "2026-08-15", value: null }, { date: "2026-09-01", value: 0.25 },
    ]);
    expect(await getPrintingHistory(99999, "2026-01-01", "2026-09-07")).toEqual([]);
  });
});

describe("getCollectionHistory", () => {
  it("returns the owner's rows in the window and nothing for another user", async () => {
    const p = await createCollection("u1", "Main");
    const c = await db();
    await c.execute({ sql: "INSERT INTO collection_history (collection_id, date, total_value) VALUES (?, '2026-09-05', 100), (?, '2026-09-06', 120), (?, '2026-09-07', 110)", args: [p.id, p.id, p.id] });
    expect(await getCollectionHistory("u1", p.id, "2026-09-06", "2026-09-07")).toEqual([
      { date: "2026-09-06", value: 120 }, { date: "2026-09-07", value: 110 },
    ]);
    expect(await getCollectionHistory("u2", p.id, "2026-09-01", "2026-09-07")).toEqual([]);
  });
  it("deleting the collection removes its history and share link", async () => {
    const p = await createCollection("u1", "Temp");
    const c = await db();
    await c.execute({ sql: "INSERT INTO collection_history (collection_id, date, total_value) VALUES (?, '2026-09-07', 5)", args: [p.id] });
    await c.execute({ sql: "INSERT INTO share_links (collection_id, token) VALUES (?, 'tok')", args: [p.id] });
    expect(await deleteCollection("u1", p.id)).toBe(true);
    expect((await c.execute({ sql: "SELECT COUNT(*) AS n FROM collection_history WHERE collection_id = ?", args: [p.id] })).rows[0].n).toBe(0);
    expect((await c.execute({ sql: "SELECT COUNT(*) AS n FROM share_links WHERE collection_id = ?", args: [p.id] })).rows[0].n).toBe(0);
  });
});

describe("seriesStats", () => {
  it("ignores nulls and reports low/high/first/last/change", () => {
    expect(seriesStats([{ date: "a", value: 10 }, { date: "b", value: null }, { date: "c", value: 15 }])).toEqual({
      low: 10, high: 15, first: 10, last: 15, change: { amount: 5, ratio: 0.5 },
    });
    expect(seriesStats([{ date: "a", value: 7 }])).toEqual({ low: 7, high: 7, first: 7, last: 7, change: null });
    expect(seriesStats([])).toBeNull();
    expect(seriesStats([{ date: "a", value: 0 }, { date: "b", value: 3 }])?.change).toEqual({ amount: 3, ratio: null });
  });
});

describe("getCardHolders", () => {
  it("lists the user's collections holding any printing of the card, most copies first", async () => {
    const a = await createCollection("u3", "A"), b = await createCollection("u3", "B");
    await addItem("u3", a.id, { printingId: seed.printings.pikachuNormal, quantity: 1, condition: "NM" });
    await addItem("u3", b.id, { printingId: seed.printings.pikachuNormal, quantity: 2, condition: "NM" });
    await addItem("u3", b.id, { printingId: seed.printings.pikachuReverse, quantity: 1, condition: "LP" });
    expect(await getCardHolders("u3", seed.cards.pikachu)).toEqual([
      { collectionId: b.id, name: "B", quantity: 3 }, { collectionId: a.id, name: "A", quantity: 1 },
    ]);
    expect(await getCardHolders("someone-else", seed.cards.pikachu)).toEqual([]);
  });
});
```

Run: `npx vitest run tests/history.test.ts` → FAIL (module not found).

- [x] **Step 4: Implement `lib/history.ts`:**

```ts
// lib/history.ts
// Read side of price/value history for charts. price_snapshots is write-on-change (a row exists
// only on days the price CHANGED), so a series over [from, to] is the carry-in point — the latest
// snapshot at or before `from`, re-dated to `from` — plus every change inside the window. Readers
// step each value forward to the next point (LineChart draws a step line).
import { db } from "@/lib/db";

export const RANGES = ["7d", "30d", "90d", "1y", "all"] as const;
export type Range = (typeof RANGES)[number];
export const RANGE_LABEL: Record<Range, string> = { "7d": "7D", "30d": "30D", "90d": "90D", "1y": "1Y", all: "All" };
/** Prose form for PriceDelta captions and chart labels ("past All" is not a phrase). */
export const RANGE_CAPTION: Record<Range, string> = { "7d": "past 7 days", "30d": "past 30 days", "90d": "past 90 days", "1y": "past year", all: "all time" };
export const DEFAULT_RANGE: Range = "30d";
/** First day of the tcgcsv archive — nothing older can exist. */
export const HISTORY_EPOCH = "2024-02-08";

const RANGE_DAYS: Record<Exclude<Range, "all">, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

/** A `?range=` value, or the default for anything else (arrays, junk, missing). */
export function parseRange(raw: unknown): Range {
  return typeof raw === "string" && (RANGES as readonly string[]).includes(raw) ? (raw as Range) : DEFAULT_RANGE;
}

/** Inclusive start date (YYYY-MM-DD, UTC arithmetic) for a range ending on `to`. */
export function rangeStart(range: Range, to: string): string {
  if (range === "all") return HISTORY_EPOCH;
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - RANGE_DAYS[range]);
  return d.toISOString().slice(0, 10);
}

export interface Point { date: string; value: number | null }

/** Where the chart's x-axis starts. Fixed ranges use the range start; "All" starts at the first
 *  point — collection_history begins the first night the nightly runs and a printing's snapshots
 *  begin at its release — so the data fills the width instead of huddling at the right edge of a
 *  2024→today axis. `today` covers an empty series. */
export function chartFrom(range: Range, from: string, points: Point[], today: string): string {
  return range === "all" ? (points[0]?.date ?? today) : from;
}

/** `points` plus tonight's live value as a final `today` point, unless the nightly has already
 *  written today's row (a brand-new collection has no materialized rows yet but should still chart). */
export function withLivePoint(points: Point[], today: string, value: number): Point[] {
  const last = points[points.length - 1];
  return last && last.date >= today ? points : [...points, { date: today, value }];
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export async function getPrintingHistory(printingId: number, from: string, to: string): Promise<Point[]> {
  const c = await db();
  const [carryIn, inside] = await Promise.all([
    c.execute({ sql: "SELECT market FROM price_snapshots WHERE printing_id = ? AND date <= ? ORDER BY date DESC LIMIT 1", args: [printingId, from] }),
    c.execute({ sql: "SELECT date, market FROM price_snapshots WHERE printing_id = ? AND date > ? AND date <= ? ORDER BY date", args: [printingId, from, to] }),
  ]);
  const points: Point[] = [];
  if (carryIn.rows.length > 0) points.push({ date: from, value: num(carryIn.rows[0].market) });
  for (const r of inside.rows) points.push({ date: String(r.date), value: num(r.market) });
  return points;
}

/** Nightly-materialized collection value (one row per day). Ownership is checked through
 *  collections.user_id like every other collection read; the share page passes the owner's id. */
export async function getCollectionHistory(userId: string, collectionId: number, from: string, to: string): Promise<Point[]> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT ph.date, ph.total_value FROM collection_history ph
          JOIN collections po ON po.id = ph.collection_id AND po.user_id = ?
          WHERE ph.collection_id = ? AND ph.date >= ? AND ph.date <= ? ORDER BY ph.date`,
    args: [userId, collectionId, from, to],
  });
  return r.rows.map((x) => ({ date: String(x.date), value: Number(x.total_value) }));
}

export interface SeriesStats { low: number; high: number; first: number; last: number; change: { amount: number; ratio: number | null } | null }

/** Low/high/first/last over the non-null values; `change` is last − first (null with one point,
 *  ratio null when first is 0). `null` when nothing is priced. */
export function seriesStats(points: Point[]): SeriesStats | null {
  const v = points.map((p) => p.value).filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  const first = v[0], last = v[v.length - 1];
  const change = v.length < 2 ? null : { amount: last - first, ratio: first === 0 ? null : (last - first) / first };
  return { low: Math.min(...v), high: Math.max(...v), first, last, change };
}
```

- [x] **Step 5:** `npx vitest run tests/history.test.ts` → PASS. Full `npm test`, `npm run typecheck`, `npm run lint`.
- [x] **Step 6: Commit** — `feat(history): collection_history/share_links/price_alerts schema, history read layer, card holders`

---

### Task 2: `LineChart` + `RangePills` primitives, `Pill scroll`, `Button size`

**Files:** create `components/ui/LineChart.tsx`, `components/ui/RangePills.tsx`, `tests/ui/line-chart.test.tsx`, `tests/ui/range-pills.test.tsx`; modify `components/ui/Pill.tsx`, `components/ui/Button.tsx`, `app/(app)/collections/[id]/HoldingsTable.tsx`, `tests/ui/primitives-a.test.tsx`, `components/ui/index.ts`, `app/dev/ui/page.tsx`, `docs/design/README.md`

- [x] **Step 1: Failing tests.** `tests/ui/line-chart.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LineChart from "@/components/ui/LineChart";

const pts = [
  { date: "2026-08-08", value: 10 },
  { date: "2026-08-20", value: 20 },
  { date: "2026-09-01", value: 15 },
];

describe("LineChart", () => {
  it("draws a step path across the range and labels the svg", () => {
    render(<LineChart points={pts} from="2026-08-08" to="2026-09-07" label="Umbreon ex market price, 30D" />);
    const svg = screen.getByRole("img", { name: "Umbreon ex market price, 30D" });
    const d = svg.querySelector("path")!.getAttribute("d")!;
    expect(d).toMatch(/^M0\.0 /);            // first point sits on the left edge
    expect(d).toMatch(/ H[\d.]+ V[\d.]+ H[\d.]+ V[\d.]+ H800$/); // step, step, carried to the right edge
    expect(d).not.toMatch(/NaN/);
    // axis labels at both ends
    expect(screen.getByText("Aug 8")).toBeInTheDocument();
    expect(screen.getByText("Sep 7")).toBeInTheDocument();
  });
  it("breaks the line at a null value", () => {
    render(<LineChart points={[pts[0], { date: "2026-08-15", value: null }, pts[2]]} from="2026-08-08" to="2026-09-07" label="x" />);
    const d = screen.getByRole("img").querySelector("path")!.getAttribute("d")!;
    expect(d.match(/M/g)).toHaveLength(2);
  });
  it("renders a flat line without dividing by zero", () => {
    render(<LineChart points={[{ date: "2026-08-08", value: 5 }, { date: "2026-08-20", value: 5 }]} from="2026-08-08" to="2026-09-07" label="x" />);
    expect(screen.getByRole("img").querySelector("path")!.getAttribute("d")).not.toMatch(/NaN|Infinity/);
  });
  it("shows the year in the axis labels for long ranges", () => {
    render(<LineChart points={pts} from="2025-09-07" to="2026-09-07" label="x" />);
    expect(screen.getByText("Sep 7, 2025")).toBeInTheDocument();
    expect(screen.getByText("Sep 7, 2026")).toBeInTheDocument();
  });
  it("says so when there is nothing to draw", () => {
    render(<LineChart points={[]} from="2026-08-08" to="2026-09-07" label="x" />);
    expect(screen.getByText("Not enough history yet.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
```

`tests/ui/range-pills.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RangePills from "@/components/ui/RangePills";

describe("RangePills", () => {
  it("renders one link per range with the current one marked", () => {
    render(<RangePills current="90d" hrefFor={(r) => `/cards/1?range=${r}`} />);
    const group = screen.getByRole("group", { name: "Chart range" });
    const links = group.querySelectorAll("a");
    expect([...links].map((a) => a.textContent)).toEqual(["7D", "30D", "90D", "1Y", "All"]);
    expect(screen.getByRole("link", { name: "90D" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "1Y" })).toHaveAttribute("href", "/cards/1?range=1y");
    expect(screen.getByRole("link", { name: "1Y" })).not.toHaveAttribute("aria-current");
  });
});
```

- [x] **Step 2: `Pill` scroll prop.** In `components/ui/Pill.tsx`: `type Props = ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; href?: string; scroll?: boolean }`; destructure `scroll` alongside `href` (so it never reaches the `<button>`), and pass `scroll={scroll}` to `Link`. Doc: "`scroll={false}` keeps the page where it is — chart range pills sit mid-page."

- [x] **Step 2b: `Button` size prop** (the 44px rule in `docs/design/README.md` — callers have been overriding `min-h-11` with `min-h-8`, which `twMerge` honours at every breakpoint, giving 32px targets on phones). Add `size?: "md" | "sm"` to both arms of `Props` in `components/ui/Button.tsx`; compute `cn(base, size === "sm" && "min-h-11 px-3 py-1 text-[13px] md:min-h-8", skin(variant), className)` (the `md:` variant has a different modifier so it survives beside `min-h-11`, exactly like `Pill`'s shape string); add `"size"` to the keys `domProps` strips. Sweep the three existing offenders in `app/(app)/collections/[id]/HoldingsTable.tsx` (the `−`/`+` steppers and Remove: drop `min-h-8 … py-1` from their `className`, add `size="sm"`, keep `px-2.5` on the steppers). Test in `tests/ui/primitives-a.test.tsx`: `render(<Button size="sm">x</Button>)` → `className` matches `/min-h-11/` and `/md:min-h-8/`; default has no `md:min-h-8`. README "Tap targets" paragraph becomes: "`Button` and `Input` are 44px everywhere (`min-h-11`); `Button size="sm"` and `Pill` are `min-h-11 md:min-h-8` — a thumb target on phones, the compact 32px control of the mockups from `md` up." Gallery: one `size="sm"` row. **Every Button in Tasks 3–7 below uses `size="sm"` instead of a `min-h-8` class override.**

- [x] **Step 3: `LineChart`:**

```tsx
// components/ui/LineChart.tsx
import type { Point } from "@/lib/history";
import { cn } from "./cn";

type Props = { points: Point[]; from: string; to: string; height?: number; label: string; className?: string };

const W = 800; // viewBox width; the svg stretches to its container (preserveAspectRatio="none")
const PAD_Y = 6;
const DAY_MS = 86_400_000;
const dayIndex = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const long = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Step line over a date range. Each value holds until the next point (the data is write-on-change),
 *  the last value is carried to the right edge, and a null value breaks the line. Stroke colour is
 *  `currentColor` (accent) and the baseline is the hairline token, so dark mode needs nothing extra.
 *  The end dot is an HTML element, not an svg circle: the svg is stretched horizontally, which would
 *  turn a circle into an ellipse. */
export default function LineChart({ points, from, to, height = 150, label, className }: Props) {
  const valued = points.filter((p): p is { date: string; value: number } => p.value != null && Number.isFinite(p.value));
  if (valued.length === 0) {
    return (
      <div className={cn("flex items-center justify-center text-[13px] text-dim", className)} style={{ height }}>
        Not enough history yet.
      </div>
    );
  }
  const x0 = dayIndex(from);
  const x1 = Math.max(dayIndex(to), x0 + 1);
  let lo = Math.min(...valued.map((p) => p.value));
  let hi = Math.max(...valued.map((p) => p.value));
  if (hi === lo) { lo -= 1; hi += 1; } // a flat line sits mid-height instead of dividing by zero
  const X = (date: string) => ((Math.min(Math.max(dayIndex(date), x0), x1) - x0) / (x1 - x0)) * W;
  const Y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (height - 2 * PAD_Y);

  let d = "";
  let pen = false;
  for (const p of points) {
    if (p.value == null || !Number.isFinite(p.value)) { pen = false; continue; }
    const x = X(p.date).toFixed(1), y = Y(p.value).toFixed(1);
    d += pen ? ` H${x} V${y}` : `${d ? " " : ""}M${x} ${y}`;
    pen = true;
  }
  if (pen) d += ` H${W}`;
  const last = valued[valued.length - 1];
  const fmt = x1 - x0 > 180 ? long : short;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative">
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="block w-full text-accent"
          style={{ height }}
        >
          <line x1="0" y1={height - 1} x2={W} y2={height - 1} stroke="var(--hairline)" strokeWidth="1" />
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span
          aria-hidden
          className="absolute right-0 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full bg-accent"
          style={{ top: Y(last.value) }}
        />
      </div>
      <div className="flex justify-between text-xs text-dim">
        <span>{fmt.format(new Date(`${from}T00:00:00Z`))}</span>
        <span>{fmt.format(new Date(`${to}T00:00:00Z`))}</span>
      </div>
    </div>
  );
}
```

- [x] **Step 4: `RangePills`:**

```tsx
// components/ui/RangePills.tsx
import { RANGES, RANGE_LABEL, type Range } from "@/lib/history";
import Pill from "./Pill";

/** The 7D · 30D · 90D · 1Y · All row under a chart. Plain links (`?range=`), so the chart
 *  re-renders on the server and there is no client state to keep in sync. */
export default function RangePills({ current, hrefFor, className }: { current: Range; hrefFor: (r: Range) => string; className?: string }) {
  return (
    <div className={className ? `flex flex-wrap gap-1.5 ${className}` : "flex flex-wrap gap-1.5"} role="group" aria-label="Chart range">
      {RANGES.map((r) => (
        <Pill key={r} href={hrefFor(r)} selected={r === current} scroll={false}>
          {RANGE_LABEL[r]}
        </Pill>
      ))}
    </div>
  );
}
```

(Use `cn` rather than the template string if you prefer — either way, no ad-hoc colours.)

- [x] **Step 5:** export both from `components/ui/index.ts`; add gallery sections "LineChart" (sample points over a 30-day window, plus an empty one) and "RangePills" (`hrefFor={(r) => `#${r}`}`) to `app/dev/ui/page.tsx`; add rows to the "Implemented as" table in `docs/design/README.md`: `Value / price chart → LineChart`, `7D · 30D · 90D · 1Y · All row → RangePills`. Run `tests/ui/gallery.test.tsx` — extend it if it enumerates sections.
- [x] **Step 6:** `npm test`, typecheck, lint → green. **Commit** — `feat(ui): LineChart and RangePills primitives; Pill scroll prop; Button size`

---

### Task 3: Charts on the card and collection pages

**Files:** modify `app/(app)/cards/[id]/page.tsx`, `app/(app)/collections/[id]/page.tsx`

- [x] **Step 1: Card detail.** Switch the page's props to `PageProps<"/cards/[id]">` (keep `type Params` for `generateMetadata`). Move the existing `primary` computation above the data loads. `primary` is `PrintingPrice | null` — ~4% of catalog cards (sealed products, promo sets) have **no printings yet** because printings are created by the price ingest — so the charted printing is nullable too. `searchParams` values are `string | string[] | undefined`, and `parseRouteId` takes a `string`, hence the `typeof` narrowing:

```ts
  const { range: rawRange, p: rawP } = await searchParams;
  const range = parseRange(rawRange);
  const today = new Date().toISOString().slice(0, 10);
  const from = rangeStart(range, today);
  const requested = typeof rawP === "string" ? parseRouteId(rawP) : null;
  // PrintingPrice | null: `?p=` when it names one of this card's printings, else the headline one.
  const chartPrinting = printings.find((x) => x.printingId === requested) ?? primary;
  const [collections, history, holders] = await Promise.all([
    listCollections(userId),
    chartPrinting ? getPrintingHistory(chartPrinting.printingId, from, today) : Promise.resolve<Point[]>([]),
    getCardHolders(userId, card.id),
  ]);
  const stats = seriesStats(history);
  const hrefFor = (r: Range, printingId: number) =>
    `/cards/${card.id}?range=${r}${printingId === primary?.printingId ? "" : `&p=${printingId}`}`;
```

(imports: `parseRange, rangeStart, chartFrom, seriesStats, RANGE_CAPTION, type Range, type Point` from `@/lib/history`; `getPrintingHistory` too; `getCardHolders` from `@/lib/collections`; `LineChart, RangePills, Pill, Button` from `@/components/ui`.) Replace the "Charts arrive in Phase 3" panel with:

```tsx
        <Panel className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-ink">Price history</span>
            {stats && (
              <span className="num ml-auto text-xs text-dim">
                Low {formatMoney(stats.low)} · High {formatMoney(stats.high)}
              </span>
            )}
          </div>
          {chartPrinting ? (
            <>
              {printings.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {printings.map((p) => (
                    <Pill key={p.printingId} href={hrefFor(range, p.printingId)} selected={p.printingId === chartPrinting.printingId} scroll={false}>
                      {p.subtype}
                    </Pill>
                  ))}
                </div>
              )}
              <LineChart
                points={history}
                from={chartFrom(range, from, history, today)}
                to={today}
                label={`${card.name} (${chartPrinting.subtype}) market price, ${RANGE_CAPTION[range]}`}
              />
              <RangePills current={range} hrefFor={(r) => hrefFor(r, chartPrinting.printingId)} />
            </>
          ) : (
            <EmptyState title="No price history yet" body="This card has no priced printings." />
          )}
        </Panel>
```

(`chartPrinting` is a `const`, so the narrowing survives into the arrow callbacks.)

Under the printings panel add the "In your collections" block and the alert shortcut:

```tsx
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          {holders.length === 0 ? (
            <span className="text-dim">Not in any of your collections yet.</span>
          ) : (
            <span className="text-muted">
              In your collections:{" "}
              {holders.map((h, i) => (
                <span key={h.collectionId}>
                  {i > 0 && ", "}
                  <Link href={`/collections/${h.collectionId}`} className="text-ink">{h.name}</Link>
                  <span className="num text-dim"> ×{h.quantity}</span>
                </span>
              ))}
            </span>
          )}
          {primary && (
            <Button href={`/alerts?printing=${primary.printingId}`} variant="secondary" size="sm" className="ml-auto">
              Set a price alert
            </Button>
          )}
        </div>
```

The alerts page (Task 7) reads `?printing=`; until then the link lands on the placeholder — fine.

- [x] **Step 2: Collection detail.** Same `searchParams` treatment (`PageProps<"/collections/[id]">`). Nothing populates `collection_history` until Task 6, so today every collection has an empty history — `withLivePoint` adds tonight's live value as the single point (and, once the nightly runs, only when today's row isn't there yet):

```ts
  const history = withLivePoint(await getCollectionHistory(userId, collectionId, from, today), today, summary.value);
  const stats = seriesStats(history);
```

Under the `PriceDelta` add:

```tsx
        {stats?.change && (
          <PriceDelta amount={stats.change.amount} ratio={stats.change.ratio} caption={RANGE_CAPTION[range]} />
        )}
        <div className="flex flex-col gap-2">
          <LineChart
            points={history}
            from={chartFrom(range, from, history, today)}
            to={today}
            height={120}
            label={`${collection.name} value, ${RANGE_CAPTION[range]}`}
          />
          <RangePills current={range} hrefFor={(r) => `/collections/${collectionId}?range=${r}`} />
        </div>
```

- [x] **Step 3:** typecheck (`next typegen` runs first, so `PageProps` resolves), lint, test. Manually: `npm run dev`, sign in, open `/cards/22189?range=1y` (real snapshots), `/cards/31532` or any card with no printings (empty panel, no crash), `/collections/2?range=all` — must show a single flat line at today's value (one `M` in the path, end dot present), not "Not enough history yet." **Commit** — `feat(charts): price history on card detail (range + printing), collection value chart, card holders, alert shortcut`

---

### Task 4: Share links

**Files:** create `lib/share.ts`, `tests/share.test.ts`, `tests/share-actions.test.ts`, `app/(app)/collections/[id]/SharePanel.tsx`, `tests/ui/share-panel.test.tsx`, `app/s/[token]/page.tsx`; modify `app/(app)/collections/actions.ts`, `app/(app)/collections/[id]/page.tsx`, `tests/proxy.test.ts`

- [x] **Step 1: Failing data-layer tests** — `tests/share.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("share");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { createCollection, addItem } from "@/lib/collections";
import { isShareToken, getShareLink, enableShare, regenerateShare, disableShare, getSharedCollection } from "@/lib/share";

let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
let mine: number;
beforeAll(async () => {
  seed = await seedMiniCatalog();
  mine = (await createCollection("u1", "Main")).id;
  await addItem("u1", mine, { printingId: seed.printings.umbreonHolo, quantity: 2, condition: "NM", acquiredPrice: 1000 });
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("share links", () => {
  it("starts with no link", async () => {
    expect(await getShareLink("u1", mine)).toBeNull();
    expect(await getSharedCollection("nope")).toBeNull();
  });
  it("enable creates a 22-char base64url token that resolves to exactly that collection, cost basis stripped", async () => {
    const link = await enableShare("u1", mine);
    expect(link.enabled).toBe(true);
    expect(isShareToken(link.token)).toBe(true);
    const shared = await getSharedCollection(link.token);
    expect(shared).toMatchObject({ collectionId: mine, ownerId: "u1", name: "Main", cards: 2, value: 2930 });
    expect(shared!.holdings).toHaveLength(1);
    expect(shared!.holdings[0]).toMatchObject({ cardName: "Umbreon ex", quantity: 2, value: 2930 });
    expect(shared!.holdings[0]).not.toHaveProperty("acquiredPrice");
    expect(shared!.holdings[0]).not.toHaveProperty("cost");
    expect(shared).not.toHaveProperty("gain");
  });
  it("enable again keeps the same token; regenerate replaces it and kills the old URL", async () => {
    const a = await enableShare("u1", mine);
    expect((await enableShare("u1", mine)).token).toBe(a.token);
    const b = await regenerateShare("u1", mine);
    expect(b.token).not.toBe(a.token);
    expect(b.enabled).toBe(true);
    expect(await getSharedCollection(a.token)).toBeNull();
    expect((await getSharedCollection(b.token))?.collectionId).toBe(mine);
  });
  it("disable 404s the token but keeps it for re-enable", async () => {
    const before = (await getShareLink("u1", mine))!;
    expect(await disableShare("u1", mine)).toBe(true);
    expect(await getSharedCollection(before.token)).toBeNull();
    expect((await getShareLink("u1", mine))?.enabled).toBe(false);
    expect((await enableShare("u1", mine)).token).toBe(before.token);
  });
  it("another user cannot see or toggle the link", async () => {
    expect(await getShareLink("u2", mine)).toBeNull();
    await expect(enableShare("u2", mine)).rejects.toThrow(/not found/i);
    await expect(regenerateShare("u2", mine)).rejects.toThrow(/not found/i);
    expect(await disableShare("u2", mine)).toBe(false);
    expect((await getShareLink("u1", mine))?.enabled).toBe(true);
  });
  it("rejects malformed tokens without touching the database", async () => {
    for (const t of ["", "short", "x".repeat(23), "has space here-------", "../../etc/passwd-------"]) expect(isShareToken(t)).toBe(false);
    expect(await getSharedCollection("x".repeat(23))).toBeNull();
  });
});
```

- [x] **Step 2: Implement `lib/share.ts`:**

```ts
// lib/share.ts
// Read-only share links. One per collection; the token is the only credential (spec §9: token lookup
// only, disabled links 404). A visitor sees the collection at market value — never cost basis or gain,
// and nothing else about the owner.
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getCollectionHoldings, getCollectionSummary, type Holding } from "@/lib/collections";

export interface ShareLink { token: string; enabled: boolean; createdAt: string }

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes as base64url
export const isShareToken = (s: string): boolean => TOKEN_RE.test(s);
const newToken = () => randomBytes(16).toString("base64url");

async function assertOwnsCollection(userId: string, collectionId: number) {
  const c = await db();
  const r = await c.execute({ sql: "SELECT 1 FROM collections WHERE id = ? AND user_id = ?", args: [collectionId, userId] });
  if (r.rows.length === 0) throw new Error("Collection not found");
}

export async function getShareLink(userId: string, collectionId: number): Promise<ShareLink | null> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT sl.token, sl.enabled, sl.created_at FROM share_links sl
          JOIN collections po ON po.id = sl.collection_id AND po.user_id = ?
          WHERE sl.collection_id = ?`,
    args: [userId, collectionId],
  });
  if (r.rows.length === 0) return null;
  const x = r.rows[0];
  return { token: String(x.token), enabled: Number(x.enabled) === 1, createdAt: String(x.created_at) };
}

/** Turns sharing on: creates the link on first use, re-enables the SAME token afterwards. */
export async function enableShare(userId: string, collectionId: number): Promise<ShareLink> {
  await assertOwnsCollection(userId, collectionId);
  const c = await db();
  await c.execute({
    sql: "INSERT INTO share_links (collection_id, token, enabled) VALUES (?, ?, 1) ON CONFLICT(collection_id) DO UPDATE SET enabled = 1",
    args: [collectionId, newToken()],
  });
  return (await getShareLink(userId, collectionId))!;
}

/** Replaces the token (every old URL stops working) and leaves sharing on. */
export async function regenerateShare(userId: string, collectionId: number): Promise<ShareLink> {
  await assertOwnsCollection(userId, collectionId);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO share_links (collection_id, token, enabled) VALUES (?, ?, 1)
          ON CONFLICT(collection_id) DO UPDATE SET token = excluded.token, enabled = 1`,
    args: [collectionId, newToken()],
  });
  return (await getShareLink(userId, collectionId))!;
}

export async function disableShare(userId: string, collectionId: number): Promise<boolean> {
  const c = await db();
  const r = await c.execute({
    sql: "UPDATE share_links SET enabled = 0 WHERE collection_id = ? AND collection_id IN (SELECT id FROM collections WHERE user_id = ?)",
    args: [collectionId, userId],
  });
  return r.rowsAffected === 1;
}

/** What a visitor may see. Everything the owner paid is deliberately absent. */
export type PublicHolding = Omit<Holding, "acquiredPrice" | "acquiredDate" | "cost">;
export interface SharedCollection { ownerId: string; collectionId: number; name: string; holdings: PublicHolding[]; value: number; cards: number; unpriced: number }

const toPublic = (h: Holding): PublicHolding => ({
  itemId: h.itemId, printingId: h.printingId, cardId: h.cardId, cardName: h.cardName, setName: h.setName, number: h.number,
  subtype: h.subtype, imageUrl: h.imageUrl, quantity: h.quantity, condition: h.condition, market: h.market, priceDate: h.priceDate, value: h.value,
});

/** The collection behind an enabled token, or null for unknown, malformed, or disabled tokens. */
export async function getSharedCollection(token: string): Promise<SharedCollection | null> {
  if (!isShareToken(token)) return null;
  const c = await db();
  const r = await c.execute({
    sql: `SELECT po.id, po.user_id, po.name FROM share_links sl
          JOIN collections po ON po.id = sl.collection_id
          WHERE sl.token = ? AND sl.enabled = 1`,
    args: [token],
  });
  if (r.rows.length === 0) return null;
  const ownerId = String(r.rows[0].user_id), collectionId = Number(r.rows[0].id);
  const [holdings, summary] = await Promise.all([getCollectionHoldings(ownerId, collectionId), getCollectionSummary(ownerId, collectionId)]);
  return { ownerId, collectionId, name: String(r.rows[0].name), holdings: holdings.map(toPublic), value: summary.value, cards: summary.cards, unpriced: summary.unpriced };
}
```

Run `tests/share.test.ts` → PASS.

- [x] **Step 3: Actions.** Append to `app/(app)/collections/actions.ts`:

```ts
export async function enableShareAction(collectionId: number) {
  const r = await withUser((u) => S.enableShare(u, assertId(collectionId)));
  if (r.ok) revalidatePath(`/collections/${collectionId}`);
  return r;
}
export async function regenerateShareAction(collectionId: number) {
  const r = await withUser((u) => S.regenerateShare(u, assertId(collectionId)));
  if (r.ok) revalidatePath(`/collections/${collectionId}`);
  return r;
}
export async function disableShareAction(collectionId: number) {
  const r = await withUser(async (u) => {
    if (!(await S.disableShare(u, assertId(collectionId)))) throw new Error("Collection not found");
  });
  if (r.ok) revalidatePath(`/collections/${collectionId}`);
  return r;
}
```

(`import * as S from "@/lib/share"`.) Test `tests/share-actions.test.ts` in the style of `tests/actions.test.ts`: no session → `Not signed in`; bad id → `Invalid id`; owner enable → `{ ok: true, data: { token, enabled: true } }` and `revalidatePath("/collections/<id>")`; other user → `Collection not found`; disable on a collection with no link → `Collection not found`.

- [x] **Step 4: `SharePanel` (client)** — `app/(app)/collections/[id]/SharePanel.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ShareLink } from "@/lib/share";
import { Button, Panel } from "@/components/ui";
import { enableShareAction, regenerateShareAction, disableShareAction } from "../actions";

// Local alias (not imported from the actions module): the three actions return ActionResult<ShareLink>
// for enable/regenerate and ActionResult<void> for disable, so `run` must be generic over the payload.
type Result<T> = { ok: true; data?: T } | { ok: false; error: string };

/** Share on/off for one collection. The link is shown as a path; "Copy" resolves it against the
 *  current origin at click time so preview deploys and localhost copy the right host. */
export default function SharePanel({ collectionId, link }: { collectionId: number; link: ShareLink | null }) {
  const router = useRouter();
  const [current, setCurrent] = useState<ShareLink | null>(link);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run<T>(call: () => Promise<Result<T>>, after?: (data: T | undefined) => void) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await call();
      if (!res.ok) { setError(res.error); return; }
      after?.(res.data);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const path = current ? `/s/${current.token}` : null;

  async function copy() {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setNotice("Link copied.");
    } catch {
      setError("Couldn't copy — select the link and copy it yourself.");
    }
  }

  return (
    <Panel className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-ink">Share</span>
        <span className="text-xs text-dim">{current?.enabled ? "Anyone with the link can view" : "Off"}</span>
      </div>
      {current?.enabled ? (
        <>
          <code className="num truncate rounded-tile border border-hairline bg-ground px-3 py-2 text-[13px] text-ink" aria-label="Share link">{path}</code>
          <p className="text-xs text-dim">Viewers see the cards and their market value — never what you paid.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={copy} disabled={busy}>Copy link</Button>
            <Button variant="secondary" size="sm" disabled={busy}
              onClick={() => { if (window.confirm("Replace the link? The old one will stop working.")) void run(() => regenerateShareAction(collectionId), (d) => setCurrent(d ?? null)); }}>
              New link
            </Button>
            <Button variant="secondary" size="sm" disabled={busy}
              onClick={() => run(() => disableShareAction(collectionId), () => setCurrent((c) => (c ? { ...c, enabled: false } : c)))}>
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <Button variant="secondary" className="self-start" disabled={busy} onClick={() => run(() => enableShareAction(collectionId), (d) => setCurrent(d ?? null))}>
          Share this collection
        </Button>
      )}
      {notice && <p className="text-[13px] text-gain">{notice}</p>}
      {error && <p role="alert" className="text-[13px] text-accent">{error}</p>}
    </Panel>
  );
}
```

Test `tests/ui/share-panel.test.tsx` (mock the three actions and `next/navigation` as `holdings-table.test.tsx` does; stub `navigator.clipboard.writeText` with `vi.fn`): Off state shows "Share this collection" → click → `enableShareAction(7)` → shows `/s/<token>` and "Anyone with the link can view"; Copy → clipboard gets `http://localhost:3000/s/<token>` (jsdom origin) and "Link copied."; Turn off → `disableShareAction(7)` and back to Off; New link confirms first then `regenerateShareAction(7)` and shows the new token; an action error renders an alert.

- [x] **Step 5: Public page** — `app/s/[token]/page.tsx` (outside `(app)`: no shell, no session):

```tsx
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSharedCollection } from "@/lib/share";
import { getCollectionHistory, parseRange, rangeStart, chartFrom, withLivePoint, seriesStats, RANGE_CAPTION } from "@/lib/history";
import { formatMoney } from "@/lib/format";
import { SectionHeading, MoneyDisplay, PriceDelta, CardRow, LineChart, RangePills, EmptyState } from "@/components/ui";

// The token is the credential: no caching across requests, and never indexed.
export const dynamic = "force-dynamic";

/** One lookup per request even though generateMetadata and the page both ask (same pattern as the
 *  other detail pages). */
const load = cache((token: string) => getSharedCollection(token));

export async function generateMetadata({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const shared = await load(token);
  return { title: shared ? `${shared.name} — Hitstreak` : "Hitstreak", robots: { index: false, follow: false } };
}

export default async function SharedCollectionPage({ params, searchParams }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const { range: rawRange } = await searchParams;
  const shared = await load(token);
  if (!shared) notFound();
  const range = parseRange(rawRange);
  const today = new Date().toISOString().slice(0, 10);
  const from = rangeStart(range, today);
  const history = withLivePoint(await getCollectionHistory(shared.ownerId, shared.collectionId, from, today), today, shared.value);
  const stats = seriesStats(history);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center gap-4 border-b border-hairline px-6 md:px-10">
        <Link href="/" className="font-display text-2xl text-ink">Hitstreak</Link>
        <span className="text-[13px] text-dim">Shared collection · read-only</span>
      </header>
      <main className="grid grow gap-10 px-6 py-6 md:grid-cols-[380px_1fr] md:px-10">
        <div className="flex flex-col gap-4">
          <SectionHeading as="h1" title={shared.name} caption={`${shared.cards} card${shared.cards === 1 ? "" : "s"}`} />
          <MoneyDisplay size="lg" amount={shared.value} />
          {stats?.change && <PriceDelta amount={stats.change.amount} ratio={stats.change.ratio} caption={RANGE_CAPTION[range]} />}
          <div className="flex flex-col gap-2">
            <LineChart
              points={history}
              from={chartFrom(range, from, history, today)}
              to={today}
              height={120}
              label={`${shared.name} value, ${RANGE_CAPTION[range]}`}
            />
            <RangePills current={range} hrefFor={(r) => `/s/${token}?range=${r}`} />
          </div>
          {shared.unpriced > 0 && <p className="text-[13px] text-dim">{shared.unpriced} {shared.unpriced === 1 ? "copy has" : "copies have"} no market price yet.</p>}
        </div>
        <div className="flex flex-col gap-4">
          <SectionHeading title="Cards" caption="sorted by value" />
          {shared.holdings.length === 0 ? (
            <EmptyState title="Nothing here yet" />
          ) : (
            <ul className="flex flex-col gap-2">
              {shared.holdings.map((h) => (
                <li key={h.itemId}>
                  <CardRow
                    name={h.cardName}
                    subtitle={[h.setName, h.number, h.subtype, h.condition].filter(Boolean).join(" · ")}
                    imageUrl={h.imageUrl}
                    right={
                      <>
                        <span className="text-lg font-semibold text-ink">{formatMoney(h.value)}</span>
                        <span className="text-[11px] text-dim">×{h.quantity}</span>
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
```

Add to `tests/proxy.test.ts`: `it("leaves public share pages alone", …)` → `proxy(req("/s/abcdefghijklmnopqrstuv"))` has no `location` header.

- [x] **Step 6: Wire the panel.** In `app/(app)/collections/[id]/page.tsx` load `getShareLink(userId, collectionId)` with the other reads and render `<SharePanel collectionId={collectionId} link={shareLink} />` at the bottom of the left column.
- [x] **Step 7:** `npm test`, typecheck, lint. Manually: enable sharing on collection 2, open the `/s/…` URL in a private window (no cookie) → renders; `curl -si localhost:3000/s/AAAAAAAAAAAAAAAAAAAAAA` → 404. **Commit** — `feat(share): read-only collection share links (/s/[token]) with on/off/regenerate`

---

### Task 5: Alerts data layer + `evaluateAlert`

**Files:** create `lib/alerts.ts`, `tests/alerts.test.ts`

- [x] **Step 1: Failing tests** — `tests/alerts.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("alerts");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { evaluateAlert, createAlert, listAlerts, deleteAlert, getAlertCard, MAX_ALERTS_PER_USER } from "@/lib/alerts";

let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
beforeAll(async () => { seed = await seedMiniCatalog(); });
afterAll(() => { closeDb(); tmp.clean(); });

describe("evaluateAlert", () => {
  const above = { direction: "above" as const, threshold: 100 };
  const below = { direction: "below" as const, threshold: 100 };
  it("fires an armed alert on an inclusive crossing", () => {
    expect(evaluateAlert({ ...above, armed: true }, 100)).toBe("fire");
    expect(evaluateAlert({ ...above, armed: true }, 150)).toBe("fire");
    expect(evaluateAlert({ ...above, armed: true }, 99.99)).toBe("none");
    expect(evaluateAlert({ ...below, armed: true }, 100)).toBe("fire");
    expect(evaluateAlert({ ...below, armed: true }, 60)).toBe("fire");
    expect(evaluateAlert({ ...below, armed: true }, 100.01)).toBe("none");
  });
  it("re-arms a fired alert only once the price is strictly back over the line", () => {
    expect(evaluateAlert({ ...above, armed: false }, 150)).toBe("none");
    expect(evaluateAlert({ ...above, armed: false }, 100)).toBe("none");
    expect(evaluateAlert({ ...above, armed: false }, 99)).toBe("rearm");
    expect(evaluateAlert({ ...below, armed: false }, 100)).toBe("none");
    expect(evaluateAlert({ ...below, armed: false }, 101)).toBe("rearm");
  });
  it("does nothing without a price", () => {
    expect(evaluateAlert({ ...above, armed: true }, null)).toBe("none");
    expect(evaluateAlert({ ...below, armed: false }, NaN)).toBe("none");
  });
});

describe("alerts data layer", () => {
  it("creates, lists (with card, price and 30-day change) and deletes the user's alerts", async () => {
    const id = await createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: 1450 });
    // asOf pinned (like tests/catalog-read.test.ts): the seed's snapshots are 2026-07-01 / 2026-09-01,
    // so a real-clock 30-day window would change the expected change30d after 2026-09-30.
    const list = await listAlerts("u1", "2026-09-07");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id, printingId: seed.printings.umbreonHolo, cardName: "Umbreon ex", setName: "Prismatic Evolutions", subtype: "Holofoil",
      direction: "above", threshold: 1450, armed: true, lastFiredAt: null, market: 1465,
    });
    expect(list[0].change30d).toEqual({ amount: 365, ratio: 365 / 1100 });
    expect(await listAlerts("u2")).toEqual([]);
    expect(await deleteAlert("u2", id)).toBe(false);
    expect(await deleteAlert("u1", id)).toBe(true);
    expect(await listAlerts("u1")).toEqual([]);
  });
  it("validates direction, threshold and printing", async () => {
    await expect(createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "sideways", threshold: 1 })).rejects.toThrow(/direction/i);
    await expect(createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: 0 })).rejects.toThrow(/threshold/i);
    await expect(createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: NaN })).rejects.toThrow(/threshold/i);
    await expect(createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: 2_000_000 })).rejects.toThrow(/threshold/i);
    await expect(createAlert("u1", { printingId: 99999, direction: "above", threshold: 1 })).rejects.toThrow(/printing/i);
  });
  it("caps alerts per user", async () => {
    for (let i = 0; i < MAX_ALERTS_PER_USER; i++) await createAlert("capped", { printingId: seed.printings.pikachuNormal, direction: "below", threshold: 1 + i });
    await expect(createAlert("capped", { printingId: seed.printings.pikachuNormal, direction: "below", threshold: 0.5 })).rejects.toThrow(/at most/i);
  });
  it("orders triggered alerts before watching ones", async () => {
    const a = await createAlert("u4", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: 1 });
    const b = await createAlert("u4", { printingId: seed.printings.shanksNormal, direction: "below", threshold: 1 });
    const { db } = await import("@/lib/db");
    await (await db()).execute({ sql: "UPDATE price_alerts SET armed = 0, last_fired_at = '2026-09-07T21:06:00Z', last_fired_price = 1465 WHERE id = ?", args: [b] });
    expect((await listAlerts("u4")).map((x) => x.id)).toEqual([b, a]);
  });
  it("getAlertCard resolves a printing to its card with all printings for the form", async () => {
    const card = await getAlertCard("u1", seed.printings.pikachuReverse);
    expect(card).toMatchObject({ printingId: seed.printings.pikachuReverse, name: "Pikachu", subtitle: "Prismatic Evolutions · 025/131" });
    expect(card!.printings.map((p) => p.subtype)).toEqual(["Normal", "Reverse Holofoil"]);
    expect(await getAlertCard("u1", 99999)).toBeNull();
  });
});
```

- [x] **Step 2: Implement `lib/alerts.ts`:**

```ts
// lib/alerts.ts
// Email price alerts. `evaluateAlert` is the whole state machine and is pure so the nightly job and
// the tests share one definition. Rows are scoped by user_id; the nightly (ingest/nightly.ts) is
// the only reader that crosses users.
import { db } from "@/lib/db";
import { getCardDetail, thirtyDayChange, type Change, type PrintingPrice } from "@/lib/catalog";

export const DIRECTIONS = ["above", "below"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const MAX_ALERTS_PER_USER = 100;
const MAX_THRESHOLD = 1_000_000;

export type Decision = "fire" | "rearm" | "none";

/** Armed + price at/over the line → fire (inclusive: a price AT the threshold counts). Fired + price
 *  strictly back on the other side → re-arm. Anything else, or no price → nothing. */
export function evaluateAlert(a: { direction: Direction; threshold: number; armed: boolean }, market: number | null): Decision {
  if (market == null || !Number.isFinite(market)) return "none";
  const crossed = a.direction === "above" ? market >= a.threshold : market <= a.threshold;
  if (a.armed) return crossed ? "fire" : "none";
  return crossed ? "none" : "rearm";
}

export interface Alert {
  id: number; printingId: number; cardId: number; cardName: string; setName: string; number: string | null; subtype: string; imageUrl: string | null;
  direction: Direction; threshold: number; armed: boolean; lastFiredAt: string | null; lastFiredPrice: number | null; createdAt: string;
  market: number | null; priceDate: string | null; change30d: Change | null;
}

/** Triggered (fired, waiting to re-arm) first, then watching; newest first within each. */
export async function listAlerts(userId: string, asOf = new Date().toISOString().slice(0, 10)): Promise<Alert[]> {
  const c = await db();
  const rows = (await c.execute({
    sql: `SELECT a.id, a.printing_id, a.direction, a.threshold, a.armed, a.last_fired_at, a.last_fired_price, a.created_at,
                 ca.id AS card_id, ca.name AS card_name, ca.number, ca.image_url, se.name AS set_name, p.subtype, lp.market, lp.date AS price_date
          FROM price_alerts a
          JOIN printings p ON p.id = a.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          LEFT JOIN latest_prices lp ON lp.printing_id = p.id
          WHERE a.user_id = ?
          ORDER BY a.armed ASC, a.created_at DESC, a.id DESC`,
    args: [userId],
  })).rows;
  return Promise.all(rows.map(async (x) => ({
    id: Number(x.id), printingId: Number(x.printing_id), cardId: Number(x.card_id), cardName: String(x.card_name), setName: String(x.set_name),
    number: x.number == null ? null : String(x.number), subtype: String(x.subtype), imageUrl: x.image_url == null ? null : String(x.image_url),
    direction: String(x.direction) as Direction, threshold: Number(x.threshold), armed: Number(x.armed) === 1,
    lastFiredAt: x.last_fired_at == null ? null : String(x.last_fired_at), lastFiredPrice: x.last_fired_price == null ? null : Number(x.last_fired_price),
    createdAt: String(x.created_at), market: x.market == null ? null : Number(x.market), priceDate: x.price_date == null ? null : String(x.price_date),
    change30d: await thirtyDayChange(Number(x.printing_id), asOf),
  })));
}

export interface CreateAlertInput { printingId: number; direction: string; threshold: number }

export async function createAlert(userId: string, input: CreateAlertInput): Promise<number> {
  if (!(DIRECTIONS as readonly string[]).includes(input.direction)) throw new Error(`Direction must be one of ${DIRECTIONS.join(", ")}`);
  if (!Number.isFinite(input.threshold) || input.threshold <= 0 || input.threshold > MAX_THRESHOLD) throw new Error("Threshold must be a price above zero");
  const c = await db();
  if ((await c.execute({ sql: "SELECT 1 FROM printings WHERE id = ?", args: [input.printingId] })).rows.length === 0) throw new Error("Printing not found");
  const n = Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM price_alerts WHERE user_id = ?", args: [userId] })).rows[0].n);
  if (n >= MAX_ALERTS_PER_USER) throw new Error(`You can have at most ${MAX_ALERTS_PER_USER} alerts`);
  const r = await c.execute({
    sql: "INSERT INTO price_alerts (user_id, printing_id, direction, threshold) VALUES (?, ?, ?, ?) RETURNING id",
    args: [userId, input.printingId, input.direction, input.threshold],
  });
  return Number(r.rows[0].id);
}

export async function deleteAlert(userId: string, id: number): Promise<boolean> {
  const c = await db();
  const r = await c.execute({ sql: "DELETE FROM price_alerts WHERE id = ? AND user_id = ?", args: [id, userId] });
  return r.rowsAffected === 1;
}

/** The card behind a printing, shaped for the new-alert form (`/alerts?printing=`). */
export interface AlertCard { printingId: number; name: string; subtitle: string; imageUrl: string | null; printings: PrintingPrice[] }
export async function getAlertCard(userId: string, printingId: number): Promise<AlertCard | null> {
  const c = await db();
  const r = await c.execute({ sql: "SELECT card_id FROM printings WHERE id = ?", args: [printingId] });
  if (r.rows.length === 0) return null;
  const detail = await getCardDetail(userId, Number(r.rows[0].card_id));
  if (!detail) return null;
  return {
    printingId,
    name: detail.card.name,
    subtitle: [detail.card.setName, detail.card.number].filter(Boolean).join(" · "),
    imageUrl: detail.card.imageUrl,
    printings: detail.printings.map(({ printingId, subtype, market, priceDate }) => ({ printingId, subtype, market, priceDate })),
  };
}
```

- [x] **Step 3:** PASS; full suite, typecheck, lint. **Commit** — `feat(alerts): price alert data layer and evaluateAlert state machine`

---

### Task 6: Nightly job — collection history + alert emails

**Files:** create `ingest/mailer.ts`, `ingest/nightly.ts`, `tests/mailer.test.ts`, `tests/nightly.test.ts`; modify `.github/workflows/daily-ingest.yml`, `.env.example`

- [x] **Step 1: Mailer** — `ingest/mailer.ts`:

```ts
// Email delivery for alerts. Resend's REST API over fetch (no SDK); `Mailer` is the seam the
// nightly job and its tests use. `send` THROWS on failure — the caller decides what an
// undelivered alert means (it stays armed and is retried the next night, spec §9).
import { formatMoney } from "@/lib/format";
import type { Direction } from "@/lib/alerts";

export interface Mail { to: string; subject: string; text: string; html: string }
export interface Mailer { send(mail: Mail): Promise<void> }

export function createResendMailer(opts: { apiKey: string; from: string; fetchImpl?: typeof fetch }): Mailer {
  const f = opts.fetchImpl ?? fetch;
  return {
    async send(mail) {
      const res = await f("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: opts.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

/** null when Resend isn't configured — the nightly then logs what it WOULD have sent. */
export function mailerFromEnv(): Mailer | null {
  const apiKey = process.env.RESEND_API_KEY, from = process.env.ALERT_FROM_EMAIL;
  return apiKey && from ? createResendMailer({ apiKey, from }) : null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export interface AlertEmailInput {
  to: string; cardName: string; setName: string; number: string | null; subtype: string;
  direction: Direction; threshold: number; market: number; cardUrl: string;
}

/** Spec §7: card, threshold, current price, link. Plain text first; the HTML is the same words. */
export function alertEmail(i: AlertEmailInput): Mail {
  const verb = i.direction === "above" ? "rose above" : "dropped below";
  const where = [i.setName, i.number, i.subtype].filter(Boolean).join(" · ");
  const subject = `${i.cardName} ${verb} ${formatMoney(i.threshold)} — now ${formatMoney(i.market)}`;
  const text = [
    `${i.cardName} (${where}) ${verb} your ${formatMoney(i.threshold)} line.`,
    `Market price today: ${formatMoney(i.market)}.`,
    ``,
    `View the card: ${i.cardUrl}`,
    ``,
    `This alert will email you again only after the price crosses back over ${formatMoney(i.threshold)}. Manage alerts: ${new URL("/alerts", i.cardUrl).href}`,
  ].join("\n");
  const html = `<p><strong>${esc(i.cardName)}</strong> (${esc(where)}) ${verb} your <strong>${formatMoney(i.threshold)}</strong> line.</p>
<p>Market price today: <strong>${formatMoney(i.market)}</strong>.</p>
<p><a href="${esc(i.cardUrl)}">View the card</a></p>
<p style="color:#6f665a;font-size:13px">This alert will email you again only after the price crosses back over ${formatMoney(i.threshold)}. <a href="${esc(new URL("/alerts", i.cardUrl).href)}">Manage alerts</a></p>`;
  return { to: i.to, subject, text, html };
}
```

`tests/mailer.test.ts`: `alertEmail` subject/text/html contain card, threshold, price, link, and `<` in a card name is escaped in the html; `createResendMailer` posts the right JSON to `https://api.resend.com/emails` with the bearer header (fake `fetchImpl`), and throws on a non-2xx; `mailerFromEnv()` is null without both env vars.

- [x] **Step 2: Failing nightly tests** — `tests/nightly.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("nightly");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { createCollection, addItem } from "@/lib/collections";
import { createAlert } from "@/lib/alerts";
import { runNightly, materializeCollectionHistory } from "@/ingest/nightly";
import type { Mail, Mailer } from "@/ingest/mailer";

let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
let full: number, empty: number;

async function addUser(id: string, email: string) {
  await (await db()).execute({
    sql: `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, '2026-09-01', '2026-09-01')`,
    args: [id, id, email],
  });
}
const capture = () => { const sent: Mail[] = []; const mailer: Mailer = { send: async (m) => { sent.push(m); } }; return { sent, mailer }; };
const failing: Mailer = { send: async () => { throw new Error("resend down"); } };
const alertRow = async (id: number) => (await (await db()).execute({ sql: "SELECT armed, last_fired_at, last_fired_price FROM price_alerts WHERE id = ?", args: [id] })).rows[0];

beforeAll(async () => {
  seed = await seedMiniCatalog();
  await addUser("u1", "u1@example.com");
  await addUser("u2", "u2@example.com");
  full = (await createCollection("u1", "Main")).id;
  empty = (await createCollection("u2", "Empty")).id;
  await addItem("u1", full, { printingId: seed.printings.umbreonHolo, quantity: 2, condition: "NM" });   // 1465 as of 2026-09-01
  await addItem("u1", full, { printingId: seed.printings.pikachuNormal, quantity: 5, condition: "NM" }); // no snapshots → unpriced
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("materializeCollectionHistory", () => {
  it("writes one row per collection valued from the snapshots as of that date, idempotently", async () => {
    expect(await materializeCollectionHistory("2026-09-07")).toBe(2);
    const rows = async () => (await (await db()).execute("SELECT collection_id, date, total_value FROM collection_history ORDER BY collection_id")).rows;
    expect(await rows()).toEqual([
      { collection_id: full, date: "2026-09-07", total_value: 2930 },
      { collection_id: empty, date: "2026-09-07", total_value: 0 },
    ]);
    await materializeCollectionHistory("2026-09-07");
    expect((await rows()).length).toBe(2);
    // an earlier date uses the price in force then (1100 on 2026-08-01)
    await materializeCollectionHistory("2026-08-01");
    expect((await rows()).find((r) => r.collection_id === full && r.date === "2026-08-01")?.total_value).toBe(2200);
  });
});

describe("runNightly alerts", () => {
  it("emails once on a crossing, disarms, and does not email again on a re-run", async () => {
    const id = await createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: 1450 });
    const { sent, mailer } = capture();
    const s1 = await runNightly({ date: "2026-09-07", mailer, appUrl: "https://hitstreak.test", now: () => "2026-09-07T21:06:00Z" });
    expect(s1).toMatchObject({ collections: 2, alerts: 1, fired: 1, rearmed: 0, emailFailed: 0, skippedNoMailer: 0, emailDisabled: false });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("u1@example.com");
    expect(sent[0].subject).toContain("Umbreon ex");
    expect(sent[0].text).toContain(`https://hitstreak.test/cards/${seed.cards.umbreon}`);
    expect(await alertRow(id)).toEqual({ armed: 0, last_fired_at: "2026-09-07T21:06:00Z", last_fired_price: 1465 });

    const s2 = await runNightly({ date: "2026-09-07", mailer, appUrl: "https://hitstreak.test" });
    expect(s2.fired).toBe(0);
    expect(sent).toHaveLength(1);
  });
  it("re-arms once the price is back over the line, then fires again on the next crossing", async () => {
    const c = await db();
    const id = Number((await c.execute("SELECT id FROM price_alerts WHERE user_id = 'u1'")).rows[0].id);
    await c.execute("INSERT INTO price_snapshots (printing_id, date, market) VALUES (1, '2026-09-08', 1400), (1, '2026-09-09', 1500)");
    const { sent, mailer } = capture();
    expect((await runNightly({ date: "2026-09-08", mailer, appUrl: "https://hitstreak.test" })).rearmed).toBe(1);
    expect(Number((await alertRow(id)).armed)).toBe(1);
    expect((await runNightly({ date: "2026-09-09", mailer, appUrl: "https://hitstreak.test" })).fired).toBe(1);
    expect(sent).toHaveLength(1);
  });
  it("keeps the alert armed when the email fails or when email is not configured", async () => {
    const id = await createAlert("u2", { printingId: seed.printings.shanksNormal, direction: "below", threshold: 210 }); // 204.30 as of 2026-09-05
    const s1 = await runNightly({ date: "2026-09-07", mailer: failing, appUrl: "https://hitstreak.test" });
    expect(s1.emailFailed).toBe(1);
    expect(Number((await alertRow(id)).armed)).toBe(1);
    const s2 = await runNightly({ date: "2026-09-07", mailer: null, appUrl: "https://hitstreak.test" });
    expect(s2).toMatchObject({ emailDisabled: true, skippedNoMailer: 1 });
    expect(Number((await alertRow(id)).armed)).toBe(1);
  });
  it("ignores an unpriced printing", async () => {
    await createAlert("u2", { printingId: seed.printings.bundle, direction: "below", threshold: 5 });
    const s = await runNightly({ date: "2026-09-07", mailer: capture().mailer, appUrl: "https://hitstreak.test" });
    expect(s.alerts).toBeGreaterThanOrEqual(2);
    expect(s.fired + s.rearmed).toBeLessThanOrEqual(s.alerts - 1);
  });
  it("rejects a malformed date", async () => {
    await expect(runNightly({ date: "2026-9-7", mailer: null, appUrl: "x" })).rejects.toThrow(/YYYY-MM-DD/);
  });
});
```

(Adjust the "ignores an unpriced printing" assertions to whatever is exact once the earlier tests' state is known — the point is that the `bundle` alert neither fires nor re-arms. The `vi` import is unused if you don't need it; drop it.)

- [x] **Step 3: Implement `ingest/nightly.ts`:**

```ts
// Nightly job, run by the "Daily price ingest" workflow right after ingest/daily.ts:
//   1. materialize collection_history for `date` (every collection, every user — one statement),
//   2. evaluate every price alert against the market price in force on `date` and email crossings.
// Idempotent per date (spec §9): history rows are upserted, and an alert that already fired stays
// disarmed until the price crosses back, so a re-run never emails twice. An email that fails — or
// can't be sent because Resend isn't configured — leaves the alert armed so it retries next night.
import { db, closeDb } from "@/lib/db";
import { isCalendarDate } from "./prices";
import { evaluateAlert, type Direction } from "@/lib/alerts";
import { alertEmail, mailerFromEnv, type Mailer } from "./mailer";

export interface NightlyOptions {
  date: string;          // YYYY-MM-DD — the ingest date whose prices are "today"
  mailer: Mailer | null; // null = email disabled (logs what it would have sent)
  appUrl: string;        // origin for links in emails
  now?: () => string;    // ISO timestamp for last_fired_at; tests pin it
}

export interface NightlySummary {
  date: string; collections: number; alerts: number; fired: number; rearmed: number;
  emailFailed: number; skippedNoMailer: number; emailDisabled: boolean; elapsedMs: number;
}

/** INSERT … SELECT over all collections: value = Σ quantity × market in force on `date` (the newest
 *  snapshot at or before it). Unpriced copies contribute nothing; an empty collection is 0. */
export async function materializeCollectionHistory(date: string): Promise<number> {
  const c = await db();
  const r = await c.execute({
    sql: `INSERT INTO collection_history (collection_id, date, total_value)
          SELECT po.id, ?, COALESCE(SUM(ci.quantity * (
                   SELECT ps.market FROM price_snapshots ps
                   WHERE ps.printing_id = ci.printing_id AND ps.date <= ? ORDER BY ps.date DESC LIMIT 1)), 0)
          FROM collections po LEFT JOIN collection_items ci ON ci.collection_id = po.id
          WHERE true GROUP BY po.id
          ON CONFLICT(collection_id, date) DO UPDATE SET total_value = excluded.total_value`,
    args: [date, date],
  });
  return r.rowsAffected;
}

interface AlertJoin {
  id: number; email: string; cardId: number; cardName: string; setName: string; number: string | null; subtype: string;
  direction: Direction; threshold: number; armed: boolean; market: number | null;
}

async function loadAlerts(date: string): Promise<AlertJoin[]> {
  const c = await db();
  const rows = (await c.execute({
    sql: `SELECT a.id, a.direction, a.threshold, a.armed, u.email,
                 ca.id AS card_id, ca.name AS card_name, ca.number, se.name AS set_name, p.subtype,
                 (SELECT ps.market FROM price_snapshots ps WHERE ps.printing_id = a.printing_id AND ps.date <= ? ORDER BY ps.date DESC LIMIT 1) AS market
          FROM price_alerts a
          JOIN "user" u ON u.id = a.user_id
          JOIN printings p ON p.id = a.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          ORDER BY a.id`,
    args: [date],
  })).rows;
  return rows.map((x) => ({
    id: Number(x.id), email: String(x.email), cardId: Number(x.card_id), cardName: String(x.card_name), setName: String(x.set_name),
    number: x.number == null ? null : String(x.number), subtype: String(x.subtype), direction: String(x.direction) as Direction,
    threshold: Number(x.threshold), armed: Number(x.armed) === 1, market: x.market == null ? null : Number(x.market),
  }));
}

export async function runNightly(opts: NightlyOptions): Promise<NightlySummary> {
  if (!isCalendarDate(opts.date)) throw new Error(`runNightly: date must be YYYY-MM-DD, got ${opts.date}`);
  const startedAt = Date.now();
  const now = opts.now ?? (() => new Date().toISOString());
  const s: NightlySummary = { date: opts.date, collections: 0, alerts: 0, fired: 0, rearmed: 0, emailFailed: 0, skippedNoMailer: 0, emailDisabled: opts.mailer === null, elapsedMs: 0 };

  s.collections = await materializeCollectionHistory(opts.date);
  console.log(`[nightly] collection_history: ${s.collections} collections valued as of ${opts.date}`);

  const c = await db();
  const alerts = await loadAlerts(opts.date);
  s.alerts = alerts.length;
  for (const a of alerts) {
    const decision = evaluateAlert(a, a.market);
    if (decision === "rearm") {
      await c.execute({ sql: "UPDATE price_alerts SET armed = 1 WHERE id = ?", args: [a.id] });
      s.rearmed++;
    } else if (decision === "fire") {
      if (!opts.mailer) {
        // Not marked fired: the crossing is still pending and emails once Resend is configured.
        console.warn(`[nightly] alert ${a.id} crossed (${a.cardName} ${a.direction} ${a.threshold}, now ${a.market}) but email is disabled`);
        s.skippedNoMailer++;
        continue;
      }
      try {
        await opts.mailer.send(alertEmail({
          to: a.email, cardName: a.cardName, setName: a.setName, number: a.number, subtype: a.subtype,
          direction: a.direction, threshold: a.threshold, market: a.market!, cardUrl: new URL(`/cards/${a.cardId}`, opts.appUrl).href,
        }));
        await c.execute({ sql: "UPDATE price_alerts SET armed = 0, last_fired_at = ?, last_fired_price = ? WHERE id = ?", args: [now(), a.market, a.id] });
        s.fired++;
      } catch (e) {
        // Stays armed → retried next night (spec §9).
        console.error(`[nightly] alert ${a.id} email FAILED: ${e instanceof Error ? e.message : String(e)}`);
        s.emailFailed++;
      }
    }
  }
  s.elapsedMs = Date.now() - startedAt;
  console.log(`[nightly] alerts=${s.alerts} fired=${s.fired} rearmed=${s.rearmed} emailFailed=${s.emailFailed} skippedNoMailer=${s.skippedNoMailer} emailDisabled=${s.emailDisabled} elapsedMs=${s.elapsedMs}`);
  return s;
}

// CLI entry: npx tsx ingest/nightly.ts [YYYY-MM-DD]   (or INGEST_DATE, like ingest/daily.ts)
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("ingest/nightly.ts");
if (isMain) {
  const raw = process.argv[2] ?? process.env.INGEST_DATE;
  const argDate = raw && raw.trim() ? raw.trim() : undefined;
  if (argDate !== undefined && !isCalendarDate(argDate)) {
    console.error("usage: tsx ingest/nightly.ts [YYYY-MM-DD]");
    process.exit(2);
  }
  const appUrl = process.env.APP_URL ?? process.env.BETTER_AUTH_URL;
  if (!appUrl) {
    console.error("APP_URL (or BETTER_AUTH_URL) is required for links in alert emails");
    process.exit(2);
  }
  void runNightly({ date: argDate ?? new Date().toISOString().slice(0, 10), mailer: mailerFromEnv(), appUrl })
    .then((s) => {
      closeDb();
      console.log(`NIGHTLY_SUMMARY ${JSON.stringify(s)}`);
      // A crossing that could not be emailed is a real gap the owner must know about — and in CI a
      // pending alert with Resend unconfigured is exactly that (GitHub emails on failure).
      if (s.emailFailed > 0 || (process.env.CI && s.skippedNoMailer > 0)) process.exitCode = 1;
    })
    .catch((e) => { console.error(e); closeDb(); process.exitCode = 1; });
}
```

- [x] **Step 4: Workflow + env.** In `.github/workflows/daily-ingest.yml` add after the ingest step:

```yaml
      # Runs even when the ingest step failed part-way: whatever prices did land are worth
      # materializing, and the job is already red from the step above.
      - name: Nightly — collection history + price alerts
        if: ${{ !cancelled() }}
        run: npx tsx ingest/nightly.ts
        env:
          INGEST_DATE: ${{ inputs.date }}
          TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          ALERT_FROM_EMAIL: ${{ secrets.ALERT_FROM_EMAIL }}
          APP_URL: ${{ secrets.APP_URL }}
```

`.env.example` gains:

```
# Resend (alert emails). Optional: without both, the nightly logs crossings instead of emailing
# (and fails the CI job so you notice). ALERT_FROM_EMAIL must be on a domain verified in Resend.
RESEND_API_KEY=
ALERT_FROM_EMAIL=Hitstreak <alerts@hitstreak.app>
# Public origin used for links in emails (GitHub Actions secret). Falls back to BETTER_AUTH_URL.
APP_URL=
```

- [x] **Step 5:** tests, typecheck, lint. Locally: `$env:TURSO_DATABASE_URL='file:hitstreak.local.db'; $env:APP_URL='http://localhost:3000'; npx tsx ingest/nightly.ts` → `NIGHTLY_SUMMARY` with `collections ≥ 1`, then `/collections/2` shows a materialized point. **Commit** — `feat(nightly): materialize collection_history and evaluate/email price alerts after the daily ingest`

---

### Task 7: Alerts UI

**Files:** create `lib/action-utils.ts`, `app/(app)/alerts/actions.ts`, `app/(app)/alerts/AlertList.tsx`, `app/(app)/alerts/NewAlertForm.tsx`, `components/ui/useCardSearch.ts`, `tests/alert-actions.test.ts`, `tests/ui/alert-list.test.tsx`, `tests/ui/new-alert-form.test.tsx`, `tests/ui/card-row-tone.test.tsx`; modify `app/(app)/alerts/page.tsx`, `app/(app)/collections/actions.ts`, `app/(app)/collections/[id]/AddItemDialog.tsx`, `components/ui/CardRow.tsx`, `components/ui/index.ts`, `app/dev/ui/page.tsx`, `docs/design/README.md`

- [x] **Step 1: Shared action helpers.** Create `lib/action-utils.ts` with `ActionResult`, `assertId`, `withUser` moved verbatim from `app/(app)/collections/actions.ts` (no `"use server"` in this file — it exports non-async values); the collections action file imports them. `tests/actions.test.ts` must still pass unchanged.

- [x] **Step 2: Alert actions** — `app/(app)/alerts/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { withUser, assertId } from "@/lib/action-utils";
import * as A from "@/lib/alerts";

export async function createAlertAction(input: A.CreateAlertInput) {
  const r = await withUser((u) => A.createAlert(u, { ...input, printingId: assertId(input.printingId) }));
  if (r.ok) revalidatePath("/alerts");
  return r;
}
export async function deleteAlertAction(id: number) {
  const r = await withUser(async (u) => {
    if (!(await A.deleteAlert(u, assertId(id)))) throw new Error("Alert not found");
  });
  if (r.ok) revalidatePath("/alerts");
  return r;
}
```

`tests/alert-actions.test.ts`: no session; invalid id; create for u1 returns the id and revalidates `/alerts`; validation error surfaces as `{ ok: false, error }`; u2 cannot delete u1's alert (`Alert not found`); u1 can.

- [x] **Step 3: `CardRow` tone.** Add `tone?: "default" | "inverted"` (default `"default"`): inverted = `bg-chip text-chip-ink border-chip`, name `text-chip-ink`, subtitle `text-chip-ink/70`, and the `right` slot inherits colour. Test `tests/ui/card-row-tone.test.tsx`: default row has `bg-surface`; inverted has `bg-chip`. Gallery: one inverted row. Design README: "Triggered alert row → `CardRow tone="inverted"`".

- [x] **Step 4: `useCardSearch` hook** — `components/ui/useCardSearch.ts`:

```ts
"use client";
import { useEffect, useState } from "react";
import type { PrintingPrice } from "@/lib/catalog";

export interface CardHit { cardId: number; name: string; subtitle: string; imageUrl: string | null; printings: PrintingPrice[] }

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const MAX_RESULTS = 10;

/** Debounced type-ahead against /api/search. Results are tagged with the query they answer, so a
 *  stale page is simply not returned (`hits` is [] until the current query has settled). */
export function useCardSearch(query: string, enabled = true) {
  const q = query.trim();
  const [results, setResults] = useState<{ query: string; cards: CardHit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || q.length < MIN_QUERY) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error("search failed");
        const body = await res.json();
        if (!live) return;
        const cards: CardHit[] = (body.hits ?? []).slice(0, MAX_RESULTS).map(
          (h: { cardId: number; name: string; setName: string; number: string | null; imageUrl: string | null; printings: PrintingPrice[] }) => ({
            cardId: h.cardId, name: h.name, subtitle: [h.setName, h.number].filter(Boolean).join(" · "), imageUrl: h.imageUrl, printings: h.printings,
          })
        );
        setResults({ query: q, cards });
        setError(null);
      } catch {
        if (live) setError("Could not search right now. Try again.");
      }
    }, DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [q, enabled]);

  const settled = results?.query === q;
  return { hits: settled ? results!.cards : [], settled, error, reset: () => setResults(null) };
}
```

Refactor `AddItemDialog` to use it (`const { hits, settled, error: searchError, reset } = useCardSearch(q, open && selected == null)`; call `reset()` in `close`; render `searchError ?? error`). `tests/ui/add-item-dialog.test.tsx` must pass unchanged — it is the safety net for this refactor.

- [x] **Step 5: `NewAlertForm` (client)** — `app/(app)/alerts/NewAlertForm.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AlertCard, Direction } from "@/lib/alerts";
import { formatMoney } from "@/lib/format";
import { Button, CardRow, Input, Pill, SearchField } from "@/components/ui";
import { useCardSearch, type CardHit } from "@/components/ui/useCardSearch";
import { createAlertAction } from "./actions";

type Picked = Omit<AlertCard, "printingId">;

/** Search → printing → direction → threshold → create. `preselected` (from `/alerts?printing=`)
 *  skips the search step and starts on that printing. */
export default function NewAlertForm({ preselected }: { preselected?: AlertCard | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [card, setCard] = useState<Picked | null>(preselected ?? null);
  const [printingId, setPrintingId] = useState<number | null>(preselected?.printingId ?? null);
  const [direction, setDirection] = useState<Direction>("below");
  const [threshold, setThreshold] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { hits, settled, error: searchError } = useCardSearch(q, card == null);

  const printing = card?.printings.find((p) => p.printingId === printingId) ?? null;
  const t = Number(threshold);
  const hint =
    printing?.market != null && printing.market > 0 && threshold.trim() !== "" && Number.isFinite(t) && t > 0
      ? `${Math.round((Math.abs(t - printing.market) / printing.market) * 100)}% ${t >= printing.market ? "over" : "under"} today`
      : null;

  function pick(h: CardHit) {
    setCard(h);
    setPrintingId(h.printings[0]?.printingId ?? null);
    setError(null);
  }

  async function submit() {
    if (printingId == null) { setError("Pick a printing first."); return; }
    setBusy(true); setError(null);
    try {
      const res = await createAlertAction({ printingId, direction, threshold: t });
      if (!res.ok) { setError(res.error); return; }
      setCard(preselected ?? null); setPrintingId(preselected?.printingId ?? null); setThreshold(""); setQ("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-[22px] leading-none text-ink">New alert</h2>

      {card == null ? (
        <>
          <SearchField value={q} onChange={setQ} placeholder="Search cards…" />
          {hits.length > 0 && (
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {hits.map((h) => (
                <li key={h.cardId}><CardRow name={h.name} subtitle={h.subtitle} imageUrl={h.imageUrl} onClick={() => pick(h)} /></li>
              ))}
            </ul>
          )}
          {settled && hits.length === 0 && <p className="text-[13px] text-dim">No cards match “{q.trim()}”.</p>}
        </>
      ) : (
        <>
          <CardRow name={card.name} subtitle={card.subtitle} imageUrl={card.imageUrl}
            right={<Button variant="secondary" size="sm" onClick={() => { setCard(null); setPrintingId(null); }}>Change</Button>} />

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-dim">Printing</span>
            <div className="flex flex-wrap gap-2">
              {card.printings.map((p) => (
                <Pill key={p.printingId} selected={p.printingId === printingId} onClick={() => setPrintingId(p.printingId)}>
                  {p.subtype} · {formatMoney(p.market)}
                </Pill>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-dim">Notify me when the market price</span>
            <div className="grid grid-cols-2 gap-2">
              <Pill selected={direction === "above"} onClick={() => setDirection("above")}>rises above</Pill>
              <Pill selected={direction === "below"} onClick={() => setDirection("below")}>drops below</Pill>
            </div>
            <label className="flex flex-col gap-1.5 text-xs text-dim">
              Price (USD)
              <Input type="number" min={0.01} step={0.01} inputMode="decimal" placeholder={printing?.market != null ? formatMoney(printing.market).slice(1) : "0.00"}
                value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </label>
            {hint && <span className="num text-xs text-dim">{hint}</span>}
          </div>

          <Button onClick={submit} disabled={busy || threshold.trim() === ""}>Create alert</Button>
        </>
      )}

      {(error ?? searchError) && <p role="alert" className="text-[13px] text-accent">{error ?? searchError}</p>}
    </div>
  );
}
```

`tests/ui/new-alert-form.test.tsx` (mock `./actions` `createAlertAction`, `next/navigation`, stub `fetch` like `add-item-dialog.test.tsx`): search → pick Pikachu → printing pills present, first selected; "drops below" selected by default; typing `0.20` shows `20% under today` (market 0.25); Create → `createAlertAction({ printingId: 2, direction: "below", threshold: 0.2 })` and `refresh`; "rises above" + `0.5` → direction `above`, hint `100% over today`; action error → alert; preselected card skips search and starts on that printing (`printingId: 3` selected when preselected.printingId is 3); Create is disabled with an empty price.

- [x] **Step 6: `AlertList` (client)** — `app/(app)/alerts/AlertList.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Alert } from "@/lib/alerts";
import { formatMoney, formatPercent } from "@/lib/format";
import { Button, CardRow } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { deleteAlertAction } from "./actions";

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const line = (a: Alert) => `${a.direction === "above" ? "Rises above" : "Drops below"} ${formatMoney(a.threshold)}`;

function Group({ title, alerts, onDelete, busyId }: { title: string; alerts: Alert[]; onDelete: (a: Alert) => void; busyId: number | null }) {
  if (alerts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{title}</span>
      <ul className="flex flex-col gap-2">
        {alerts.map((a) => {
          const triggered = !a.armed;
          const detail = triggered
            ? `${line(a)} · emailed ${a.lastFiredAt ? day.format(new Date(a.lastFiredAt)) : "—"}`
            : line(a);
          return (
            <li key={a.id}>
              <CardRow
                tone={triggered ? "inverted" : "default"}
                name={a.cardName}
                subtitle={`${[a.setName, a.number, a.subtype].filter(Boolean).join(" · ")} — ${detail}`}
                imageUrl={a.imageUrl}
                right={
                  <>
                    <span className="text-sm font-semibold">{formatMoney(a.market)}</span>
                    {triggered ? (
                      <span className="text-[11px] opacity-70">re-arms {a.direction === "above" ? "below" : "above"} {formatMoney(a.threshold)}</span>
                    ) : a.change30d ? (
                      // Same up/down tone as the mockup's watching rows; a 0 change stays dim.
                      <span className={cn("text-[11px]", a.change30d.amount > 0 && "text-gain", a.change30d.amount < 0 && "text-accent", a.change30d.amount === 0 && "text-dim")}>
                        {formatPercent(a.change30d.ratio)} · 30D
                      </span>
                    ) : (
                      <span className="text-[11px] text-dim">no 30D history</span>
                    )}
                    <Button variant="secondary" size="sm" className="mt-1" disabled={busyId === a.id}
                      aria-label={`Delete alert for ${a.cardName}`} onClick={() => onDelete(a)}>
                      Delete
                    </Button>
                  </>
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function AlertList({ alerts }: { alerts: Alert[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function remove(a: Alert) {
    if (!window.confirm(`Delete the ${line(a).toLowerCase()} alert for ${a.cardName}?`)) return;
    setBusyId(a.id); setError(null);
    try {
      const res = await deleteAlertAction(a.id);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Group title="Triggered" alerts={alerts.filter((a) => !a.armed)} onDelete={remove} busyId={busyId} />
      <Group title="Watching" alerts={alerts.filter((a) => a.armed)} onDelete={remove} busyId={busyId} />
      {error && <p role="alert" className="text-[13px] text-accent">{error}</p>}
    </div>
  );
}
```

`tests/ui/alert-list.test.tsx`: a triggered and a watching alert render under "Triggered" / "Watching"; the triggered row shows `emailed Sep 7` and `re-arms below $1,450.00`; the watching row shows `+33.2% · 30D` with the `text-gain` class (and a negative change gets `text-accent`); Delete confirms then calls `deleteAlertAction(id)` and refreshes; dismissing the confirm does nothing; an action error renders an alert.

- [x] **Step 7: The page** — `app/(app)/alerts/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { listAlerts, getAlertCard } from "@/lib/alerts";
import { SectionHeading, Panel, EmptyState } from "@/components/ui";
import AlertList from "./AlertList";
import NewAlertForm from "./NewAlertForm";

export const metadata = { title: "Alerts — Hitstreak" };
export const dynamic = "force-dynamic";

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  const { printing } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const userId = session.user.id;
  const printingId = typeof printing === "string" ? parseRouteId(printing) : null;
  const [alerts, preselected] = await Promise.all([listAlerts(userId), printingId == null ? null : getAlertCard(userId, printingId)]);
  const watching = alerts.filter((a) => a.armed).length;

  return (
    <div className="grid gap-10 md:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <SectionHeading as="h1" title="Price alerts" caption={`${watching} watching · checked nightly after the 21:00 UTC price sync`} />
        {alerts.length === 0 ? (
          <EmptyState title="No alerts yet" body="Use New alert to pick a card and set a price line — you get one email when it crosses." />
        ) : (
          <AlertList alerts={alerts} />
        )}
      </div>
      <div className="flex flex-col gap-4">
        <Panel><NewAlertForm preselected={preselected} /></Panel>
        <Panel className="flex flex-col gap-2 text-[13px] text-muted">
          <span className="font-semibold text-ink">How alerts work</span>
          <p>Prices sync once a day. Each alert emails you once when it crosses, then re-arms after the price crosses back — no repeat emails while it stays past the line.</p>
          <p>Delivered to your account email.</p>
        </Panel>
      </div>
    </div>
  );
}
```

(`NewAlertForm` is keyed off `preselected?.printingId` if you find the form doesn't reset when the query string changes: `<NewAlertForm key={preselected?.printingId ?? "search"} …/>`.)

- [x] **Step 8:** `npm test`, typecheck, lint. Manually: `/cards/22189` → "Set a price alert" → form opens on that printing; create one; `/alerts` lists it under Watching; run `npx tsx ingest/nightly.ts` locally with a threshold that crosses → moves to Triggered (email disabled locally → stays Watching; verify the warning line instead). **Commit** — `feat(alerts): alerts page with grouped list and new-alert form; shared card search hook; CardRow tone`

---

### Task 8: Sign-up gate

**Files:** create `lib/signup-gate.ts`, `tests/signup-gate.test.ts`; modify `lib/auth.ts`, `app/(auth)/sign-up/page.tsx`, `.env.example`

- [x] **Step 1: Failing tests** — `tests/signup-gate.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("signup-gate");
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long-000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.SIGNUP_ALLOWLIST = " Renzo@Example.com, friend@example.com ,";
import { db, closeDb } from "@/lib/db";
import { parseAllowlist, signupAllowed } from "@/lib/signup-gate";

afterAll(() => { closeDb(); tmp.clean(); });

describe("allowlist parsing", () => {
  it("is open when unset or blank, otherwise a lowercased set", () => {
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist("  ")).toBeNull();
    expect([...parseAllowlist(" A@x.com,b@y.com, ")!]).toEqual(["a@x.com", "b@y.com"]);
  });
  it("matches case-insensitively and rejects non-strings", () => {
    const allow = parseAllowlist("a@x.com");
    expect(signupAllowed("A@X.COM", allow)).toBe(true);
    expect(signupAllowed("b@x.com", allow)).toBe(false);
    expect(signupAllowed(42, allow)).toBe(false);
    expect(signupAllowed("anyone", null)).toBe(true);
  });
});

describe("Better Auth sign-up hook", () => {
  it("lets an allowlisted email register and refuses everyone else", async () => {
    await db();
    const { auth } = await import("@/lib/auth");
    const ok = await auth.api.signUpEmail({ body: { email: "renzo@example.com", password: "correct horse battery", name: "Renzo" }, asResponse: true });
    expect(ok.status).toBe(200);

    // A hooks.before APIError is NOT converted to a Response on direct auth.api.* calls (only the
    // endpoint handler is wrapped — better-auth/dist/api/dispatch.mjs `runBeforeHooks` re-throws),
    // even with asResponse: true: the call rejects with the APIError.
    await expect(
      auth.api.signUpEmail({ body: { email: "stranger@example.com", password: "correct horse battery", name: "S" } })
    ).rejects.toMatchObject({ statusCode: 403, body: { message: expect.stringMatching(/invite/i) } });

    // The HTTP surface the app really uses (AuthForm → authClient → POST /api/auth/sign-up/email)
    // turns it into a 403 JSON response. `origin` must match BETTER_AUTH_URL for the origin check.
    const http = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "stranger@example.com", password: "correct horse battery", name: "S" }),
      })
    );
    expect(http.status).toBe(403);
    expect((await http.json()).message).toMatch(/invite/i);

    const rows = await (await db()).execute("SELECT email FROM user ORDER BY email");
    expect(rows.rows.map((r) => r.email)).toEqual(["renzo@example.com"]);
  });
  it("still lets anyone sign in", async () => {
    const { auth } = await import("@/lib/auth");
    const res = await auth.api.signInEmail({ body: { email: "renzo@example.com", password: "correct horse battery" }, asResponse: true });
    expect(res.status).toBe(200);
  });
});
```

- [x] **Step 2: Implement.** `lib/signup-gate.ts`:

```ts
// lib/signup-gate.ts
// SIGNUP_ALLOWLIST gates registration (spec §13: gate sign-up before the app is public). Unset or
// blank = open sign-up (local dev, the very first deploy). Set = a comma-separated list of the only
// addresses that may register; everyone else gets 403 from the Better Auth hook in lib/auth.ts.
export function parseAllowlist(raw: string | undefined): Set<string> | null {
  const list = (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 ? null : new Set(list);
}

export function signupAllowed(email: unknown, allow: Set<string> | null): boolean {
  if (allow === null) return true;
  return typeof email === "string" && allow.has(email.trim().toLowerCase());
}

export const isSignupGated = () => parseAllowlist(process.env.SIGNUP_ALLOWLIST) !== null;
```

`lib/auth.ts`: `import { createAuthMiddleware, APIError } from "better-auth/api";` and

```ts
const allowlist = parseAllowlist(process.env.SIGNUP_ALLOWLIST);
…
  hooks: {
    // Registration gate. Sign-in, sign-out and session calls are untouched.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return;
      if (!signupAllowed(ctx.body?.email, allowlist)) {
        throw new APIError("FORBIDDEN", { message: "Sign-ups are invite-only right now." });
      }
    }),
  },
```

(Check `node_modules/@better-auth/core/dist/types/init-options.d.mts` `hooks` and `better-auth/api` exports if the import path differs; `ctx.body` is the raw request body; `ctx.path` is the endpoint path without the `/api/auth` base.) **Keep `throw new APIError(...)` — do not return a Response from the hook.** On the `auth.api.*` path a before-hook APIError is re-thrown (that is why the test asserts a rejection there), while the HTTP route handler converts it to a 403 JSON body that `AuthForm` shows via `res.error.message`. If the test fails, fix the test, not the hook.

`app/(auth)/sign-up/page.tsx`: under the `<h1>`, `{isSignupGated() && <p className="text-[13px] text-muted">Sign-ups are invite-only right now.</p>}`. `.env.example`:

```
# Registration gate. Blank = anyone can sign up (local dev). Set before the app is public:
# comma-separated emails that may register; everyone else gets "invite-only".
SIGNUP_ALLOWLIST=
```

- [x] **Step 3:** `npm test` (the existing `tests/auth*.test.ts` run with the variable unset and must still pass), typecheck, lint. **Commit** — `feat(auth): SIGNUP_ALLOWLIST gate on email sign-up`

---

### Task 9: Docs, spec amendments, plan bookkeeping, merge prep

- [x] README: Status → Phase 3 complete (charts, nightly, share links, alerts, gate); Screens: `/s/[token]`, `/alerts` real, `/cards/[id]` + `/collections/[id]` charts; Ingestion: `ingest/nightly.ts` line + secrets `RESEND_API_KEY`, `ALERT_FROM_EMAIL`, `APP_URL`; Auth: `SIGNUP_ALLOWLIST`; a "Before going public" checklist (set `SIGNUP_ALLOWLIST`, Resend domain, secrets).
- [x] Spec amendments (edit in place, keep the date-stamped note):
  - §4 table row "Nightly compute": **GitHub Actions step after the daily ingest** (`ingest/nightly.ts`) — not Vercel Cron → endpoint. Reason: the Actions job already holds the DB credentials and runs immediately after the prices land; no shared secret, no function duration cap, and no deployed app required for history to accumulate.
  - §6 step 5 rewritten accordingly.
  - §7 Sharing: note cost basis/gain are excluded from the public view. Card detail: printing pills on the chart. Alerts: "v1 has no edit — changing a threshold or direction is delete + recreate (which re-arms and drops `last_fired_at`)"; an alert whose line is already crossed when created emails on the first nightly.
  - §13: strike "Gate sign-up" (done: `SIGNUP_ALLOWLIST`); add new follow-ups: email verification before public launch (alerts email whatever address was registered — with the allowlist unset, anyone could point alerts at a third party's inbox; `requireEmailVerification` + a Resend sender closes it); `listAlerts` does two queries per alert for the 30-day change; `materializeCollectionHistory` is one statement over all collections (fine for hundreds of users, revisit at thousands); alert send + disarm are two non-transactional writes (a DB failure right after a successful send re-emails next night — at-least-once by design); no per-user daily email cap beyond `MAX_ALERTS_PER_USER`; share page has no rate limit (128-bit tokens make enumeration infeasible, but add one before public); `RangePills` scroll position depends on `Pill scroll={false}` (Next `Link`); the alerts form threshold hint rounds to whole percent; `Button size="sm"` replaced ad-hoc `min-h-8` overrides — grep for any new ones in review.
- [x] `docs/design/README.md` "Implemented as": `LineChart`, `RangePills`, `CardRow tone="inverted"`.
- [x] Tick this plan's boxes; add "Executed — deviations" like Phase 2b's.
- [ ] Final whole-branch review → fix → push → CI green → merge to `main`.

## Self-review notes

- Spec coverage: §5 tables ✔ (T1); §6 step 5 nightly ✔ (T6, as an Actions step — amended); §7 collections chart ✔ (T3), card detail chart + holders + alert shortcut ✔ (T3), sharing `/s/[token]` + toggle/regenerate ✔ (T4), alerts create/list/delete + email content ✔ (T5–T7; no update — recorded in the §7 amendment); §9 idempotent nightly / retry-on-failure / disabled links 404 ✔ (T6, T4); §10 alert threshold/re-arm unit tests ✔ (T5), share boundary tests ✔ (T4), auth boundary on new tables ✔ (T1, T4, T5); §13 gate sign-up ✔ (T8).
- Type consistency: `Point`/`Range` from `lib/history` used by `LineChart`, `RangePills`, three pages; `chartFrom`/`withLivePoint`/`RANGE_CAPTION` used identically on the card, collection and share pages; `ShareLink` shared by data layer, actions, `SharePanel` (whose `run<T>` is generic because `disableShareAction` returns `ActionResult<void>`); `AlertCard`/`Direction`/`Alert`/`CreateAlertInput` from `lib/alerts` used by nightly, actions, form, list; `Mailer`/`Mail` from `ingest/mailer`; `withUser`/`assertId` from `lib/action-utils` used by both action files.
- Reviewed 2026-09-07 by four independent reviewers + adversarial verification before execution; 16 confirmed findings folded in (SharePanel generic `run`, Better Auth before-hook error surfacing in tests, nullable `chartPrinting`, `All`-range axis anchoring, live point on empty history, `Button size="sm"` for the 44px rule, pinned `asOf` in the alerts test, copy fixes).
- Ownership: every new read/write joins `collections.user_id` or filters `price_alerts.user_id`; the share token authorizes exactly one collection and the public shape strips cost; the nightly is the only cross-user reader and runs outside the app.

## Executed 2026-09-08 — deviations

Shipped on `phase-3/history-share-alerts` across Tasks 1–8 (`b135022` … `b8e3840`). Where the code
differs from the plan above:

- **Card page cleanup.** Replacing the "Charts arrive in Phase 3" `EmptyState` left `changeText` and
  the `formatDelta` / `formatPercent` imports unused, so they went too (lint); the 30-day change is
  rendered by `PriceDelta` alone.
- **Extra fix commit `72c98bc`.** The four scrypt-bound Better Auth tests (`tests/auth.test.ts`,
  `tests/auth-fresh.test.ts`) time out under the full suite's one-worker-per-file load while passing
  alone; they carry explicit 20s per-test timeouts rather than a global `testTimeout`.
  `tests/signup-gate.test.ts` (Task 8) follows the same convention for its two password-hashing tests.
  No product code changed.
- **`useCardSearch.reset` is memoised** (`useCallback`) instead of the plan's inline arrow, so
  `AddItemDialog`'s memoised `close` keeps a stable identity across renders.
- **`NewAlertForm` is keyed on `preselected?.printingId`** — the plan's optional suggestion, applied
  because the form seeds its state from props on mount only; arriving at `/alerts?printing=` while
  already on the page would otherwise not restart it.
- **`useCardSearch` is imported by path** (`@/components/ui/useCardSearch`), not re-exported from
  `components/ui/index.ts` — Task 7's file list named `index.ts`, but it is a hook, not a primitive,
  and the plan's own code imported it by path.
- **Tests beyond the plan.** `tests/ui/primitives-a.test.tsx` also asserts `size` never reaches the
  DOM; `tests/ui/share-panel.test.tsx` covers a disabled link re-enabling, the clipboard-unavailable
  fallback, a dismissed confirm and a thrown action; `tests/ui/new-alert-form.test.tsx` covers a
  non-first printing being sent, "Change" returning to search, a one-character query issuing no fetch
  and a thrown action; `tests/ui/alert-list.test.tsx` covers an empty group being omitted and the
  "no 30D history" fallback. The nightly "ignores an unpriced printing" test asserts the exact state
  (`alerts: 3, fired: 1` — the Shanks alert left armed by the failing-mailer test fires here; the
  Booster Bundle row is untouched), as the plan asked.
- **Manual browser checks were substituted.** Task 3: a throwaway jsdom render test (deleted before
  commit) covering `?range=1y`, a printing-less card and a collection at `?range=all`. Task 4: a scratch
  copy of the repo on a throwaway DB under `next dev --webpack -p 3112`, not the running dev server.
  Task 6: the `/collections/2` check became a direct `getCollectionHistory` call after the CLI run.
  Task 7: the running dev server with the already-signed-in browser pane, `window.confirm` stubbed
  for the cleanup delete, and the nightly run via `node --env-file=.env.local --import tsx
  ingest/nightly.ts`; local DB side effects net to zero apart from today's `collection_history` row.
- **Task 9's design-README item needed no edit** — Tasks 2 and 7 had already added the `LineChart`,
  `RangePills` and `CardRow tone="inverted"` rows and the `Button size="sm"` tap-target sentence.

### Pre-merge review fixes (2026-09-08)

The whole-branch review that closes Task 9 found these; fixed on this branch in
`fix: pre-merge review — …` / `docs: pre-merge review — …` commits:

- **Alerts are evaluated against `latest_prices`, not the run date's snapshot.** `loadAlerts` used the
  same as-of-`date` subquery as `materializeCollectionHistory` — right for history, wrong for the alert
  state machine, which is not order-aware. Re-running a failed night N (the workflow's `date` input)
  after night N+1 had fired an alert would have re-armed it on N's older price, and night N+2 would
  have emailed a duplicate; symmetrically an armed alert could fire on N's stale price and say
  "Market price today: <N's price>". `latest_prices` equals the newest snapshot in the scheduled run
  (the `ingest/prices.ts` invariant), so that path is unchanged; only an old-date re-run differs, where
  the current price is the right answer and matches `/alerts`. `tests/nightly.test.ts` now mirrors the
  invariant (it updates `latest_prices` alongside the snapshots it inserts) and adds the
  historical-re-run case (fired stays fired, a freshly armed alert does not fire, history is still
  valued as of the date).
- **`lib/ranges.ts`** holds the db-free history exports (re-exported by `lib/history.ts`);
  `RangePills` and `LineChart` import from it; `tests/ranges.test.ts` fails if anything under
  `components/ui` imports `lib/db` or `lib/history`. Resolves the first "known item" below.
- `ingest/mailer.ts` says why its one hex colour (`--muted`, light theme) is inlined.
- `GroupLabel` and a 22px `SectionHeading` size are recorded as primitive candidates in spec §13
  rather than built here — Phase 5 is where page patterns get promoted to primitives.
- Commit `2c502a3`'s message names the design README, which it did not touch (Tasks 2 and 7 had
  already made those edits). The branch is never force-pushed, so: drop "design README" from the
  squash-merge message.
- **`APP_URL` is required only once Resend is configured.** The CLI used to exit 2 without it before
  materializing anything, so a missing secret would have cost a night of `collection_history` even
  with email disabled (when the URL is never used). Now it exits 2 only when a mailer exists and
  there is no origin for the email links; README and `.env.example` say so.

### Known items, deliberately left

Also recorded in spec §13.

- ~~`lib/history.ts` statically imports `lib/db` and is reached from the client bundle through
  `components/ui/index.ts` → `RangePills`~~ — resolved by `lib/ranges.ts` (pre-merge review, above);
  `"server-only"` in `lib/db.ts` is still to do.
- `listAlerts` issues two queries per alert for the 30-day change (`thirtyDayChange`) — ~200 at the
  100-alert cap. `createAlert`'s cap is COUNT-then-INSERT, not atomic.
- `getSharedCollection` reads holdings twice (`getCollectionSummary` re-reads them).
- `materializeCollectionHistory` is one `INSERT … SELECT` over all collections; alert send + disarm are two
  non-transactional writes (at-least-once by design); no per-user daily email cap beyond
  `MAX_ALERTS_PER_USER`; `/s/[token]` has no rate limit.
- `HoldingsTable`'s Remove button still carries `ml-1 text-[13px] font-normal` — `text-[13px]` is
  redundant with `size="sm"`.
- On the collection page the range `PriceDelta` renders directly under the "vs. paid" one with no spacing
  element (cosmetic).
- The alerts form's threshold hint rounds to a whole percent; `RangePills` keeps the scroll position
  only through `Pill scroll={false}`.
- `tests/db.test.ts` was not extended for the three new tables; their coverage is
  `tests/history.test.ts`, `tests/share.test.ts`, `tests/alerts.test.ts`, `tests/nightly.test.ts`.
