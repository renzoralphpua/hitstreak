# Hitstreak Phase 2b — Collections, Search, Sets, Card Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first real product screens on the Collection design: user collections ("collections") with holdings valued from `latest_prices`, a type-ahead card search, the set browser with completion tracking and tap-to-own, and a card detail page — all composed from `components/ui/` primitives only.

**Architecture:** Two new tables (`collections`, `collection_items`) added to the self-initializing schema, scoped by Better Auth's text `user.id`. Reads go through two data-layer modules (`lib/collections.ts`, `lib/catalog.ts`) that take `userId` explicitly and always join through `collections.user_id` (referential/ownership integrity is enforced in code, spec §5). Mutations are Next.js **server actions** in `app/(app)/collections/actions.ts` that call `getSession()` first. Screens are Server Components that fetch via the data layer and render primitives; the only client components are the interactive bits (add-item dialog, tap-to-own tile, search box). Money stays `REAL` dollars, formatted at display via `lib/format.ts`.

**Tech Stack:** Next.js 16 App Router (server actions, `revalidatePath`), React 19, Tailwind v4 tokens, libSQL, Better Auth session, vitest + Testing Library.

**Reference:** Spec §5 (data model), §7 (application surface — catalog, collections, card detail), §12 (UI approach). Mockups: `docs/design/Main.dc.html` (collection home), `Sets.dc.html`, `Card.dc.html`. Tokens/primitives: `docs/design/README.md` "Implemented as".

**Conventions:** as Phase 2a. New: every data-layer function's first parameter is `userId: string`; server actions re-check the session and return `{ ok: true } | { ok: false; error: string }` (never throw to the client). Tests seed a mini catalog with `tests/helpers/seed.ts` (Task 2). Component tests mock `next/navigation` and server actions the way `tests/ui/auth-form.test.tsx` does.

**Deferred to Phase 3 (do NOT build here):** price history charts, `collection_history`, share links, alerts, the nightly endpoint. `/decks` and `/alerts` get "coming soon" placeholders so the nav does not 404.

---

## File structure

```
lib/schema.ts                        + collections, collection_items (COLLECTION_SCHEMA_SQL appended)
lib/collections.ts                    collection + item CRUD, holdings valuation
lib/catalog.ts                       search, sets with completion, set detail, card detail, 30D change
tests/helpers/seed.ts                seedMiniCatalog(): 2 games, 2 sets, cards, printings, latest_prices, snapshots
tests/collections.test.ts             data layer
tests/catalog.test.ts                (exists: ingest catalog tests) → new file tests/catalog-read.test.ts
app/(app)/collections/actions.ts      server actions: createCollection, renameCollection, deleteCollection, addItem, updateItem, removeItem
app/(app)/collections/page.tsx        collection list + create
app/(app)/collections/[id]/page.tsx   holdings, value, add item
app/(app)/collections/[id]/HoldingsTable.tsx      client (edit qty / remove)
app/(app)/collections/[id]/AddItemDialog.tsx      client (search → printing → qty/condition/price)
app/(app)/collections/CollectionForm.tsx            client (create / rename)
app/api/search/route.ts              GET ?q=&game= → cards (session-checked)
app/(app)/sets/page.tsx              game pills + set list with completion
app/(app)/sets/[id]/page.tsx         set header + filter + CardTile grid
app/(app)/sets/[id]/SetGrid.tsx      client (filter pills, target-collection pill, tap-to-own)
app/(app)/cards/[id]/page.tsx        card detail
app/(app)/decks/page.tsx, app/(app)/alerts/page.tsx   placeholders
components/ui/EmptyState.tsx         new primitive (title, body, action)
components/ui/MoneyDisplay.tsx       new primitive: serif whole + dim cents (from splitMoney)
```

---

### Task 1: Schema + collections data layer

**Files:** modify `lib/schema.ts`, `lib/db.ts`; create `lib/collections.ts`, `tests/helpers/seed.ts`, `tests/collections.test.ts`

- [x] **Step 1: Seed helper** (used by every data-layer test)

```ts
// tests/helpers/seed.ts
// A tiny, deterministic catalog for data-layer tests: 2 games, 2 sets, 4 cards, 5 printings,
// latest prices and a few snapshots. Returns ids so tests don't hard-code them.
import { db } from "@/lib/db";

export async function seedMiniCatalog() {
  const c = await db();
  await c.batch(
    [
      { sql: "INSERT INTO games (tcgplayer_category_id, name, slug) VALUES (3, 'Pokémon', 'pokemon'), (68, 'One Piece Card Game', 'one-piece')", args: [] },
      { sql: "INSERT INTO sets (game_id, tcgplayer_group_id, name, code, release_date) VALUES (1, 604, 'Prismatic Evolutions', 'PRE', '2025-01-17'), (2, 900, 'Two Legends', 'OP08', '2024-09-13')", args: [] },
      { sql: `INSERT INTO cards (set_id, tcgplayer_product_id, name, number, rarity, image_url, attrs) VALUES
        (1, 1001, 'Umbreon ex', '161/131', 'Special Illustration Rare', 'https://img.example/1001.jpg', '{}'),
        (1, 1002, 'Pikachu', '025/131', 'Common', NULL, '{}'),
        (1, 1003, 'Booster Bundle', NULL, NULL, NULL, '{}'),
        (2, 2001, 'Shanks', 'OP08-118', 'Secret Rare', NULL, '{}')`, args: [] },
      { sql: `INSERT INTO printings (card_id, subtype) VALUES (1, 'Holofoil'), (2, 'Normal'), (2, 'Reverse Holofoil'), (3, 'Normal'), (4, 'Normal')`, args: [] },
      { sql: `INSERT INTO latest_prices (printing_id, date, market, low, mid, high) VALUES
        (1, '2026-09-07', 1465.00, 1200, 1400, 1600),
        (2, '2026-09-07', 0.25, 0.1, 0.2, 0.5),
        (3, '2026-09-07', 1.10, 0.8, 1.0, 1.5),
        (4, '2026-09-07', NULL, NULL, NULL, NULL),
        (5, '2026-09-07', 204.30, 180, 200, 230)`, args: [] },
      { sql: `INSERT INTO price_snapshots (printing_id, date, market, low, mid, high) VALUES
        (1, '2026-07-01', 1100.00, 900, 1050, 1200),
        (1, '2026-09-01', 1465.00, 1200, 1400, 1600),
        (5, '2026-08-01', 210.00, 190, 205, 240),
        (5, '2026-09-05', 204.30, 180, 200, 230)`, args: [] },
    ],
    "write"
  );
  return {
    games: { pokemon: 1, onePiece: 2 },
    sets: { prismatic: 1, twoLegends: 2 },
    cards: { umbreon: 1, pikachu: 2, bundle: 3, shanks: 4 },
    printings: { umbreonHolo: 1, pikachuNormal: 2, pikachuReverse: 3, bundle: 4, shanksNormal: 5 },
  };
}
```

