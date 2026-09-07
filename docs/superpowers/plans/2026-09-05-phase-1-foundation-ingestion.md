# Hitstreak Phase 1 — Foundation & Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Hitstreak app and build the daily price-ingestion pipeline (tcgcsv → R2 raw archive → Turso catalog + write-on-change price snapshots) plus the historical backfill, running in GitHub Actions.

**Architecture:** Next.js App Router app (UI comes in Phase 2; this phase ships the data layer and standalone ingestion scripts run via `tsx`). Turso (libSQL) database with a self-initializing schema, license-hub style. Ingestion is a set of pure, injectable modules (HTTP client, catalog upsert, price diff, R2 archiver) orchestrated by a CLI entry point, scheduled by GitHub Actions at 21:00 UTC. Prices use **write-on-change**: `latest_prices` holds the current value per printing (O(1) reads + diff base); `price_snapshots` is append-only and only grows when a price actually changed.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict / Tailwind 4, `@libsql/client`, `@aws-sdk/client-s3` (R2), `tsx`, vitest.

**Reference:** Spec at `docs/superpowers/specs/2026-09-05-hitstreak-design.md`. tcgcsv API shapes at https://tcgcsv.com (category → groups → products → prices; all responses are `{ results: [...] }`).

**Conventions for this plan:**
- All tests run against a throwaway `file:` libSQL DB — **never `:memory:`** (schema is not shared across libSQL connections; license-hub lesson).
- Windows dev machine: `npm test` must pass locally; ingestion runs on ubuntu-latest in CI.
- Commit after every green test. Conventional-commit style messages.
- **Every "run tests" step also runs `npm run typecheck`** (added after Task 1's review: vitest does not type-check, `next build` does — catch type errors in the TDD loop, not at build time). Task 1 is complete; the vitest config is `vitest.config.mts`.

---

### Task 1: Scaffold Next.js app + vitest

**Files:**
- Create: Next.js scaffold (`package.json`, `app/`, `next.config.ts`, `tsconfig.json`, …)
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`
- Modify: `.gitignore` (add test DB artifacts)

- [ ] **Step 1: Scaffold into the existing repo**

Run from the repo root (`C:\webdev\personal\hitstreak`):

```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --use-npm --no-turbopack --skip-install
npm install
```

If create-next-app balks at the non-empty directory (docs/ + .git are present), scaffold to a temp dir and move everything except `.git` in:

```bash
npx create-next-app@latest ../hitstreak-tmp --typescript --tailwind --app --no-src-dir --import-alias "@/*" --use-npm --no-turbopack
# then: move all files/dirs from ../hitstreak-tmp into . (do not overwrite docs/ or .git), delete ../hitstreak-tmp
```

- [ ] **Step 2: Install runtime + dev dependencies**

```bash
npm install @libsql/client @aws-sdk/client-s3
npm install -D vitest tsx
```

- [ ] **Step 3: Create vitest config**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Add test script and smoke test**

In `package.json` scripts, add:

```json
"test": "vitest run"
```

```ts
// tests/smoke.test.ts
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs TypeScript tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Ignore test DB artifacts**

Append to `.gitignore`:

```
# test/local databases
.tmp-*.db*
*.local.db*
.env*.local
```

- [ ] **Step 6: Verify build and tests**

Run: `npm test` → Expected: 1 passed.
Run: `npm run build` → Expected: Next.js production build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with vitest toolchain"
```

---

### Task 2: Schema + async db client

**Files:**
- Create: `lib/schema.ts`
- Create: `lib/db.ts`
- Test: `tests/db.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/db.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { rmSync } from "node:fs";

const DB_FILE = ".tmp-db-test.db";
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;
delete process.env.TURSO_AUTH_TOKEN;

import { db, closeDb } from "@/lib/db";

afterAll(() => {
  closeDb();
  for (const f of [DB_FILE, `${DB_FILE}-shm`, `${DB_FILE}-wal`]) {
    try { rmSync(f); } catch { /* windows may hold the handle; ignore */ }
  }
});

describe("db()", () => {
  it("self-initializes the schema on first connection", async () => {
    const c = await db();
    const r = await c.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tables = r.rows.map((row) => row.name);
    for (const t of ["games", "sets", "cards", "printings", "price_snapshots", "latest_prices"]) {
      expect(tables).toContain(t);
    }
  });

  it("enforces uniqueness of (card_id, subtype) printings", async () => {
    const c = await db();
    await c.execute("INSERT INTO games (tcgplayer_category_id, name, slug) VALUES (3, 'Pokemon', 'pokemon')");
    await c.execute("INSERT INTO sets (game_id, tcgplayer_group_id, name) VALUES (1, 100, 'Test Set')");
    await c.execute("INSERT INTO cards (set_id, tcgplayer_product_id, name) VALUES (1, 555, 'Testmon')");
    await c.execute("INSERT INTO printings (card_id, subtype) VALUES (1, 'Normal')");
    await expect(
      c.execute("INSERT INTO printings (card_id, subtype) VALUES (1, 'Normal')")
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db.test.ts`
Expected: FAIL — cannot resolve `@/lib/db`.

- [ ] **Step 3: Write the schema module**

```ts
// lib/schema.ts
// Single source of truth for DDL. Executed idempotently on first connection
// per process (see lib/db.ts) — there is no separate migrate step.
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tcgplayer_category_id INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id),
    tcgplayer_group_id INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    code TEXT,
    release_date TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sets_game ON sets(game_id);

  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER NOT NULL REFERENCES sets(id),
    tcgplayer_product_id INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    number TEXT,
    rarity TEXT,
    image_url TEXT,
    attrs TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_id);
  CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);

  CREATE TABLE IF NOT EXISTS printings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id),
    subtype TEXT NOT NULL,
    UNIQUE (card_id, subtype)
  );

  -- Append-only history; a row exists only for days the price CHANGED.
  CREATE TABLE IF NOT EXISTS price_snapshots (
    printing_id INTEGER NOT NULL REFERENCES printings(id),
    date TEXT NOT NULL,
    market REAL, low REAL, mid REAL, high REAL,
    PRIMARY KEY (printing_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_date ON price_snapshots(date);

  -- Current price per printing: O(1) app reads and the write-on-change diff base.
  CREATE TABLE IF NOT EXISTS latest_prices (
    printing_id INTEGER PRIMARY KEY REFERENCES printings(id),
    date TEXT NOT NULL,
    market REAL, low REAL, mid REAL, high REAL
  );
`;
```

- [ ] **Step 4: Write the db client (license-hub pattern)**

```ts
// lib/db.ts
// libSQL (Turso) store. Remote over HTTP in prod; a local file: URL for tests.
import { createClient, type Client } from "@libsql/client";
import { SCHEMA_SQL } from "./schema";

let client: Client | null = null;
let schemaReady: Promise<unknown> | null = null;

export async function db(): Promise<Client> {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set");
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  if (!schemaReady) {
    // cache the promise so concurrent callers share one CREATE; reset on failure to retry
    schemaReady = client.executeMultiple(SCHEMA_SQL).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  await schemaReady;
  return client;
}

export function closeDb(): void {
  if (client) {
    client.close();
    client = null;
    schemaReady = null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/db.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/schema.ts lib/db.ts tests/db.test.ts
git commit -m "feat: self-initializing libSQL schema and async db client"
```

- [ ] **Step 7: Shared throwaway-DB test helper** (added after Task 2's review: on Windows the libSQL file handle can outlive `close()`, so a stale `.tmp-*.db` from a previous run makes the next run fail on UNIQUE constraints. Clean **before** and after.)

Create `tests/helpers/tmpdb.ts`:

```ts
// tests/helpers/tmpdb.ts
// Points lib/db at a throwaway file: libSQL database for one test file and
// removes stale copies both before and after the run (Windows can keep the
// handle open past close(), leaving a file that breaks the next run).
import { readdirSync, rmSync } from "node:fs";

export function tmpDb(name: string) {
  // pid-scoped so parallel vitest workers can never share a file even if a name is reused
  const prefix = `.tmp-${name}-`;
  const file = `${prefix}${process.pid}-test.db`;
  const clean = () => {
    // sweep this run's file AND leftovers from earlier runs (different pids) for this name
    let stale: string[] = [];
    try {
      stale = readdirSync(".").filter((f) => f.startsWith(prefix) && f.includes("-test.db"));
    } catch { /* cwd unreadable — nothing to sweep */ }
    for (const f of new Set([file, `${file}-shm`, `${file}-wal`, ...stale])) {
      try { rmSync(f); } catch { /* not present, or handle still held — ignore */ }
    }
  };
  clean();
  process.env.TURSO_DATABASE_URL = `file:${file}`;
  delete process.env.TURSO_AUTH_TOKEN;
  return { file, clean };
}
```

Then rewrite the preamble and teardown of `tests/db.test.ts` to use it (test bodies unchanged):

```ts
import { describe, it, expect, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("db");

import { db, closeDb } from "@/lib/db";

afterAll(() => {
  closeDb();
  tmp.clean();
});
```

(`db()` reads `TURSO_DATABASE_URL` lazily at first call, so it is fine that ESM hoists the `@/lib/db` import above the `tmpDb` call.)

Run: `npm test` twice in a row → both runs green (the second run proves stale-file cleanup works). `npm run typecheck` → exit 0.

```bash
git add tests/helpers/tmpdb.ts tests/db.test.ts
git commit -m "test: shared throwaway-DB helper that cleans stale files before and after"
```

Every later test file in this plan uses `tmpDb("<name>")` the same way.

Also add (same commit or a follow-up `chore:` commit) two lifecycle tests to `tests/db.test.ts` in a second `describe("db() lifecycle")` block: `closeDb()` followed by `db()` re-opens the same file and still sees the previously inserted printing; and with `TURSO_DATABASE_URL` deleted, `db()` rejects with `"TURSO_DATABASE_URL is not set"` (restore the env in `finally`).

**Decisions recorded in the spec (§5) after this task's review:** referential integrity is enforced by ingestion code + tests (SQLite FK pragmas are off by default and unreliable over Turso HTTP — do NOT add `PRAGMA foreign_keys`); money is `REAL` dollars rounded at display, never integer cents.

---

### Task 3: tcgcsv HTTP client

**Files:**
- Create: `ingest/tcgcsv.ts`
- Test: `tests/tcgcsv.test.ts`

The client is constructed with an injectable `fetchImpl` and `delayMs` so tests never hit the network and never sleep.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tcgcsv.test.ts
import { describe, it, expect, vi } from "vitest";
import { createTcgcsvClient } from "@/ingest/tcgcsv";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("tcgcsv client", () => {
  it("fetches groups for a category and unwraps results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ results: [{ groupId: 604, name: "Scarlet & Violet", publishedOn: "2023-03-31T00:00:00" }] })
    );
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0 });
    const groups = await c.fetchGroups(3);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://tcgcsv.com/tcgplayer/3/groups",
      expect.objectContaining({ headers: expect.objectContaining({ "User-Agent": expect.stringContaining("hitstreak") }) })
    );
    expect(groups).toEqual([{ groupId: 604, name: "Scarlet & Violet", publishedOn: "2023-03-31T00:00:00" }]);
  });

  it("fetches products and prices for a group", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ productId: 1, name: "Pikachu" }] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ productId: 1, subTypeName: "Holofoil", marketPrice: 2.5 }] }));
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0 });
    expect(await c.fetchProducts(3, 604)).toEqual([{ productId: 1, name: "Pikachu" }]);
    expect(await c.fetchPrices(3, 604)).toEqual([{ productId: 1, subTypeName: "Holofoil", marketPrice: 2.5 }]);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://tcgcsv.com/tcgplayer/3/604/products", expect.anything());
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://tcgcsv.com/tcgplayer/3/604/prices", expect.anything());
  });

  it("retries once on a 5xx then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse({ results: [] }));
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0 });
    expect(await c.fetchGroups(68)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws after retries are exhausted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "down" }, 500));
    const c = createTcgcsvClient({ fetchImpl, delayMs: 0, maxRetries: 2 });
    await expect(c.fetchGroups(89)).rejects.toThrow(/500/);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/tcgcsv.test.ts`
Expected: FAIL — cannot resolve `@/ingest/tcgcsv`.

- [ ] **Step 3: Write the implementation**

```ts
// ingest/tcgcsv.ts
// Polite HTTP client for tcgcsv.com (identified UA, inter-request delay, retry).
// All shapes mirror TCGplayer's API as mirrored by tcgcsv: { results: [...] }.