- [x] **Step 2: Failing tests**

```ts
// tests/collections.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("collections");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import {
  listCollections, createCollection, renameCollection, deleteCollection,
  addItem, updateItem, removeItem, getCollectionHoldings, getCollectionSummary,
} from "@/lib/collections";

const U1 = "user_1", U2 = "user_2";
let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;

beforeAll(async () => { seed = await seedMiniCatalog(); });
afterAll(() => { closeDb(); tmp.clean(); });

describe("collections", () => {
  it("creates, lists (own only), renames, deletes", async () => {
    const a = await createCollection(U1, "Main Collection");
    await createCollection(U1, "OP Investments");
    await createCollection(U2, "Someone else");
    expect((await listCollections(U1)).map((p) => p.name)).toEqual(["Main Collection", "OP Investments"]);
    await renameCollection(U1, a.id, "Collection One");
    expect((await listCollections(U1))[0].name).toBe("Collection One");
    expect(await renameCollection(U2, a.id, "hijack")).toBe(false); // not the owner
    const b = (await listCollections(U1))[1];
    expect(await deleteCollection(U1, b.id)).toBe(true);
    expect((await listCollections(U1)).length).toBe(1);
  });

  it("rejects blank or overlong names", async () => {
    await expect(createCollection(U1, "   ")).rejects.toThrow(/name/i);
    await expect(createCollection(U1, "x".repeat(81))).rejects.toThrow(/name/i);
  });

  it("adds items, merges same printing+condition, updates, removes", async () => {
    const [p] = await listCollections(U1);
    await addItem(U1, p.id, { printingId: seed.printings.umbreonHolo, quantity: 1, condition: "NM", acquiredPrice: 1100 });
    await addItem(U1, p.id, { printingId: seed.printings.pikachuNormal, quantity: 3, condition: "NM", acquiredPrice: 0.2 });
    await addItem(U1, p.id, { printingId: seed.printings.pikachuNormal, quantity: 2, condition: "NM" }); // merges → 5, keeps price
    await addItem(U1, p.id, { printingId: seed.printings.bundle, quantity: 1, condition: "NM" });       // unpriced
    const h = await getCollectionHoldings(U1, p.id);
    expect(h.map((x) => [x.cardName, x.subtype, x.quantity])).toEqual([
      ["Umbreon ex", "Holofoil", 1], ["Pikachu", "Normal", 5], ["Booster Bundle", "Normal", 1],
    ]);
    const pika = h.find((x) => x.cardName === "Pikachu")!;
    expect(pika.acquiredPrice).toBe(0.2);
    expect(pika.market).toBe(0.25);
    expect(pika.value).toBeCloseTo(1.25);
    expect(pika.cost).toBeCloseTo(1.0);
    await updateItem(U1, pika.itemId, { quantity: 4, acquiredPrice: 0.3 });
    expect((await getCollectionHoldings(U1, p.id)).find((x) => x.cardName === "Pikachu")!.quantity).toBe(4);
    expect(await removeItem(U2, pika.itemId)).toBe(false); // not the owner
    expect(await removeItem(U1, pika.itemId)).toBe(true);
    expect((await getCollectionHoldings(U1, p.id)).length).toBe(2);
  });

  it("summarizes value, cost, gain, unpriced count", async () => {
    const [p] = await listCollections(U1);
    const s = await getCollectionSummary(U1, p.id);
    expect(s.cards).toBe(2);           // 1 Umbreon + 1 bundle (quantities)
    expect(s.value).toBeCloseTo(1465);  // bundle has null market → excluded
    expect(s.cost).toBeCloseTo(1100);   // bundle has no acquired price
    expect(s.gain).toBeCloseTo(365);
    expect(s.unpriced).toBe(1);
  });

  it("rejects bad quantities and conditions", async () => {
    const [p] = await listCollections(U1);
    await expect(addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 0, condition: "NM" })).rejects.toThrow(/quantity/i);
    await expect(addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "MINTY" as never })).rejects.toThrow(/condition/i);
    await expect(addItem(U2, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "NM" })).rejects.toThrow(/collection/i);
  });

  it("deleting a collection removes its items", async () => {
    const p = await createCollection(U1, "Temp");
    await addItem(U1, p.id, { printingId: seed.printings.shanksNormal, quantity: 1, condition: "LP" });
    await deleteCollection(U1, p.id);
    const c = await db();
    expect(Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?", args: [p.id] })).rows[0].n)).toBe(0);
  });
});
```

- [x] **Step 3: Schema** — append to `lib/schema.ts`:

```ts
// Phase 2b: user collections. user_id is Better Auth's text user.id; ownership is enforced in
// lib/collections.ts by joining through collections.user_id (FKs are unenforced in SQLite).
export const COLLECTION_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);

  CREATE TABLE IF NOT EXISTS collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL REFERENCES collections(id),
    printing_id INTEGER NOT NULL REFERENCES printings(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    condition TEXT NOT NULL DEFAULT 'NM',
    acquired_price REAL,      -- dollars, per copy
    acquired_date TEXT,       -- YYYY-MM-DD
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (collection_id, printing_id, condition)
  );
  CREATE INDEX IF NOT EXISTS idx_items_collection ON collection_items(collection_id);
  CREATE INDEX IF NOT EXISTS idx_items_printing ON collection_items(printing_id);
`;
```

`lib/db.ts`: `executeMultiple(SCHEMA_SQL + AUTH_SCHEMA_SQL + COLLECTION_SCHEMA_SQL)`.

- [x] **Step 4: Data layer**

```ts
// lib/collections.ts
// User collections. Every function takes userId first and scopes through collections.user_id;
// a wrong owner sees "not found" (false / empty), never someone else's data.
import { db } from "@/lib/db";

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface Collection { id: number; name: string; createdAt: string }
export interface Holding {
  itemId: number; printingId: number; cardId: number; cardName: string; setName: string; number: string | null;
  subtype: string; imageUrl: string | null; quantity: number; condition: Condition;
  acquiredPrice: number | null; acquiredDate: string | null;
  market: number | null; priceDate: string | null;
  value: number | null;   // quantity × market, null when unpriced
  cost: number | null;    // quantity × acquiredPrice, null when unknown
}
export interface CollectionSummary { cards: number; value: number; cost: number; gain: number; unpriced: number }

const NAME_MAX = 80;
function cleanName(name: string): string {
  const n = name.trim();
  if (n.length === 0 || n.length > NAME_MAX) throw new Error(`Collection name must be 1–${NAME_MAX} characters`);
  return n;
}

export async function listCollections(userId: string): Promise<Collection[]> {
  const c = await db();
  const r = await c.execute({ sql: "SELECT id, name, created_at FROM collections WHERE user_id = ? ORDER BY created_at, id", args: [userId] });
  return r.rows.map((x) => ({ id: Number(x.id), name: String(x.name), createdAt: String(x.created_at) }));
}

export async function createCollection(userId: string, name: string): Promise<Collection> {
  const c = await db();
  const r = await c.execute({ sql: "INSERT INTO collections (user_id, name) VALUES (?, ?) RETURNING id, name, created_at", args: [userId, cleanName(name)] });
  const x = r.rows[0];
  return { id: Number(x.id), name: String(x.name), createdAt: String(x.created_at) };
}

export async function renameCollection(userId: string, id: number, name: string): Promise<boolean> {
  const c = await db();
  const r = await c.execute({ sql: "UPDATE collections SET name = ? WHERE id = ? AND user_id = ?", args: [cleanName(name), id, userId] });
  return r.rowsAffected === 1;
}

export async function deleteCollection(userId: string, id: number): Promise<boolean> {
  const c = await db();
  const own = await c.execute({ sql: "SELECT 1 FROM collections WHERE id = ? AND user_id = ?", args: [id, userId] });
  if (own.rows.length === 0) return false;
  await c.batch(
    [
      { sql: "DELETE FROM collection_items WHERE collection_id = ?", args: [id] },
      { sql: "DELETE FROM collections WHERE id = ? AND user_id = ?", args: [id, userId] },
    ],
    "write"
  );
  return true;
}

async function assertOwnsCollection(userId: string, collectionId: number) {
  const c = await db();
  const r = await c.execute({ sql: "SELECT 1 FROM collections WHERE id = ? AND user_id = ?", args: [collectionId, userId] });
  if (r.rows.length === 0) throw new Error("Collection not found");
}

function checkQuantity(q: number) {
  if (!Number.isInteger(q) || q <= 0 || q > 9999) throw new Error("Quantity must be a whole number from 1 to 9999");
}
function checkCondition(cnd: string): Condition {
  if (!(CONDITIONS as readonly string[]).includes(cnd)) throw new Error(`Condition must be one of ${CONDITIONS.join(", ")}`);
  return cnd as Condition;
}
function checkPrice(p: number | null | undefined): number | null {
  if (p == null) return null;
  if (!Number.isFinite(p) || p < 0) throw new Error("Price must be zero or more");
  return p;
}

export interface AddItemInput { printingId: number; quantity: number; condition: string; acquiredPrice?: number | null; acquiredDate?: string | null }

/** Adds copies; an existing row for the same (collection, printing, condition) is merged (quantity
 *  summed, acquired price/date kept unless the existing row has none). */
export async function addItem(userId: string, collectionId: number, input: AddItemInput): Promise<void> {
  await assertOwnsCollection(userId, collectionId);
  checkQuantity(input.quantity);
  const condition = checkCondition(input.condition);
  const price = checkPrice(input.acquiredPrice);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO collection_items (collection_id, printing_id, quantity, condition, acquired_price, acquired_date)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(collection_id, printing_id, condition) DO UPDATE SET
            quantity = quantity + excluded.quantity,
            acquired_price = COALESCE(collection_items.acquired_price, excluded.acquired_price),
            acquired_date = COALESCE(collection_items.acquired_date, excluded.acquired_date)`,
    args: [collectionId, input.printingId, input.quantity, condition, price, input.acquiredDate ?? null],
  });
}

export async function updateItem(userId: string, itemId: number, patch: { quantity?: number; acquiredPrice?: number | null; acquiredDate?: string | null }): Promise<boolean> {
  if (patch.quantity !== undefined) checkQuantity(patch.quantity);
  const price = patch.acquiredPrice === undefined ? undefined : checkPrice(patch.acquiredPrice);
  const c = await db();
  const r = await c.execute({
    sql: `UPDATE collection_items SET
            quantity = COALESCE(?, quantity),
            acquired_price = CASE WHEN ? THEN ? ELSE acquired_price END,
            acquired_date = CASE WHEN ? THEN ? ELSE acquired_date END
          WHERE id = ? AND collection_id IN (SELECT id FROM collections WHERE user_id = ?)`,
    args: [patch.quantity ?? null, price !== undefined ? 1 : 0, price ?? null, patch.acquiredDate !== undefined ? 1 : 0, patch.acquiredDate ?? null, itemId, userId],
  });
  return r.rowsAffected === 1;
}

export async function removeItem(userId: string, itemId: number): Promise<boolean> {
  const c = await db();
  const r = await c.execute({ sql: "DELETE FROM collection_items WHERE id = ? AND collection_id IN (SELECT id FROM collections WHERE user_id = ?)", args: [itemId, userId] });
  return r.rowsAffected === 1;
}

export async function getCollectionHoldings(userId: string, collectionId: number): Promise<Holding[]> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT ci.id AS item_id, ci.printing_id, ci.quantity, ci.condition, ci.acquired_price, ci.acquired_date,
                 ca.id AS card_id, ca.name AS card_name, ca.number, ca.image_url, se.name AS set_name, p.subtype,
                 lp.market, lp.date AS price_date
          FROM collection_items ci
          JOIN collections po ON po.id = ci.collection_id AND po.user_id = ?
          JOIN printings p ON p.id = ci.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          LEFT JOIN latest_prices lp ON lp.printing_id = p.id
          WHERE ci.collection_id = ?
          ORDER BY (ci.quantity * COALESCE(lp.market, 0)) DESC, ca.name`,
    args: [userId, collectionId],
  });
  return r.rows.map((x) => {
    const quantity = Number(x.quantity);
    const market = x.market == null ? null : Number(x.market);
    const acquiredPrice = x.acquired_price == null ? null : Number(x.acquired_price);
    return {
      itemId: Number(x.item_id), printingId: Number(x.printing_id), cardId: Number(x.card_id),
      cardName: String(x.card_name), setName: String(x.set_name), number: x.number == null ? null : String(x.number),
      subtype: String(x.subtype), imageUrl: x.image_url == null ? null : String(x.image_url),
      quantity, condition: String(x.condition) as Condition, acquiredPrice, acquiredDate: x.acquired_date == null ? null : String(x.acquired_date),
      market, priceDate: x.price_date == null ? null : String(x.price_date),
      value: market == null ? null : quantity * market,
      cost: acquiredPrice == null ? null : quantity * acquiredPrice,
    };
  });
}