export interface TcgcsvGroup {
  groupId: number;
  name: string;
  abbreviation?: string;
  publishedOn?: string;
}

export interface TcgcsvExtendedData {
  name: string;
  displayName?: string;
  value: string;
}

export interface TcgcsvProduct {
  productId: number;
  name: string;
  imageUrl?: string;
  extendedData?: TcgcsvExtendedData[];
}

export interface TcgcsvPrice {
  productId: number;
  subTypeName: string;
  marketPrice?: number | null;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
}

export interface TcgcsvClientOptions {
  fetchImpl?: typeof fetch;
  delayMs?: number;    // polite delay before each request (tcgcsv guidance ~250ms)
  maxRetries?: number; // retries on non-2xx / network error
  baseUrl?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createTcgcsvClient(opts: TcgcsvClientOptions = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const delayMs = opts.delayMs ?? 250;
  const maxRetries = opts.maxRetries ?? 2;
  const baseUrl = opts.baseUrl ?? "https://tcgcsv.com";

  async function getResults<T>(path: string): Promise<T[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (delayMs > 0) await sleep(delayMs);
      try {
        const res = await fetchImpl(`${baseUrl}${path}`, {
          headers: { "User-Agent": "hitstreak-ingest/1.0 (github.com/renzoralphpua/hitstreak)" },
        });
        if (!res.ok) {
          lastError = new Error(`tcgcsv GET ${path} -> ${res.status}`);
          continue;
        }
        const body = (await res.json()) as { results?: T[] };
        return body.results ?? [];
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    fetchGroups: (categoryId: number) => getResults<TcgcsvGroup>(`/tcgplayer/${categoryId}/groups`),
    fetchProducts: (categoryId: number, groupId: number) =>
      getResults<TcgcsvProduct>(`/tcgplayer/${categoryId}/${groupId}/products`),
    fetchPrices: (categoryId: number, groupId: number) =>
      getResults<TcgcsvPrice>(`/tcgplayer/${categoryId}/${groupId}/prices`),
  };
}

export type TcgcsvClient = ReturnType<typeof createTcgcsvClient>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/tcgcsv.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add ingest/tcgcsv.ts tests/tcgcsv.test.ts
git commit -m "feat: polite tcgcsv HTTP client with retry and injectable fetch"
```

- [ ] **Step 6: Hardening (from Task 3's code review — required before Task 7 uses the client)**

Because the orchestrator calls this client sequentially for ~800 requests inside one 60-minute job, three things matter that the first cut missed:
1. **Per-request timeout** — add `timeoutMs?: number` (default `30_000`) to `TcgcsvClientOptions` and pass `signal: AbortSignal.timeout(timeoutMs)` to fetch; a hung connection otherwise stalls the whole run past the per-game try/catch.
2. **Drain non-OK bodies** — `await res.text().catch(() => {})` before retrying/throwing, so undici releases the connection.
3. **Retry policy** — retry only `429`, `>= 500`, and thrown errors (network/timeout); any other non-OK status (404, 403…) throws immediately after one request. Retries back off: wait `delayMs` before attempt 0, `delayMs * 2 ** N` before attempt N ≥ 1 (so `delayMs: 0` never sleeps in tests).

Add four tests: thrown network error then success (2 calls); 404 throws `/404/` after exactly 1 call even with `maxRetries: 3`; a 200 body without `results` → `[]`; the fetch init carries an `AbortSignal` when `timeoutMs` is set. Full suite + typecheck green, then:

```bash
git add ingest/tcgcsv.ts tests/tcgcsv.test.ts
git commit -m "fix: tcgcsv client times out requests, drains bodies, retries only 429/5xx with backoff"
```

---

### Task 4: Catalog upsert

**Files:**
- Create: `ingest/catalog.ts`
- Test: `tests/catalog.test.ts`

Upserts are keyed on TCGplayer IDs so re-running a day is idempotent. `extendedData` becomes the `attrs` JSON object; `Number` and `Rarity` are lifted into columns.

- [ ] **Step 1: Write the failing test**

```ts
// tests/catalog.test.ts
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("catalog");

import { db, closeDb } from "@/lib/db";
import { ensureGame, upsertSets, upsertProducts } from "@/ingest/catalog";

beforeAll(async () => {
  await ensureGame({ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" });
});

afterAll(() => {
  closeDb();
  tmp.clean();
});

const GROUPS = [{ groupId: 604, name: "Scarlet & Violet", abbreviation: "SVI", publishedOn: "2023-03-31T00:00:00" }];

const PRODUCTS = [
  {
    productId: 450101,
    name: "Pikachu",
    imageUrl: "https://img.example/450101.jpg",
    extendedData: [
      { name: "Number", value: "025/198" },
      { name: "Rarity", value: "Common" },
      { name: "HP", value: "60" },
    ],
  },
  { productId: 450999, name: "SV Booster Box", extendedData: [] }, // sealed: no number/rarity
];

describe("catalog upsert", () => {
  it("upserts sets and cards and is idempotent", async () => {
    await upsertSets(3, GROUPS);
    await upsertProducts(3, 604, PRODUCTS);
    // run again — no dupes
    await upsertSets(3, GROUPS);
    await upsertProducts(3, 604, PRODUCTS);

    const c = await db();
    expect((await c.execute("SELECT COUNT(*) AS n FROM sets")).rows[0].n).toBe(1);
    expect((await c.execute("SELECT COUNT(*) AS n FROM cards")).rows[0].n).toBe(2);

    const pika = (await c.execute({
      sql: "SELECT number, rarity, attrs FROM cards WHERE tcgplayer_product_id = ?",
      args: [450101],
    })).rows[0];
    expect(pika.number).toBe("025/198");
    expect(pika.rarity).toBe("Common");
    expect(JSON.parse(String(pika.attrs))).toEqual({ Number: "025/198", Rarity: "Common", HP: "60" });
  });

  it("updates changed fields on re-upsert", async () => {
    await upsertProducts(3, 604, [{ ...PRODUCTS[0], name: "Pikachu (Revised)" }]);
    const c = await db();
    const row = (await c.execute({
      sql: "SELECT name FROM cards WHERE tcgplayer_product_id = ?",
      args: [450101],
    })).rows[0];
    expect(row.name).toBe("Pikachu (Revised)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/catalog.test.ts`
Expected: FAIL — cannot resolve `@/ingest/catalog`.

- [ ] **Step 3: Write the implementation**

```ts
// ingest/catalog.ts
// Idempotent catalog upserts keyed on TCGplayer natural IDs.
import { db } from "@/lib/db";
import type { TcgcsvGroup, TcgcsvProduct } from "./tcgcsv";

export interface GameSeed {
  tcgplayerCategoryId: number;
  name: string;
  slug: string;
}

export const GAMES: GameSeed[] = [
  { tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" },
  { tcgplayerCategoryId: 68, name: "One Piece Card Game", slug: "one-piece" },
  { tcgplayerCategoryId: 89, name: "Riftbound", slug: "riftbound" },
];

export async function ensureGame(g: GameSeed): Promise<void> {
  const c = await db();
  await c.execute({
    sql: `INSERT INTO games (tcgplayer_category_id, name, slug) VALUES (?, ?, ?)
          ON CONFLICT(tcgplayer_category_id) DO UPDATE SET name = excluded.name`,
    args: [g.tcgplayerCategoryId, g.name, g.slug],
  });
}

export async function upsertSets(categoryId: number, groups: TcgcsvGroup[]): Promise<void> {
  if (groups.length === 0) return;
  const c = await db();
  const gameRow = (await c.execute({
    sql: "SELECT id FROM games WHERE tcgplayer_category_id = ?",
    args: [categoryId],
  })).rows[0];
  if (!gameRow) throw new Error(`game for category ${categoryId} not seeded`);

  await c.batch(
    groups.map((g) => ({
      sql: `INSERT INTO sets (game_id, tcgplayer_group_id, name, code, release_date)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(tcgplayer_group_id) DO UPDATE SET
              name = excluded.name, code = excluded.code, release_date = excluded.release_date`,
      args: [Number(gameRow.id), g.groupId, g.name, g.abbreviation ?? null, g.publishedOn ?? null],
    })),
    "write"
  );
}

export async function upsertProducts(
  _categoryId: number,
  groupId: number,
  products: TcgcsvProduct[]
): Promise<void> {
  if (products.length === 0) return;
  const c = await db();
  const setRow = (await c.execute({
    sql: "SELECT id FROM sets WHERE tcgplayer_group_id = ?",
    args: [groupId],
  })).rows[0];
  if (!setRow) throw new Error(`set for group ${groupId} not upserted yet`);

  const CHUNK = 200;
  for (let i = 0; i < products.length; i += CHUNK) {
    await c.batch(
      products.slice(i, i + CHUNK).map((p) => {
        const attrs: Record<string, string> = {};
        for (const e of p.extendedData ?? []) attrs[e.name] = e.value;
        return {
          sql: `INSERT INTO cards (set_id, tcgplayer_product_id, name, number, rarity, image_url, attrs)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tcgplayer_product_id) DO UPDATE SET
                  name = excluded.name, number = excluded.number, rarity = excluded.rarity,
                  image_url = excluded.image_url, attrs = excluded.attrs`,
          args: [
            Number(setRow.id),
            p.productId,
            p.name,
            attrs["Number"] ?? null,
            attrs["Rarity"] ?? null,
            p.imageUrl ?? null,
            JSON.stringify(attrs),
          ],
        };
      }),
      "write"
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/catalog.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add ingest/catalog.ts tests/catalog.test.ts
git commit -m "feat: idempotent catalog upserts (games, sets, cards)"
```

---

### Task 5: Write-on-change price ingestion

**Files:**
- Create: `ingest/prices.ts`
- Test: `tests/prices.test.ts`

Core invariant: `price_snapshots` gains a row for a printing on date D **only** when (market, low, mid, high) differ from the most recent snapshot **dated before D**. This makes ingestion order-independent — the daily job and the historical backfill can interleave in any order and history stays correct. `latest_prices` is updated only when D is >= its current date, so replaying old days never clobbers today's price. Printings are created on demand from `(productId, subTypeName)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/prices.test.ts
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("prices");

import { db, closeDb } from "@/lib/db";
import { ensureGame, upsertSets, upsertProducts } from "@/ingest/catalog";
import { ingestPrices } from "@/ingest/prices";

beforeAll(async () => {
  await ensureGame({ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" });
  await upsertSets(3, [{ groupId: 604, name: "Scarlet & Violet" }]);
  await upsertProducts(3, 604, [{ productId: 450101, name: "Pikachu" }]);
});

afterAll(() => {
  closeDb();
  tmp.clean();
});

const P1 = { productId: 450101, subTypeName: "Holofoil", marketPrice: 2.5, lowPrice: 1.0, midPrice: 2.0, highPrice: 9.9 };

async function counts() {
  const c = await db();
  return {
    snapshots: Number((await c.execute("SELECT COUNT(*) AS n FROM price_snapshots")).rows[0].n),
    printings: Number((await c.execute("SELECT COUNT(*) AS n FROM printings")).rows[0].n),
  };
}

describe("ingestPrices (write-on-change)", () => {
  it("creates the printing and writes the first snapshot", async () => {
    const res = await ingestPrices(604, [P1], "2026-09-01");
    expect(res).toMatchObject({ written: 1, unchanged: 0, skippedNoCard: 0 });
    expect(await counts()).toEqual({ snapshots: 1, printings: 1 });
  });

  it("skips when the price is unchanged on a later day", async () => {
    const res = await ingestPrices(604, [P1], "2026-09-02");
    expect(res).toMatchObject({ written: 0, unchanged: 1 });
    expect((await counts()).snapshots).toBe(1);
    // but latest_prices moves to the new date
    const c = await db();
    expect((await c.execute("SELECT date FROM latest_prices")).rows[0].date).toBe("2026-09-02");
  });

  it("writes a snapshot when the price changes", async () => {
    const res = await ingestPrices(604, [{ ...P1, marketPrice: 3.0 }], "2026-09-03");
    expect(res).toMatchObject({ written: 1, unchanged: 0 });
    expect((await counts()).snapshots).toBe(2);
  });

  it("is idempotent for the same date (re-run upserts the same row, no dupes)", async () => {
    // Re-running D diffs against the snapshot BEFORE D (2.5), so 3.0 still counts as a write,
    // but ON CONFLICT keeps exactly one row for (printing, D). Idempotency = row count.
    const res = await ingestPrices(604, [{ ...P1, marketPrice: 3.0 }], "2026-09-03");
    expect(res).toMatchObject({ written: 1, unchanged: 0 });
    expect((await counts()).snapshots).toBe(2);
  });

  it("counts prices for unknown products as skipped", async () => {
    const res = await ingestPrices(604, [{ productId: 999999, subTypeName: "Normal", marketPrice: 1 }], "2026-09-03");
    expect(res).toMatchObject({ written: 0, skippedNoCard: 1 });
  });

  it("treats a second subtype as a distinct printing", async () => {
    await ingestPrices(604, [{ ...P1, subTypeName: "Reverse Holofoil", marketPrice: 0.5 }], "2026-09-03");
    expect((await counts()).printings).toBe(2);
  });

  it("replaying an OLDER date diffs against the snapshot before it and leaves latest untouched", async () => {
    // history so far for Holofoil: 2026-09-01 @2.5, 2026-09-03 @3.0; latest = 2026-09-03 @3.0
    const c = await db();
    const before = (await c.execute("SELECT date, market FROM latest_prices WHERE printing_id = 1")).rows[0];
    expect(before).toMatchObject({ date: "2026-09-03", market: 3.0 });

    // 2026-08-20 has no earlier snapshot -> written
    const r1 = await ingestPrices(604, [{ ...P1, marketPrice: 2.5 }], "2026-08-20");
    expect(r1).toMatchObject({ written: 1 });
    // 2026-08-25 equals the 2026-08-20 snapshot (2.5) -> unchanged, even though latest is 3.0
    const r2 = await ingestPrices(604, [{ ...P1, marketPrice: 2.5 }], "2026-08-25");
    expect(r2).toMatchObject({ written: 0, unchanged: 1 });

    const after = (await c.execute("SELECT date, market FROM latest_prices WHERE printing_id = 1")).rows[0];
    expect(after).toMatchObject({ date: "2026-09-03", market: 3.0 }); // untouched by older replays
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/prices.test.ts`
Expected: FAIL — cannot resolve `@/ingest/prices`.

- [ ] **Step 3: Write the implementation**

```ts
// ingest/prices.ts
// Write-on-change price ingestion, order-independent: for date D a snapshot is
// written only when the tuple differs from the most recent snapshot dated
// BEFORE D. latest_prices is only advanced when D >= its current date, so the
// daily job and the historical backfill can run in any order.
import { db } from "@/lib/db";
import type { TcgcsvPrice } from "./tcgcsv";

export interface IngestPriceResult {
  written: number;
  unchanged: number;
  skippedNoCard: number;
}

type Tuple = { market: number | null; low: number | null; mid: number | null; high: number | null };

const norm = (v: number | null | undefined): number | null => (v == null ? null : v);
const sameTuple = (a: Tuple, b: Tuple) =>
  a.market === b.market && a.low === b.low && a.mid === b.mid && a.high === b.high;
const tupleOf = (r: Record<string, unknown>): Tuple => ({
  market: r.market as number | null,
  low: r.low as number | null,
  mid: r.mid as number | null,
  high: r.high as number | null,
});

const CHUNK = 200;

export async function ingestPrices(
  groupId: number,
  prices: TcgcsvPrice[],
  date: string // YYYY-MM-DD (UTC)
): Promise<IngestPriceResult> {
  const c = await db();
  const result: IngestPriceResult = { written: 0, unchanged: 0, skippedNoCard: 0 };
  if (prices.length === 0) return result;

  // 1. productId -> card id for this group.
  const cardRows = (await c.execute({
    sql: `SELECT cards.id AS id, cards.tcgplayer_product_id AS pid
          FROM cards JOIN sets ON sets.id = cards.set_id
          WHERE sets.tcgplayer_group_id = ?`,
    args: [groupId],
  })).rows;
  const cardByProduct = new Map<number, number>();
  for (const r of cardRows) cardByProduct.set(Number(r.pid), Number(r.id));

  const wanted = prices.filter((p) => cardByProduct.has(p.productId));
  result.skippedNoCard = prices.length - wanted.length;
  if (wanted.length === 0) return result;

  // 2. Ensure printings exist for every (card, subtype) we have a price for.
  for (let i = 0; i < wanted.length; i += CHUNK) {
    await c.batch(
      wanted.slice(i, i + CHUNK).map((p) => ({
        sql: "INSERT INTO printings (card_id, subtype) VALUES (?, ?) ON CONFLICT(card_id, subtype) DO NOTHING",
        args: [cardByProduct.get(p.productId)!, p.subTypeName],
      })),
      "write"
    );
  }

  // 3. printing ids for this group, keyed by "productId|subtype".
  const printingRows = (await c.execute({
    sql: `SELECT printings.id AS id, cards.tcgplayer_product_id AS pid, printings.subtype AS subtype
          FROM printings
          JOIN cards ON cards.id = printings.card_id
          JOIN sets ON sets.id = cards.set_id
          WHERE sets.tcgplayer_group_id = ?`,
    args: [groupId],
  })).rows;
  const printingId = new Map<string, number>();
  for (const r of printingRows) printingId.set(`${r.pid}|${r.subtype}`, Number(r.id));

  // 4. For each printing in this group: the most recent snapshot strictly BEFORE `date`.
  const prevRows = (await c.execute({
    sql: `SELECT ps.printing_id AS printing_id, ps.market, ps.low, ps.mid, ps.high
          FROM price_snapshots ps
          JOIN (
            SELECT s.printing_id, MAX(s.date) AS d
            FROM price_snapshots s
            JOIN printings p ON p.id = s.printing_id
            JOIN cards ca ON ca.id = p.card_id
            JOIN sets se ON se.id = ca.set_id
            WHERE se.tcgplayer_group_id = ? AND s.date < ?
            GROUP BY s.printing_id
          ) m ON m.printing_id = ps.printing_id AND m.d = ps.date`,
    args: [groupId, date],
  })).rows;
  const prevByPrinting = new Map<number, Tuple>();
  for (const r of prevRows) prevByPrinting.set(Number(r.printing_id), tupleOf(r));

  // 5. Current latest date per printing (to decide whether `date` advances it).
  const latestRows = (await c.execute({
    sql: `SELECT lp.printing_id AS printing_id, lp.date AS date
          FROM latest_prices lp
          JOIN printings p ON p.id = lp.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          WHERE se.tcgplayer_group_id = ?`,
    args: [groupId],
  })).rows;
  const latestDate = new Map<number, string>();
  for (const r of latestRows) latestDate.set(Number(r.printing_id), String(r.date));

  // 6. Diff and build statements.
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  for (const p of wanted) {
    const id = printingId.get(`${p.productId}|${p.subTypeName}`);
    if (id === undefined) continue; // defensive; step 2 guarantees existence
    const next: Tuple = { market: norm(p.marketPrice), low: norm(p.lowPrice), mid: norm(p.midPrice), high: norm(p.highPrice) };
    const prev = prevByPrinting.get(id);
    const advancesLatest = !latestDate.has(id) || date >= latestDate.get(id)!;

    if (prev && sameTuple(prev, next)) {
      result.unchanged++;
    } else {
      result.written++;
      stmts.push({
        sql: `INSERT INTO price_snapshots (printing_id, date, market, low, mid, high)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(printing_id, date) DO UPDATE SET
                market = excluded.market, low = excluded.low, mid = excluded.mid, high = excluded.high`,
        args: [id, date, next.market, next.low, next.mid, next.high],
      });
    }

    if (advancesLatest) {
      stmts.push({
        sql: `INSERT INTO latest_prices (printing_id, date, market, low, mid, high)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(printing_id) DO UPDATE SET
                date = excluded.date, market = excluded.market, low = excluded.low,
                mid = excluded.mid, high = excluded.high`,
        args: [id, date, next.market, next.low, next.mid, next.high],
      });
    }
  }

  for (let i = 0; i < stmts.length; i += CHUNK) {
    await c.batch(stmts.slice(i, i + CHUNK), "write");
  }
  return result;
}
```

Why the ISO `date >= latestDate` string comparison is safe: dates are always `YYYY-MM-DD`, which sorts lexicographically in chronological order.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/prices.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add ingest/prices.ts tests/prices.test.ts
git commit -m "feat: write-on-change price ingestion with on-demand printings"
```

- [ ] **Step 6: Rework after code review (required — the first cut had a correctness bug)**

The review found that a same-date re-run with corrected data did nothing when the corrected value equalled the previous day's snapshot (the `unchanged` branch emitted no statement), leaving a wrong row permanently in `price_snapshots` and `latest_prices` disagreeing with it. That defeats "re-run to repair." The reworked module — the version that exists in the repo — has this contract:

- **Semantics (module header):** `price_snapshots` = one row per printing per day the tuple CHANGED vs. the most recent snapshot strictly before that day (readers carry forward); `latest_prices.date` = LAST SEEN (upserted on every appearance), `MAX(price_snapshots.date)` = LAST CHANGED; tuples may be all-null (unpriceable, never zero); invariant `latest_prices` tuple == most recent snapshot tuple; re-runs are idempotent AND canonicalizing.
- **API:** `ingestPrices(groupId, prices, date, index?: GroupIndex)`, `resolveGroupIndex(groupId): Promise<GroupIndex>` (`cardByProduct`, `printingId` maps — the backfill hoists this per group and passes it; the function mutates the passed index when it creates printings). `IngestPriceResult` gains `skippedWrongGroup` (productId exists in the catalog under a different group = catalog drift; the orchestrator should log it).
- **Validation:** `date` must be `YYYY-MM-DD` (throws otherwise — every comparison is lexicographic); prices normalized via `norm(unknown)` (strings → numbers, non-finite → null); input deduped by `productId|subtype` (last wins).
- **Performance:** printings inserted only when missing from the index (not insert-on-conflict per row); the previous tuple comes from `latest_prices` when `latest.date < date` (by the invariant), and the `MAX(date)` history scan runs only for out-of-order printings, restricted by `printing_id IN (...)`.
- **Correctness:** when the tuple is unchanged and a snapshot already exists AT `date`, it is DELETED (canonicalizing); the `latest_prices` upsert carries `WHERE excluded.date >= latest_prices.date` in SQL (atomic — no read-then-write race between daily and backfill); a printing's statements are kept in the same batch chunk.
- **Tests:** the original seven plus ten more (corrected re-run repairs history; all-null pair; middle insert equal to the later neighbour reconstructs correctly; stale latest ignored; wrong-group vs no-card; dedupe; invalid date throws; string price normalized; index hoisting; >200 printings).

Commit: `fix: canonicalizing write-on-change prices — corrected re-runs repair history; atomic latest guard; validate dates; normalize numbers`

Re-review then found two more holes, fixed in a follow-up commit (`fix: keep latest_prices tuple in sync when replaying recent days; refresh hoisted card index; stricter date + bigint normalization`):
- **Replaying a recent day** (one already followed by later runs) rewrote/deleted the newest snapshot while the SQL guard kept `latest_prices`' old tuple → invariant broken → a fabricated change the next day. Fix: on the out-of-order branch, when `date >= MAX(snapshot date)` for the printing, also `UPDATE latest_prices SET <tuple>` (date untouched) with the post-write newest tuple (`next` if written, else `prev`).
- **Hoisted `GroupIndex` never refreshed `cardByProduct`**, so a card added to the same group after hoisting was skipped and misreported as drift. Fix: reload `cardByProduct` into the index before classifying skips.
- Minors: canonicalization is per-replayed-day (the following day's row may become redundant — harmless for carry-forward; movers queries must tolerate 0-delta rows); date validation also round-trips through `Date` (rejects `2026-13-45`); `norm` accepts `bigint`, `tupleOf` normalizes DB values.

**Consequences for later tasks:** Task 7 derives `date` with `toISOString().slice(0, 10)` (never a locale date), logs `skippedWrongGroup`, and treats a group returning zero prices as suspicious (warn). Task 9 calls `resolveGroupIndex` once per group and caches it across days, and must NOT record a day as complete if `ingestPrices` throws (earlier chunks may have committed; the re-run repairs).

---

### Task 6: R2 raw archiver

**Files:**
- Create: `ingest/r2.ts`
- Test: `tests/r2.test.ts`

R2 is S3-compatible. The archiver takes an injected S3 client so tests assert commands without network. Runtime env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/r2.test.ts
import { describe, it, expect, vi } from "vitest";
import { createRawArchiver } from "@/ingest/r2";

describe("raw archiver", () => {
  it("puts JSON under raw/tcgplayer/<date>/<category>/<name>.json", async () => {
    const send = vi.fn().mockResolvedValue({});
    const archiver = createRawArchiver({ s3: { send } as never, bucket: "hitstreak-raw" });
    await archiver.putRaw("2026-09-05", 3, "604-prices", { results: [] });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd.input.Bucket).toBe("hitstreak-raw");
    expect(cmd.input.Key).toBe("raw/tcgplayer/2026-09-05/3/604-prices.json");
    expect(cmd.input.ContentType).toBe("application/json");
    expect(JSON.parse(cmd.input.Body as string)).toEqual({ results: [] });
  });

  it("is a no-op when disabled (no bucket configured)", async () => {
    const archiver = createRawArchiver({ s3: null, bucket: undefined });
    await expect(archiver.putRaw("2026-09-05", 3, "groups", {})).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/r2.test.ts`
Expected: FAIL — cannot resolve `@/ingest/r2`.

- [ ] **Step 3: Write the implementation**

```ts
// ingest/r2.ts
// Raw-response archiver to Cloudflare R2 (S3-compatible). Disabled gracefully
// when R2 env is absent (local dev), so ingestion still works without it.
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export interface RawArchiverOptions {
  s3: S3Client | null;
  bucket: string | undefined;
}

export function createRawArchiver(opts: RawArchiverOptions) {
  return {
    enabled: Boolean(opts.s3 && opts.bucket),
    async putRaw(date: string, categoryId: number, name: string, body: unknown): Promise<void> {
      if (!opts.s3 || !opts.bucket) return;
      await opts.s3.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: `raw/tcgplayer/${date}/${categoryId}/${name}.json`,
          Body: JSON.stringify(body),
          ContentType: "application/json",
        })
      );
    },
  };
}

export function rawArchiverFromEnv() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return createRawArchiver({ s3: null, bucket: undefined });
  }
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return createRawArchiver({ s3, bucket });
}

export type RawArchiver = ReturnType<typeof createRawArchiver>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/r2.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add ingest/r2.ts tests/r2.test.ts
git commit -m "feat: R2 raw-response archiver, disabled gracefully without env"
```

---

### Task 7: Daily orchestrator

**Files:**
- Create: `ingest/daily.ts`
- Test: `tests/daily.test.ts`

Per-game isolation (one game failing must not block the others), archive-before-process, exit code 1 if any game failed.

- [ ] **Step 1: Write the failing test**

```ts
// tests/daily.test.ts
import { describe, it, expect, afterAll, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("daily");

import { db, closeDb } from "@/lib/db";
import { runDailyIngest } from "@/ingest/daily";
import { createRawArchiver } from "@/ingest/r2";
import type { TcgcsvClient } from "@/ingest/tcgcsv";

afterAll(() => {
  closeDb();
  tmp.clean();
});

function stubClient(overrides: Partial<TcgcsvClient> = {}): TcgcsvClient {
  return {
    fetchGroups: vi.fn().mockResolvedValue([{ groupId: 604, name: "Test Set" }]),
    fetchProducts: vi.fn().mockResolvedValue([{ productId: 1, name: "Card A" }]),
    fetchPrices: vi.fn().mockResolvedValue([{ productId: 1, subTypeName: "Normal", marketPrice: 1.5 }]),
    ...overrides,
  } as TcgcsvClient;
}

describe("runDailyIngest", () => {
  it("ingests all games and reports per-game summaries", async () => {
    const summary = await runDailyIngest({
      client: stubClient(),
      archiver: createRawArchiver({ s3: null, bucket: undefined }),
      date: "2026-09-05",
      games: [
        { tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" },
        { tcgplayerCategoryId: 68, name: "One Piece Card Game", slug: "one-piece" },
      ],
    });
    expect(summary.failures).toEqual([]);
    expect(summary.perGame).toHaveLength(2);
    expect(summary.perGame[0]).toMatchObject({ slug: "pokemon", written: 1 });

    const c = await db();
    expect(Number((await c.execute("SELECT COUNT(*) AS n FROM games")).rows[0].n)).toBe(2);
  });

  it("isolates a failing game and reports it", async () => {
    const failing = stubClient({
      fetchGroups: vi.fn().mockRejectedValue(new Error("tcgcsv down")),
    });
    const summary = await runDailyIngest({
      client: failing,
      archiver: createRawArchiver({ s3: null, bucket: undefined }),
      date: "2026-09-06",
      games: [
        { tcgplayerCategoryId: 89, name: "Riftbound", slug: "riftbound" },
        { tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" },
      ],
    });
    expect(summary.failures).toHaveLength(2); // stub fails for both here
    expect(summary.failures[0]).toMatchObject({ slug: "riftbound" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/daily.test.ts`
Expected: FAIL — cannot resolve `@/ingest/daily`.

- [ ] **Step 3: Write the implementation**

```ts
// ingest/daily.ts
// Daily ingest orchestrator. Archive raw responses first, then upsert catalog,
// then write-on-change prices. Games are isolated: one failure doesn't stop the rest.
import { createTcgcsvClient, type TcgcsvClient } from "./tcgcsv";
import { ensureGame, upsertSets, upsertProducts, GAMES, type GameSeed } from "./catalog";
import { ingestPrices } from "./prices";
import { rawArchiverFromEnv, type RawArchiver } from "./r2";
import { closeDb } from "@/lib/db";

export interface DailyIngestOptions {
  client: TcgcsvClient;
  archiver: RawArchiver;
  date: string; // YYYY-MM-DD UTC
  games: GameSeed[];
}

export interface GameSummary {
  slug: string;
  sets: number;
  cards: number;
  written: number;
  unchanged: number;
  skippedNoCard: number;
  skippedWrongGroup: number;
}

export interface DailySummary {
  perGame: GameSummary[];
  failures: { slug: string; error: string }[];
}

export async function runDailyIngest(opts: DailyIngestOptions): Promise<DailySummary> {
  const summary: DailySummary = { perGame: [], failures: [] };

  for (const game of opts.games) {
    try {
      await ensureGame(game);
      const cat = game.tcgplayerCategoryId;

      const groups = await opts.client.fetchGroups(cat);
      await opts.archiver.putRaw(opts.date, cat, "groups", { results: groups });
      await upsertSets(cat, groups);

      const g: GameSummary = {
        slug: game.slug, sets: groups.length, cards: 0, written: 0, unchanged: 0, skippedNoCard: 0, skippedWrongGroup: 0,
      };

      for (const group of groups) {
        const products = await opts.client.fetchProducts(cat, group.groupId);
        await opts.archiver.putRaw(opts.date, cat, `${group.groupId}-products`, { results: products });
        await upsertProducts(cat, group.groupId, products);
        g.cards += products.length;

        const prices = await opts.client.fetchPrices(cat, group.groupId);
        await opts.archiver.putRaw(opts.date, cat, `${group.groupId}-prices`, { results: prices });
        if (prices.length === 0 && products.length > 0) {
          console.warn(`[${game.slug}] group ${group.groupId} returned 0 prices for ${products.length} products — suspicious`);
        }
        const r = await ingestPrices(group.groupId, prices, opts.date);
        g.written += r.written;
        g.unchanged += r.unchanged;
        g.skippedNoCard += r.skippedNoCard;
        g.skippedWrongGroup += r.skippedWrongGroup;
      }

      summary.perGame.push(g);
      console.log(`[${game.slug}] sets=${g.sets} cards=${g.cards} priceWrites=${g.written} unchanged=${g.unchanged} skippedNoCard=${g.skippedNoCard} skippedWrongGroup=${g.skippedWrongGroup}`);
      if (g.skippedWrongGroup > 0) console.warn(`[${game.slug}] ${g.skippedWrongGroup} prices belong to products catalogued under another group (catalog drift)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.failures.push({ slug: game.slug, error: msg });
      console.error(`[${game.slug}] FAILED: ${msg}`);
    }
  }

  return summary;
}

// CLI entry: npx tsx ingest/daily.ts
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("ingest/daily.ts");
if (isMain) {
  const date = new Date().toISOString().slice(0, 10);
  runDailyIngest({
    client: createTcgcsvClient({}),
    archiver: rawArchiverFromEnv(),
    date,
    games: GAMES,
  })
    .then((s) => {
      closeDb();
      if (s.failures.length > 0) process.exit(1);
    })
    .catch((e) => {
      console.error(e);
      closeDb();
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/daily.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Run the FULL suite (regression gate)**

Run: `npm test`
Expected: all tests pass across all files.

- [ ] **Step 6: Commit**

```bash
git add ingest/daily.ts tests/daily.test.ts
git commit -m "feat: daily ingest orchestrator with per-game isolation and CLI entry"
```

---

### Task 8: GitHub Actions daily workflow + env docs

**Files:**
- Create: `.github/workflows/daily-ingest.yml`
- Create: `.env.example`

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/daily-ingest.yml
name: Daily price ingest

on:
  schedule:
    - cron: "0 21 * * *" # ~1h after tcgcsv's 20:00 UTC refresh
  workflow_dispatch: {}

concurrency:
  group: ingest
  cancel-in-progress: false

jobs:
  ingest:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx tsx ingest/daily.ts
        env:
          TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
```

- [ ] **Step 2: Write .env.example**

```bash
# .env.example — copy to .env.local for local runs. Never commit real values.

# Turso (libSQL). Local dev/test can use file:hitstreak.local.db
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

# Cloudflare R2 (raw ingest archive). Optional locally — archiver disables itself without these.
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=hitstreak-raw
```

- [ ] **Step 3: Verify workflow syntax locally**

Run a real end-to-end ingest against a local file DB (PowerShell):

```powershell
$env:TURSO_DATABASE_URL = 'file:hitstreak.local.db'; npx tsx ingest/daily.ts
```

Expected: per-game log lines (`[riftbound] sets=… cards=… priceWrites=…` etc.), Riftbound finishing in seconds, Pokémon taking several minutes, exit code 0. Then verify row counts with a small script — create `scripts/db-counts.ts`:

```ts
// scripts/db-counts.ts — quick sanity check of table sizes. Usage: npx tsx scripts/db-counts.ts
import { db, closeDb } from "../lib/db";

const c = await db();
for (const t of ["games", "sets", "cards", "printings", "price_snapshots", "latest_prices"]) {
  const r = await c.execute(`SELECT COUNT(*) AS n FROM ${t}`);
  console.log(t.padEnd(16), r.rows[0].n);
}
closeDb();
```

```powershell
$env:TURSO_DATABASE_URL = 'file:hitstreak.local.db'; npx tsx scripts/db-counts.ts
```

Expected: `games 3`, non-zero counts for every other table, Pokémon dominating `cards`. Commit `scripts/db-counts.ts` along with the workflow in the next step. Delete `hitstreak.local.db*` afterwards (gitignored anyway).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/daily-ingest.yml .env.example scripts/db-counts.ts
git commit -m "ci: scheduled daily ingest workflow, env template, db-counts script"
```

- [ ] **Step 5: MANUAL GATE — user provisions services** (cannot be done by the engineer)

Ask the user to:
1. Create the Turso DB: `turso db create hitstreak`, then `turso db show hitstreak --url` and `turso db tokens create hitstreak`
2. Create the R2 bucket `hitstreak-raw` + an R2 API token (S3 credentials)
3. Add all six values as GitHub repo secrets (Settings → Secrets and variables → Actions)
4. Trigger the workflow once via Actions → "Daily price ingest" → Run workflow, and confirm it goes green

---

### Task 9: Historical backfill

**Files:**
- Create: `ingest/backfill.ts`
- Create: `.github/workflows/backfill.yml`
- Test: `tests/backfill.test.ts`

Replays tcgcsv's daily price archives (`https://tcgcsv.com/archive/tcgplayer/prices-YYYY-MM-DD.ppmd.7z`, available from 2024-02-08) through the same `ingestPrices` write-on-change path. Catalog must already be populated (Task 8's first live run). Extraction uses the `7z` binary (p7zip, preinstalled on ubuntu-latest). The archive extracts to date-based folders containing per-category/per-group price JSON files; the walker is path-shape-agnostic: it scans for files whose parsed JSON has `results` with `productId`/`subTypeName`, taking the group id from the parent directory name.

**Ordering:** because `ingestPrices` (Task 5, as reworked in its Step 6) diffs each date against the most recent snapshot *before* it, only advances `latest_prices` for newer dates (guarded in SQL), and canonicalizes on re-run, the backfill is correct regardless of whether daily runs have already happened, and can be re-run safely. Do not mark a day complete when `ingestPrices` throws — re-run it. Replay oldest-first anyway: it's the cheapest order (each day's diff finds its predecessor immediately) and produces the fewest redundant rows. Prices for products no longer in the current catalog are counted as `skippedNoCard` — those cards' history is lost, which is acceptable (they no longer exist on TCGplayer to be collected).

- [ ] **Step 1: Write the failing test (replay core, no network/7z)**

```ts
// tests/backfill.test.ts
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("backfill");

import { db, closeDb } from "@/lib/db";
import { ensureGame, upsertSets, upsertProducts } from "@/ingest/catalog";
import { replayDay, collectGroupPrices } from "@/ingest/backfill";

beforeAll(async () => {
  await ensureGame({ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" });
  await upsertSets(3, [{ groupId: 604, name: "Scarlet & Violet" }]);
  await upsertProducts(3, 604, [{ productId: 450101, name: "Pikachu" }]);
});

afterAll(() => {
  closeDb();
  tmp.clean();
});

describe("replayDay", () => {
  it("replays a day's group price files through write-on-change", async () => {
    const r1 = await replayDay("2024-02-08", [
      { groupId: 604, prices: [{ productId: 450101, subTypeName: "Holofoil", marketPrice: 1.0 }] },
    ]);
    expect(r1.written).toBe(1);

    // unchanged next day -> no new snapshot
    const r2 = await replayDay("2024-02-09", [
      { groupId: 604, prices: [{ productId: 450101, subTypeName: "Holofoil", marketPrice: 1.0 }] },
    ]);
    expect(r2.written).toBe(0);

    // changed -> snapshot
    const r3 = await replayDay("2024-02-10", [
      { groupId: 604, prices: [{ productId: 450101, subTypeName: "Holofoil", marketPrice: 2.0 }] },
    ]);
    expect(r3.written).toBe(1);

    const c = await db();
    expect(Number((await c.execute("SELECT COUNT(*) AS n FROM price_snapshots")).rows[0].n)).toBe(2);
  });
});

describe("collectGroupPrices", () => {
  it("finds price files by shape and takes the group id from the parent directory", () => {
    const root = mkdtempSync(join(tmpdir(), "hitstreak-bf-fixture-"));
    mkdirSync(join(root, "2024-02-08", "3", "604"), { recursive: true });
    writeFileSync(
      join(root, "2024-02-08", "3", "604", "prices"),
      JSON.stringify({ results: [{ productId: 450101, subTypeName: "Holofoil", marketPrice: 1.0 }] })
    );
    // a products file must be ignored (no subTypeName), as must non-JSON
    writeFileSync(join(root, "2024-02-08", "3", "604", "products"), JSON.stringify({ results: [{ productId: 450101, name: "Pikachu" }] }));
    writeFileSync(join(root, "README.txt"), "not json");

    const groups = collectGroupPrices(root);
    expect(groups).toEqual([{ groupId: 604, prices: [{ productId: 450101, subTypeName: "Holofoil", marketPrice: 1.0 }] }]);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/backfill.test.ts`
Expected: FAIL — cannot resolve `@/ingest/backfill`.

- [ ] **Step 3: Write the implementation**

```ts
// ingest/backfill.ts
// Replays tcgcsv daily price archives (2024-02-08 onward) through the same
// write-on-change path as the daily ingest. Run ONCE, oldest date first,
// ideally right after the first daily catalog sync.
//
// Usage: npx tsx ingest/backfill.ts 2024-02-08 2026-09-04
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestPrices, resolveGroupIndex, type GroupIndex } from "./prices";
import type { TcgcsvPrice } from "./tcgcsv";
import { closeDb } from "@/lib/db";

export interface GroupPrices {
  groupId: number;
  prices: TcgcsvPrice[];
}

/** Per-group catalog lookups are identical across the ~900 replayed days; cache them.
 *  ingestPrices mutates a passed index when it creates printings, so the cache stays valid. */
export type GroupIndexCache = Map<number, GroupIndex>;

export async function replayDay(
  date: string,
  groups: GroupPrices[],
  cache: GroupIndexCache = new Map()
): Promise<{ written: number; unchanged: number; skippedNoCard: number; skippedWrongGroup: number }> {
  const total = { written: 0, unchanged: 0, skippedNoCard: 0, skippedWrongGroup: 0 };
  for (const g of groups) {
    let index = cache.get(g.groupId);
    if (!index) {
      index = await resolveGroupIndex(g.groupId);
      cache.set(g.groupId, index);
    }
    const r = await ingestPrices(g.groupId, g.prices, date, index);
    total.written += r.written;
    total.unchanged += r.unchanged;
    total.skippedNoCard += r.skippedNoCard;
    total.skippedWrongGroup += r.skippedWrongGroup;
  }
  return total;
}

/** Walk an extracted archive dir; collect price files per group.
 *  Path-shape-agnostic: any JSON file whose parsed body has results[].subTypeName
 *  counts as a group price file; groupId comes from the parent directory name. */
export function collectGroupPrices(root: string): GroupPrices[] {
  const out: GroupPrices[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      let body: { results?: TcgcsvPrice[] };
      try {
        body = JSON.parse(readFileSync(p, "utf8"));
      } catch {
        continue; // not JSON
      }
      const results = body.results;
      if (!Array.isArray(results) || results.length === 0) continue;
      if (typeof results[0]?.subTypeName !== "string") continue; // not a prices file
      // tcgcsv archives lay out .../<categoryId>/<groupId>/prices — the group id is the parent dir.
      const parent = dir.split(/[\\/]/).pop() ?? "";
      const groupId = Number(parent);
      if (!Number.isInteger(groupId)) continue;
      out.push({ groupId, prices: results });
    }
  };
  walk(root);
  return out;
}

function* dateRange(from: string, to: string): Generator<string> {
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

async function downloadAndExtract(date: string): Promise<string | null> {
  const url = `https://tcgcsv.com/archive/tcgplayer/prices-${date}.ppmd.7z`;
  const res = await fetch(url, {
    headers: { "User-Agent": "hitstreak-ingest/1.0 (github.com/renzoralphpua/hitstreak)" },
  });
  if (res.status === 404) return null; // day missing from archive; skip
  if (!res.ok) throw new Error(`archive ${date} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), `hitstreak-bf-${date}-`));
  const archivePath = join(dir, "prices.7z");
  writeFileSync(archivePath, buf);
  execFileSync("7z", ["x", archivePath, `-o${dir}/x`, "-y"], { stdio: "ignore" });
  return join(dir, "x");
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("ingest/backfill.ts");
if (isMain) {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) {
    console.error("usage: tsx ingest/backfill.ts <from YYYY-MM-DD> <to YYYY-MM-DD>");
    process.exit(2);
  }
  (async () => {
    const cache: GroupIndexCache = new Map();
    for (const date of dateRange(from, to)) {
      const extracted = await downloadAndExtract(date);
      if (!extracted) {
        console.log(`[${date}] no archive, skipped`);
        continue;
      }
      try {
        const groups = collectGroupPrices(extracted);
        // A throw here leaves the day PARTIALLY applied (earlier groups committed). It is logged
        // and the loop stops so the operator re-runs from this date; re-runs repair.
        const r = await replayDay(date, groups, cache);
        console.log(`[${date}] groups=${groups.length} written=${r.written} unchanged=${r.unchanged} skippedNoCard=${r.skippedNoCard} skippedWrongGroup=${r.skippedWrongGroup}`);
      } finally {
        rmSync(join(extracted, ".."), { recursive: true, force: true });
      }
    }
    closeDb();
  })().catch((e) => {
    console.error(e);
    closeDb();
    process.exit(1);
  });
}
```

**Engineer note:** on the very first extracted archive, print `readdirSync` of the extraction root and eyeball the real folder structure; if group price files are named differently than assumed (e.g. `prices` with no extension vs `prices.json`, or an extra date-level folder), adjust `collectGroupPrices`'s groupId extraction accordingly and add a fixture test reproducing the real shape. The current implementation takes the parent directory name as the groupId in both cases — verify that matches reality.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/backfill.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Write the backfill workflow (manual trigger, chunked by date range)**

```yaml
# .github/workflows/backfill.yml
name: Historical price backfill

on:
  workflow_dispatch:
    inputs:
      from:
        description: "Start date (YYYY-MM-DD, earliest 2024-02-08)"
        required: true
        default: "2024-02-08"
      to:
        description: "End date (YYYY-MM-DD, inclusive)"
        required: true

concurrency:
  group: ingest
  cancel-in-progress: false

jobs:
  backfill:
    runs-on: ubuntu-latest
    timeout-minutes: 360
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx tsx ingest/backfill.ts "${{ inputs.from }}" "${{ inputs.to }}"
        env:
          TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
```

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add ingest/backfill.ts tests/backfill.test.ts .github/workflows/backfill.yml
git commit -m "feat: historical price backfill replaying tcgcsv archives"
```

- [ ] **Step 8: MANUAL GATE — run the backfill** (after Task 8's manual gate + first daily run)

User (or engineer with secrets access) dispatches the "Historical price backfill" workflow in chunks (e.g. 3 months per run to stay well inside the 6h limit; watch the first run's timing and adjust). Order: **backfill BEFORE more daily runs accumulate**, oldest chunk first: `2024-02-08 → 2024-04-30`, then `2024-05-01 → …`, chronologically. Watch Turso's monthly row-write quota (10M free): each chunk's log lines report written counts; if a month approaches the quota, pause until the quota resets.

---

### Task 10: README + push

**Files:**
- Create/Replace: `README.md` (create-next-app will have generated a boilerplate one)

- [ ] **Step 1: Write the README**

```markdown
# Hitstreak

TCG collection, market-value, and deck tracker for Pokémon, One Piece, and Riftbound.

## Status

Phase 1: data pipeline (catalog + daily write-on-change price ingestion from tcgcsv,
raw archives to R2, historical backfill from 2024-02-08). App UI lands in Phase 2.

## Stack

Next.js (App Router) on Vercel · Turso (libSQL) · Cloudflare R2 · GitHub Actions ingestion · vitest

## Development

```bash
npm install
npm test                     # vitest against throwaway file: DBs
npm run dev                  # Next.js dev server (UI arrives in Phase 2)
```

Local ingestion run (PowerShell):

```powershell
$env:TURSO_DATABASE_URL = 'file:hitstreak.local.db'
npx tsx ingest/daily.ts
```

## Ingestion

- `ingest/daily.ts` — daily sync (GitHub Actions, 21:00 UTC): catalog upsert + write-on-change prices
- `ingest/backfill.ts` — one-time archive replay from 2024-02-08 (manual workflow, run chronologically)
- Raw tcgcsv responses are archived to R2 under `raw/tcgplayer/<date>/<category>/` before processing

Env vars: see `.env.example`. CI secrets: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## Design docs

- Spec: `docs/superpowers/specs/2026-09-05-hitstreak-design.md`
- Plans: `docs/superpowers/plans/`
```

- [ ] **Step 2: Full verification**

Run: `npm test` → all green.
Run: `npm run build` → succeeds.

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: README for phase 1 data pipeline"
git push
```

---

## Out of scope for this plan (later phases)

- Phase 2: Better Auth, portfolios/collection CRUD, search + set browsing UI
- Phase 3: price charts, portfolio_history materialization + `/api/internal/nightly`, share links, Resend alerts
- Phase 4: decks (meta browser, gap analysis, builder + per-game validators, admin curation)

The `portfolios`/`collection_items`/`decks` tables are deliberately NOT in this phase's schema — `lib/schema.ts` grows additively in each phase (`CREATE TABLE IF NOT EXISTS` makes that safe).

## Risks the engineer should know

- **Pokémon volume:** ~400+ groups, ~800+ requests at 250ms delay ≈ 4–6 min; ~100k cards on first run means heavy first-day upserts. `c.batch(..., "write")` chunking at 200 keeps statements bounded. If the first live run is slow, raise CHUNK before parallelizing anything.
- **Archive shape:** Task 9's walker is shape-tolerant, but verify against the first real extracted archive (engineer note in Task 9 Step 3).
- **Turso write quota:** first daily run and each backfill chunk are the big writers. The daily steady state (~write-on-change) is well inside free tier.