export async function getCollectionSummary(userId: string, collectionId: number): Promise<CollectionSummary> {
  const h = await getCollectionHoldings(userId, collectionId);
  let cards = 0, value = 0, cost = 0, unpriced = 0;
  for (const x of h) {
    cards += x.quantity;
    if (x.value == null) unpriced += x.quantity; else value += x.value;
    if (x.cost != null) cost += x.cost;
  }
  return { cards, value, cost, gain: value - cost, unpriced };
}
```

- [x] **Step 5: Verify + commit** — `npm test`, `npm run typecheck`, `npm run lint`. Commit: `feat(collections): schema + data layer (CRUD, holdings valuation)`

---

### Task 2: Catalog read layer

**Files:** `lib/catalog.ts`, `tests/catalog-read.test.ts`

- [x] **Step 1: Failing tests**

```ts
// tests/catalog-read.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("catalog-read");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { createCollection, addItem } from "@/lib/collections";
import { searchCards, listGames, listSetsWithCompletion, getSetDetail, getCardDetail, thirtyDayChange } from "@/lib/catalog";

const U = "user_1";
let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
beforeAll(async () => {
  seed = await seedMiniCatalog();
  const p = await createCollection(U, "Main");
  await addItem(U, p.id, { printingId: seed.printings.umbreonHolo, quantity: 1, condition: "NM" });
  await addItem(U, p.id, { printingId: seed.printings.pikachuNormal, quantity: 2, condition: "NM" });
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("searchCards", () => {
  it("matches name prefix/substring case-insensitively, returns printings with prices, optional game filter", async () => {
    const r = await searchCards("pika");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ cardId: seed.cards.pikachu, name: "Pikachu", setName: "Prismatic Evolutions", gameSlug: "pokemon" });
    expect(r[0].printings.map((p) => [p.subtype, p.market])).toEqual([["Normal", 0.25], ["Reverse Holofoil", 1.1]]);
    expect(await searchCards("SHANKS", { gameSlug: "pokemon" })).toHaveLength(0);
    expect(await searchCards("shanks", { gameSlug: "one-piece" })).toHaveLength(1);
    expect(await searchCards("161/131")).toHaveLength(1); // number match
    expect(await searchCards("a")).toHaveLength(0);        // too short → no results
  });
});

describe("sets", () => {
  it("lists games and sets with completion for the user", async () => {
    expect((await listGames()).map((g) => g.slug)).toEqual(["pokemon", "one-piece"]);
    const sets = await listSetsWithCompletion(U, "pokemon");
    expect(sets).toHaveLength(1);
    // cards with a number count toward completion (sealed products don't): Umbreon + Pikachu = 2 total, both owned
    expect(sets[0]).toMatchObject({ id: seed.sets.prismatic, name: "Prismatic Evolutions", totalCards: 2, ownedCards: 2 });
  });
  it("set detail lists numbered cards with owned quantity and cheapest printing price", async () => {
    const d = await getSetDetail(U, seed.sets.prismatic);
    expect(d.set.name).toBe("Prismatic Evolutions");
    expect(d.cards.map((c) => [c.name, c.ownedQuantity, c.lowestMarket])).toEqual([
      ["Pikachu", 2, 0.25], ["Umbreon ex", 1, 1465],
    ]); // sorted by number: 025 before 161
    expect(d.stats).toMatchObject({ totalCards: 2, ownedCards: 2, setValue: 1465.25, missingCost: 0 });
  });
});

describe("card detail", () => {
  it("returns printings with price, 30-day change, and the user's copies", async () => {
    const d = await getCardDetail(U, seed.cards.umbreon);
    expect(d?.card).toMatchObject({ name: "Umbreon ex", number: "161/131", rarity: "Special Illustration Rare", setName: "Prismatic Evolutions" });
    expect(d?.printings[0]).toMatchObject({ subtype: "Holofoil", market: 1465, owned: 1 });
    expect(d?.printings[0].change30d).toMatchObject({ amount: 365, ratio: 365 / 1100 });
    expect(await getCardDetail(U, 99999)).toBeNull();
  });
  it("thirtyDayChange carries forward the last snapshot before the cutoff", async () => {
    expect(await thirtyDayChange(seed.printings.shanksNormal, "2026-09-07")).toMatchObject({ amount: 204.3 - 210, ratio: (204.3 - 210) / 210 });
    expect(await thirtyDayChange(seed.printings.pikachuNormal, "2026-09-07")).toBeNull(); // no history
  });
});
```

- [x] **Step 2: Implementation**

```ts
// lib/catalog.ts
// Read side of the catalog for the UI. Prices come from latest_prices (last seen); 30-day change
// is derived from price_snapshots by carry-forward (spec §5 write-on-change semantics).
import { db } from "@/lib/db";

export interface PrintingPrice { printingId: number; subtype: string; market: number | null; priceDate: string | null }
export interface SearchHit { cardId: number; name: string; number: string | null; rarity: string | null; imageUrl: string | null; setName: string; gameSlug: string; printings: PrintingPrice[] }

const MIN_QUERY = 2;

export async function searchCards(q: string, opts: { gameSlug?: string; limit?: number } = {}): Promise<SearchHit[]> {
  const query = q.trim();
  if (query.length < MIN_QUERY) return [];
  const limit = Math.min(opts.limit ?? 20, 50);
  const c = await db();
  const like = `%${query.replace(/[%_]/g, (m) => "\\" + m)}%`;
  const rows = (await c.execute({
    sql: `SELECT ca.id, ca.name, ca.number, ca.rarity, ca.image_url, se.name AS set_name, g.slug AS game_slug
          FROM cards ca JOIN sets se ON se.id = ca.set_id JOIN games g ON g.id = se.game_id
          WHERE (ca.name LIKE ? ESCAPE '\\' OR ca.number LIKE ? ESCAPE '\\') AND (? IS NULL OR g.slug = ?)
          ORDER BY CASE WHEN ca.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, ca.name, se.release_date DESC
          LIMIT ?`,
    args: [like, like, opts.gameSlug ?? null, opts.gameSlug ?? null, `${query.replace(/[%_]/g, (m) => "\\" + m)}%`, limit],
  })).rows;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.id));
  const prices = (await c.execute({
    sql: `SELECT p.id AS printing_id, p.card_id, p.subtype, lp.market, lp.date
          FROM printings p LEFT JOIN latest_prices lp ON lp.printing_id = p.id
          WHERE p.card_id IN (${ids.map(() => "?").join(",")}) ORDER BY p.card_id, p.id`,
    args: ids,
  })).rows;
  const byCard = new Map<number, PrintingPrice[]>();
  for (const r of prices) {
    const list = byCard.get(Number(r.card_id)) ?? [];
    list.push({ printingId: Number(r.printing_id), subtype: String(r.subtype), market: r.market == null ? null : Number(r.market), priceDate: r.date == null ? null : String(r.date) });
    byCard.set(Number(r.card_id), list);
  }
  return rows.map((r) => ({
    cardId: Number(r.id), name: String(r.name), number: r.number == null ? null : String(r.number), rarity: r.rarity == null ? null : String(r.rarity),
    imageUrl: r.image_url == null ? null : String(r.image_url), setName: String(r.set_name), gameSlug: String(r.game_slug),
    printings: byCard.get(Number(r.id)) ?? [],
  }));
}

export interface Game { id: number; slug: string; name: string }
export async function listGames(): Promise<Game[]> {
  const c = await db();
  return (await c.execute("SELECT id, slug, name FROM games ORDER BY id")).rows.map((r) => ({ id: Number(r.id), slug: String(r.slug), name: String(r.name) }));
}

export interface SetCompletion { id: number; name: string; code: string | null; releaseDate: string | null; totalCards: number; ownedCards: number }

/** Completion counts CARDS (rows with a number — sealed products are excluded), owned = at least one copy in any of the user's collections. */
export async function listSetsWithCompletion(userId: string, gameSlug: string): Promise<SetCompletion[]> {
  const c = await db();
  const rows = (await c.execute({
    sql: `SELECT se.id, se.name, se.code, se.release_date,
                 (SELECT COUNT(*) FROM cards ca WHERE ca.set_id = se.id AND ca.number IS NOT NULL) AS total_cards,
                 (SELECT COUNT(DISTINCT ca.id) FROM cards ca
                    JOIN printings p ON p.card_id = ca.id
                    JOIN collection_items ci ON ci.printing_id = p.id
                    JOIN collections po ON po.id = ci.collection_id AND po.user_id = ?
                  WHERE ca.set_id = se.id AND ca.number IS NOT NULL) AS owned_cards
          FROM sets se JOIN games g ON g.id = se.game_id
          WHERE g.slug = ?
          ORDER BY se.release_date DESC, se.name`,
    args: [userId, gameSlug],
  })).rows;
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name), code: r.code == null ? null : String(r.code), releaseDate: r.release_date == null ? null : String(r.release_date), totalCards: Number(r.total_cards), ownedCards: Number(r.owned_cards) }));
}

export interface SetCard { cardId: number; name: string; number: string; rarity: string | null; imageUrl: string | null; lowestMarket: number | null; ownedQuantity: number; printings: PrintingPrice[] }
export interface SetDetail { set: { id: number; name: string; code: string | null; releaseDate: string | null; gameSlug: string; gameName: string }; cards: SetCard[]; stats: { totalCards: number; ownedCards: number; setValue: number; ownedValue: number; missingCost: number } }

export async function getSetDetail(userId: string, setId: number): Promise<SetDetail | null> {
  const c = await db();
  const s = (await c.execute({ sql: "SELECT se.id, se.name, se.code, se.release_date, g.slug, g.name AS game_name FROM sets se JOIN games g ON g.id = se.game_id WHERE se.id = ?", args: [setId] })).rows[0];
  if (!s) return null;
  const rows = (await c.execute({
    sql: `SELECT ca.id AS card_id, ca.name, ca.number, ca.rarity, ca.image_url, p.id AS printing_id, p.subtype, lp.market, lp.date,
                 COALESCE((SELECT SUM(ci.quantity) FROM collection_items ci JOIN collections po ON po.id = ci.collection_id AND po.user_id = ? WHERE ci.printing_id = p.id), 0) AS owned
          FROM cards ca JOIN printings p ON p.card_id = ca.id LEFT JOIN latest_prices lp ON lp.printing_id = p.id
          WHERE ca.set_id = ? AND ca.number IS NOT NULL
          ORDER BY ca.number, ca.id, p.id`,
    args: [userId, setId],
  })).rows;
  const cards = new Map<number, SetCard>();
  for (const r of rows) {
    const id = Number(r.card_id);
    const market = r.market == null ? null : Number(r.market);
    const owned = Number(r.owned);
    const card = cards.get(id) ?? { cardId: id, name: String(r.name), number: String(r.number), rarity: r.rarity == null ? null : String(r.rarity), imageUrl: r.image_url == null ? null : String(r.image_url), lowestMarket: null, ownedQuantity: 0, printings: [] };
    card.printings.push({ printingId: Number(r.printing_id), subtype: String(r.subtype), market, priceDate: r.date == null ? null : String(r.date) });
    card.ownedQuantity += owned;
    if (market != null && (card.lowestMarket == null || market < card.lowestMarket)) card.lowestMarket = market;
    cards.set(id, card);
  }
  const list = [...cards.values()];
  let setValue = 0, ownedValue = 0, missingCost = 0, ownedCards = 0;
  for (const card of list) {
    if (card.lowestMarket != null) setValue += card.lowestMarket;
    if (card.ownedQuantity > 0) { ownedCards++; if (card.lowestMarket != null) ownedValue += card.lowestMarket; }
    else if (card.lowestMarket != null) missingCost += card.lowestMarket;
  }
  return {
    set: { id: Number(s.id), name: String(s.name), code: s.code == null ? null : String(s.code), releaseDate: s.release_date == null ? null : String(s.release_date), gameSlug: String(s.slug), gameName: String(s.game_name) },
    cards: list,
    stats: { totalCards: list.length, ownedCards, setValue, ownedValue, missingCost },
  };
}

export interface Change { amount: number; ratio: number }
/** Market on `asOf` vs. the carried-forward snapshot 30 days earlier; null without history. */
export async function thirtyDayChange(printingId: number, asOf: string): Promise<Change | null> {
  const c = await db();
  const cutoff = new Date(`${asOf}T00:00:00Z`); cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const then = (await c.execute({ sql: "SELECT market FROM price_snapshots WHERE printing_id = ? AND date <= ? ORDER BY date DESC LIMIT 1", args: [printingId, cutoffDate] })).rows[0];
  const now = (await c.execute({ sql: "SELECT market FROM latest_prices WHERE printing_id = ?", args: [printingId] })).rows[0];
  if (!then || then.market == null || !now || now.market == null) return null;
  const a = Number(then.market), b = Number(now.market);
  if (a === 0) return null;
  return { amount: b - a, ratio: (b - a) / a };
}

export interface CardDetail {
  card: { id: number; name: string; number: string | null; rarity: string | null; imageUrl: string | null; setId: number; setName: string; gameSlug: string; gameName: string; attrs: Record<string, string> };
  printings: Array<PrintingPrice & { owned: number; change30d: Change | null }>;
}
export async function getCardDetail(userId: string, cardId: number, asOf = new Date().toISOString().slice(0, 10)): Promise<CardDetail | null> {
  const c = await db();
  const r = (await c.execute({ sql: "SELECT ca.*, se.name AS set_name, g.slug AS game_slug, g.name AS game_name FROM cards ca JOIN sets se ON se.id = ca.set_id JOIN games g ON g.id = se.game_id WHERE ca.id = ?", args: [cardId] })).rows[0];
  if (!r) return null;
  const ps = (await c.execute({
    sql: `SELECT p.id, p.subtype, lp.market, lp.date,
                 COALESCE((SELECT SUM(ci.quantity) FROM collection_items ci JOIN collections po ON po.id = ci.collection_id AND po.user_id = ? WHERE ci.printing_id = p.id), 0) AS owned
          FROM printings p LEFT JOIN latest_prices lp ON lp.printing_id = p.id WHERE p.card_id = ? ORDER BY p.id`,
    args: [userId, cardId],
  })).rows;
  const printings = [];
  for (const p of ps) {
    printings.push({ printingId: Number(p.id), subtype: String(p.subtype), market: p.market == null ? null : Number(p.market), priceDate: p.date == null ? null : String(p.date), owned: Number(p.owned), change30d: await thirtyDayChange(Number(p.id), asOf) });
  }
  let attrs: Record<string, string> = {};
  try { attrs = JSON.parse(String(r.attrs ?? "{}")); } catch { /* keep {} */ }
  return {
    card: { id: Number(r.id), name: String(r.name), number: r.number == null ? null : String(r.number), rarity: r.rarity == null ? null : String(r.rarity), imageUrl: r.image_url == null ? null : String(r.image_url), setId: Number(r.set_id), setName: String(r.set_name), gameSlug: String(r.game_slug), gameName: String(r.game_name), attrs },
    printings,
  };
}
```

Note for the test: `getCardDetail` in the test passes no `asOf`, so it uses today; the seed's Umbreon snapshots are `2026-07-01 @1100` and `2026-09-01 @1465` — "30 days before today" must land after 07-01 and before 09-01 for the expected 365 change. **Pass `asOf: "2026-09-07"` explicitly in the test** to make it deterministic (`getCardDetail(U, id, "2026-09-07")`) — update the test accordingly.

- [x] **Step 3: Verify + commit** — `feat(catalog): read layer — search, set completion, set detail, card detail, 30-day change`

---

### Task 3: New primitives — EmptyState, MoneyDisplay

**Files:** `components/ui/EmptyState.tsx`, `components/ui/MoneyDisplay.tsx`, barrel, `tests/ui/primitives-c.test.tsx`, add both to `app/dev/ui/page.tsx` + gallery test list

- [x] Tests: `EmptyState` renders title (heading), body, and an optional action node; `MoneyDisplay amount={4812.4}` renders `$4,812` in `font-display` and `.40` in `text-dim`; `amount={null}` renders `—`; `size="lg"` applies the 56px class.

```tsx
// components/ui/EmptyState.tsx
import type { ReactNode } from "react";
import { cn } from "./cn";
export default function EmptyState({ title, body, action, className }: { title: string; body?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-panel border border-dashed border-hairline p-6", className)}>
      <h3 className="font-display text-xl text-ink">{title}</h3>
      {body && <p className="max-w-prose text-[13px] text-muted">{body}</p>}
      {action}
    </div>
  );
}
```
```tsx
// components/ui/MoneyDisplay.tsx
import { splitMoney } from "@/lib/format";
import { cn } from "./cn";
/** The Collection money style: serif whole dollars, dim cents. */
export default function MoneyDisplay({ amount, size = "md", className }: { amount: number | null | undefined; size?: "md" | "lg"; className?: string }) {
  if (amount == null || !Number.isFinite(amount)) return <span className={cn("font-display text-dim", size === "lg" ? "text-[56px]" : "text-[32px]", className)}>—</span>;
  const { whole, cents } = splitMoney(amount);
  return (
    <span className={cn("num font-display leading-none tracking-tight", size === "lg" ? "text-[56px]" : "text-[32px]", className)}>
      {whole}<span className="text-dim">{cents}</span>
    </span>
  );
}
```
Commit: `feat(ui): EmptyState, MoneyDisplay`

---

### Task 4: Server actions + collection list page

**Files:** `app/(app)/collections/actions.ts`, `app/(app)/collections/CollectionForm.tsx`, `app/(app)/collections/page.tsx` (replace placeholder), `tests/actions.test.ts`, `tests/ui/collection-form.test.tsx`

- [x] **Actions** — every action: `const session = await getSession(); if (!session) return { ok: false, error: "Not signed in" }`; call the data layer inside try/catch mapping thrown validation errors to `{ ok: false, error: e.message }`; `revalidatePath("/collections")` (and `/collections/[id]`, `/sets`, `/sets/[id]`, `/cards/[id]` where relevant) on success; return `{ ok: true, id? }`.

```ts
// app/(app)/collections/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import * as P from "@/lib/collections";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function withUser<T>(fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  try { return { ok: true, data: await fn(session.user.id) }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" }; }
}

export async function createCollectionAction(name: string) {
  const r = await withUser((u) => P.createCollection(u, name));
  if (r.ok) revalidatePath("/collections");
  return r;
}
export async function renameCollectionAction(id: number, name: string) {
  const r = await withUser(async (u) => { if (!(await P.renameCollection(u, id, name))) throw new Error("Collection not found"); });
  if (r.ok) { revalidatePath("/collections"); revalidatePath(`/collections/${id}`); }
  return r;
}
export async function deleteCollectionAction(id: number) {
  const r = await withUser(async (u) => { if (!(await P.deleteCollection(u, id))) throw new Error("Collection not found"); });
  if (r.ok) { revalidatePath("/collections"); revalidatePath("/sets"); }
  return r;
}
export async function addItemAction(collectionId: number, input: P.AddItemInput) {
  const r = await withUser((u) => P.addItem(u, collectionId, input));
  if (r.ok) { revalidatePath(`/collections/${collectionId}`); revalidatePath("/collections"); revalidatePath("/sets"); }
  return r;
}
export async function updateItemAction(collectionId: number, itemId: number, patch: { quantity?: number; acquiredPrice?: number | null }) {
  const r = await withUser(async (u) => { if (!(await P.updateItem(u, itemId, patch))) throw new Error("Item not found"); });
  if (r.ok) revalidatePath(`/collections/${collectionId}`);
  return r;
}
export async function removeItemAction(collectionId: number, itemId: number) {
  const r = await withUser(async (u) => { if (!(await P.removeItem(u, itemId))) throw new Error("Item not found"); });
  if (r.ok) { revalidatePath(`/collections/${collectionId}`); revalidatePath("/sets"); }
  return r;
}
```
`tests/actions.test.ts` (node): mock `@/lib/session` (`getSession` → `{ user: { id: "user_1" } }` or `null`) and `next/cache` (`revalidatePath: vi.fn()`); with `tmpDb("actions")` + `seedMiniCatalog`, assert: signed-out → `{ ok: false, error: "Not signed in" }`; create → `ok` and the collection exists; blank name → `{ ok: false, error: /name/ }`; addItem on someone else's collection → `{ ok: false }`; `revalidatePath` called with `/collections`.

- [x] **CollectionForm** (client): create mode (input + "Create collection" `Button`) and rename mode (inline input, Save/Cancel `Button`s); calls the action, shows `role="alert"` on error, `router.refresh()` on success. Test with mocked actions like `auth-form.test.tsx`.

- [x] **Page** `app/(app)/collections/page.tsx` (server): `getSession()` (layout guarantees it, but read the user id), `listCollections(userId)`; for each, `getCollectionSummary`. Layout per `Main.dc.html`: `SectionHeading title="Your collections" caption="{n} collections"`; list of `Panel`s each with the name (link to `/collections/[id]`), `MoneyDisplay amount={value}`, `PriceDelta` for gain (amount = gain, ratio = cost ? gain / cost : null), `StatTile`s Paid / Cards; a rename `CollectionForm mode="rename"` inline and a delete `Button variant="secondary"` (confirm via `window.confirm` in a tiny client `DeleteCollectionButton`). Empty state: `EmptyState title="No collections yet" body="Create one to start tracking cards." action={<CollectionForm mode="create" />}`. When ≥1 exists, a compact create form at the bottom.

Commit: `feat(collections): server actions, collection list page, create/rename/delete`

---

### Task 5: Collection detail — holdings + add item

**Files:** `app/(app)/collections/[id]/page.tsx`, `HoldingsTable.tsx`, `AddItemDialog.tsx`, `app/api/search/route.ts`, `tests/search-route.test.ts`, `tests/ui/holdings-table.test.tsx`, `tests/ui/add-item-dialog.test.tsx`

- [x] **Search route** `app/api/search/route.ts`: `GET /api/search?q=&game=` → `getSession()` else 401; `searchCards(q, { gameSlug })` → JSON `{ hits }`; `Cache-Control: private, no-store`. Test: mock `@/lib/session`; 401 without session; results with `tmpDb` + seed (construct `new NextRequest("http://x/api/search?q=pika")`).

- [x] **Page** (server): `params` is a Promise (`const { id } = await params`); `Number(id)`; `getCollectionSummary` + `getCollectionHoldings`; 404 via `notFound()` when the collection isn't the user's (holdings query returns [] for both empty and not-owned — so also check `listCollections` includes the id). Header per `Main.dc.html` left column: `SectionHeading` with the collection name; `MoneyDisplay size="lg"`; `PriceDelta` gain (`caption="vs. paid"`); `StatTile`s Paid / Gain / Cards / Unpriced. Then `<HoldingsTable holdings={…} collectionId={…} />` and `<AddItemDialog collectionId={…} />` (button "Add a card").

- [x] **HoldingsTable** (client): rows via `CardRow` (thumb, name, `setName · number · subtype · condition`), right side `formatMoney(value)` + `PriceDelta amount={value - cost}` when cost known, `×qty`. Row actions: qty stepper (− / +) calling `updateItemAction`, remove (with `confirm`). Test: renders rows with formatted money; clicking + calls the mocked action with quantity+1; unpriced row shows `—` and "no price" caption.

- [x] **AddItemDialog** (client): a `Button` "Add a card" opens a panel (no portal library — a fixed overlay `div` with `role="dialog" aria-modal`): `SearchField` (debounced 250ms fetch to `/api/search?q=`), results as `CardRow`s; selecting a card shows its printings as `Pill`s with price; then quantity (number input, default 1), condition `Pill`s (`CONDITIONS`), acquired price (optional), "Add to collection" → `addItemAction` → close + `router.refresh()`. Escape closes. Test with mocked `fetch` (returns one hit) and mocked action: type → results appear → pick printing → submit → action called with `{ printingId, quantity: 1, condition: "NM" }`.

Commit: `feat(collections): holdings page with valuation, add-item flow, search API`

---

### Task 6: Set browser

**Files:** `app/(app)/sets/page.tsx`, `app/(app)/sets/[id]/page.tsx`, `app/(app)/sets/[id]/SetGrid.tsx`, `tests/ui/set-grid.test.tsx`

- [x] **`/sets`** (server; `searchParams.game` default `pokemon`): `Pill` row of games (as `Link`s styled as pills — active = selected), then a list of `Panel`s per set (per `Sets.dc.html`): name, `ownedCards / totalCards`, `ProgressBar value={owned/total} tone={owned===total ? "gain" : owned>0 ? "accent" : "muted"}`, link to `/sets/[id]`. Sets with `totalCards === 0` (sealed-only groups) are listed last with "no singles".

- [x] **`/sets/[id]`** (server): `getSetDetail` (404 if null). Header: game · release date caption; `SectionHeading title={set.name}`; line "You own **x of n** · set value **$…** · your copies worth **$…**"; right: `ProgressBar` + "Missing cards cost $… to complete". Then `<SetGrid cards={…} collections={await listCollections(userId)} setId={…} />`.

- [x] **SetGrid** (client): filter `Pill`s All / Owned / Missing with counts; a "Add to:" `Pill` selector of the user's collections (default first; if none, show a link "Create a collection first"); the grid (`grid-cols-4 md:grid-cols-6 lg:grid-cols-8`) of `CardTile`s (`quantity = ownedQuantity`, `price = formatMoney(lowestMarket)`, subtitle = number) — tapping a tile calls `addItemAction(selectedCollection, { printingId: card.printings[0].printingId, quantity: 1, condition: "NM" })` and optimistically bumps the count; a small "Details" link under each tile to `/cards/[id]`. Test: filters change the visible set; tapping calls the action with the first printing and the selected collection.

Commit: `feat(sets): set browser with completion, tap-to-own grid`

---

### Task 7: Card detail + nav placeholders

**Files:** `app/(app)/cards/[id]/page.tsx`, `app/(app)/decks/page.tsx`, `app/(app)/alerts/page.tsx`, `tests/ui/card-page.test.tsx` (render with mocked data layer)

- [x] **`/cards/[id]`** (server), per `Card.dc.html`: left — art (`aspect-[5/7]` tile with `imageUrl`, `shadow-tile`), `AddItemDialog` preselected to this card (add a `preselectedCardId` prop — the dialog then skips search and shows printings directly); right — caption `game · set · number · rarity`, `SectionHeading as="h1"` name, `MoneyDisplay` for the first printing's market with `PriceDelta` 30D, a `Panel` "Printings" table (subtype, market, your copies), and a `Panel` "Price history — Phase 3" placeholder with the 30D change text. Back link to `/sets/[setId]`.

- [x] Placeholders: `/decks` and `/alerts` render `SectionHeading` + `EmptyState` ("Coming in Phase 4 / Phase 3").

Commit: `feat(cards): card detail page; decks/alerts placeholders`

---

### Task 8: Docs, plan bookkeeping, merge prep

- [x] README Status → Phase 2b complete (list screens); spec §7 unchanged; tick this plan's boxes and add a "Deviations" section like Phase 2a's.
- [x] Final whole-branch review → merge.

## Self-review notes

- Spec §7 coverage: catalog search ✔ (T5 route + dialog), set browser with owned-overlay ✔ (T6), collections CRUD + holdings + value/gain ✔ (T1, T4, T5), card detail ✔ (T7; chart deferred per §7/Phase 3). Share links, alerts, history charts deliberately absent (Phase 3).
- Type consistency: `Holding.value/cost` nullable everywhere; `AddItemInput` shared by data layer, action, dialog; `Condition` from `lib/collections`; `PrintingPrice` shared by search/set/card.
- Ownership: every read/write joins `collections.user_id`; actions re-check session; the search route checks session.

---

## Executed 2026-09-07 — deviations

Shipped on `phase-2b/collections-catalog-ui` across Tasks 1–8. Where the code differs from the plan
above:

- **Data layer hardening beyond the plan's Step 4 code.** `addItem` verifies the printing exists and
  clamps the merged quantity, `acquiredDate` is validated, and a `getCollection(userId, id)` helper
  was added so the detail page can tell "not yours" from "empty".
- **`SetGrid` props.** Dropped the planned `setId` and `gameSlug` props — the component never used
  them; it takes `cards` and `collections` only.
- **Optimistic state shape.** The tap-to-own bumps are stored as one `{ base, counts }` object
  rather than a bare `Record<cardId, number>`, so the local counts can be tied by identity to the
  `cards` array they were counted on (a lint rule forbids the `useEffect`-resets-state alternative).
  Comment in `SetGrid.tsx` covers the narrow known race.
- **Dialog results shape.** Same reason: `AddItemDialog` keeps search results as
  `{ query, cards }` so a stale page of hits is simply not rendered, instead of clearing state from
  the debounce effect.
- **Preselected card.** `AddItemDialog` takes `preselected: DialogCard` (the card, already loaded by
  the card detail page) rather than the planned `preselectedCardId` — no second query.
- **Release dates.** `/sets/[id]` renders `set.releaseDate.slice(0, 10)`: ingest stores full ISO
  timestamps, not `YYYY-MM-DD`. Normalizing at ingest is the real fix and is still open.
- **`Button` gained `href`.** With it the component renders a `next/link` in the button skin, so
  navigational actions (landing page, "Create a collection first") stop hand-rolling the classes.
- **`Input` primitive added.** The field classes were being copied into three forms; they now live in
  `components/ui/Input.tsx` (optional `label`).
- **Pills are 44px on phones** (`min-h-11 md:min-h-8`) — the mockups' 32px chip is too small for a
  thumb; it comes back from `md` up.
- **Server action id guards.** Every id crossing the action boundary (`id`, `collectionId`, `itemId`,
  `input.printingId`) goes through `assertId`, so a bad payload returns
  `{ ok: false, error: "Invalid id" }` instead of reaching SQL.
- **Cached detail loaders.** The three detail pages wrap their session + detail fetch in
  `cache()` from React, so `generateMetadata` and the page share one query per request.
- **Card-page headline price is the most valuable printing, not the first.** `/cards/[id]` picks
  the printing with the highest `market` (falling back to the first) as "the card" people mean, so
  a rarer high-value alt art doesn't get outranked by whichever printing happens to sort first.
- **`AddToCollection` component added.** A collection-picker was pulled out of the card detail page so
  adding a card to a collection from `/cards/[id]` doesn't hand-roll its own dialog logic.
- **`Pill` gained `href` too**, same reasoning as `Button` — navigational pills (the game filter row)
  render a `next/link` in the pill skin instead of copying classes onto an anchor.
- **`tests/ui/card-page.test.tsx` was replaced by `tests/ui/add-to-collection.test.tsx`** once the
  collection-picker moved into its own component — the coverage now lives with the component it tests.
- **Dialog focus trap added.** `AddItemDialog` (and the collection picker) trap Tab within the open
  panel and restore focus to the trigger on close, rather than leaking focus to the page behind it.
- **Pre-merge commit** (this one): `tailwind-merge` wired into `cn` so conflicting Tailwind classes
  resolve instead of concatenating, a shared `parseRouteId` for the three `[id]` routes, and
  `getCardDetail`'s 30-day lookups parallelized with `Promise.all`.

### Known items, deliberately left

- Release dates should be normalized to `YYYY-MM-DD` at ingest; the UI slices them for now.
- `ORDER BY ca.number` in `getSetDetail` is a text sort, so `10/131` sorts before `9/131` in sets
  whose numbers aren't zero-padded.
- `listSetsWithCompletion` runs two correlated subqueries per set and has not been benchmarked
  against a full Pokémon catalog.
