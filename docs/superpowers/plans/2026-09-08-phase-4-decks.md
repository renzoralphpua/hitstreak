# Hitstreak Phase 4 — Decks: Meta Browser, Gap Analysis, Validators, Builder, Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The deck layer: curated meta decks per game with gap analysis against the user's whole collection (owned / missing / cost to complete), per-game legality validators (Pokémon, One Piece, Riftbound), a personal deck builder, and an admin curation screen.

**Architecture:** Two tables (`decks`, `deck_cards`) join the self-initializing schema; `owner_user_id IS NULL` marks a curated meta deck (spec §5). Deck lines reference `cards` (not printings) in a `zone`. Each game has a **card identity key** — Pokémon and Riftbound by base name (reprints and alt arts are the same card), One Piece by card number (alt arts share `attrs.Number`) — used both for copy limits and for matching the user's collection in gap analysis. Validators are pure functions over `attrs` behind one contract (`validateDeck(input) → { valid, errors }`), one module per game, unit-tested per rule (spec §8, §10). Gap analysis is computed at read time (spec §5): the user's holdings across all binders are aggregated by identity key once per game and allocated to deck lines in order; missing lines are priced from the card's cheapest printing. A decklist text parser + catalog resolver (exact by name/number, fuzzy fallback with candidates) is shared by the admin screen (Task 8) and a local import CLI (Task 5), so curated decks can exist before the admin UI ships. Screens compose `components/ui/` primitives only; the browser and detail pages are Server Components with `?game=` links.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 tokens, libSQL, Better Auth session (`isAdmin` for curation), vitest + Testing Library.

**Reference:** Spec §5 (decks, deck_cards, gap analysis at read time), §7 (Decks, Admin), §8 (validation contract + per-game rules), §10 (validator tests are the heaviest unit tests), §11 steps 9–11. Mockups: `docs/design/Decks.dc.html` (meta list grouped by tier with own/complete bars; deck detail with three stat tiles, missing-cards table, full-list toggle), `docs/design/Builder.dc.html` (Task 7).

**Rules research (2026-09-08, verified against the local catalog's `attrs`):**
- **Pokémon** (pokemon.com deckbuilding guide; JustInBasil "Limits"): exactly 60 cards; at least one Basic Pokémon; max 4 copies per **name** (`ex`/`V`/`VMAX` are part of the name); **Basic Energy** exempt; max 1 ACE SPEC (rarity `ACE SPEC Rare` / `Rare Ace`); max 1 Radiant Pokémon (rarity `Radiant Rare`). Catalog: `Card Type` is the energy type for Pokémon (`Water`, `Psychic`, …, `Colorless`, `Dragon`), or `Supporter` / `Item` / `Stadium` / `Trainer` / `Trainer - Supporter` / `Trainer - Item` for trainers, `Basic Energy` / `Special Energy` / `Energy` for energy; `Stage` is `Basic` / `Stage 1` / `Stage 2` / `VMAX` / `VSTAR` / `Mega` / `Level Up` (or the trainer kind on older cards). **Regulation marks are NOT in the data**, so Standard-format legality is not validated (spec §8 amendment; a follow-up if a source appears).
- **One Piece** (Bandai comprehensive rules; optcg.one): exactly 1 Leader + exactly 50 main-deck cards; max 4 per **card number**; every main-deck card must share at least one colour with the Leader (multi-colour cards need one match, not all). Catalog: `CardType` ∈ `Leader` / `Character` / `Event` / `Stage`; `Color` is `;`-joined (`Green;Purple`); `Number` like `OP08-118` is shared by alt arts (2,229 duplicate numbers in the catalog — why identity is by number).
- **Riftbound** (Riot Core Rules §103 via riftwatcher.com; Tournament Rules): 1 Champion Legend (`Card Type` = `Legend`, its `Tag` is the champion, its `Domain` is the two-domain identity); 1 Chosen Champion (a `Champion Unit` whose `Tag` shares the Legend's champion tag) that is **one of the main deck's cards**; main deck **exactly 40** in constructed (Core Rules say "at least 40"; we validate constructed); max **3** copies per name across main deck + Chosen Champion; at most **3 Signature cards** total (`Card Type` starts with `Signature`), all tagged with the Legend's champion; every main-deck and rune card's domains must ALL be in the Legend's identity (`Domain` `;`-joined; `None`/missing = colourless, allowed); Rune deck exactly 12 (`Card Type` = `Rune`); exactly 3 Battlefields with distinct names (`Card Type` = `Battlefield`; colourless). Tokens (`Card Type` contains `Token`) are never deck cards.

**Conventions:** as Phase 3. `userId` first on every user-scoped function; meta decks are readable by any signed-in user, writable only when `"user".isAdmin = 1`; personal decks readable/writable by their owner only. Money stays `REAL` dollars. Tests use `tmpDb()` + `seedMiniCatalog()` (+ a new `seedDeckFixtures()` for Riftbound and deck-shaped cards). Component tests are `tests/ui/*.test.tsx` with `// @vitest-environment jsdom`. Verify each task with `npm test`, `npm run typecheck`, `npm run lint`; commit after each green task on branch `phase-4/decks`.

**Executed in runs:** Tasks 1–6 (2026-09-08), Task 7 (2026-09-08), Task 8 (2026-09-09), Task 9 (2026-09-09).

**Deferred (do NOT build here):** automated meta scraping, deck sharing, deck price history, wishlists, Phase 5 items (purchase tracking, sealed first-class, UX pass).

---

## File structure

```
lib/schema.ts                         + DECK_SCHEMA_SQL: decks, deck_cards
lib/db.ts                             runs DECK_SCHEMA_SQL too
lib/decks/types.ts                    GameSlug, Zone, ZONES, DeckCardInput, DeckInput, ValidationError, ValidationResult
lib/decks/identity.ts                 baseName, splitList, identityKey
lib/decks/rules/pokemon.ts            validatePokemon
lib/decks/rules/one-piece.ts          validateOnePiece
lib/decks/rules/riftbound.ts          validateRiftbound
lib/decks/validate.ts                 validateDeck (dispatch by game) + describeRules (ValidationList items)
lib/decks/data.ts                     listMetaDecks, listMyDecks, getDeck, createDeck, renameDeck, deleteDeck, saveDeckCards, upsertMetaDeck, isAdminUser
lib/decks/gap.ts                      loadOwnedByKey (db) + re-exports gap-math
lib/decks/gap-math.ts                 analyzeGap + GapLine/GapAnalysis (pure, db-free — the client bundle needs them)
lib/decks/zone.ts                     isSingleCardZone, defaultZone (pure)
lib/decks/resolve.ts                  resolveDecklist (db) + re-exports decklist
lib/decks/decklist.ts                 parseDecklist, formatDecklist, mergeResolved (pure, db-free)
scripts/import-deck.mts               local CLI: file → parse → resolve → upsertMetaDeck (reports unresolved lines)
tests/helpers/decks.ts                seedDeckFixtures(): riftbound game + deck-shaped cards for all three games; card() fixture builder
tests/decks-identity.test.ts, decks-data.test.ts, rules-pokemon.test.ts, rules-one-piece.test.ts, rules-riftbound.test.ts,
tests/decks-gap.test.ts, decks-resolve.test.ts
app/(app)/decks/page.tsx              meta browser: game pills, tier groups, own/complete bars
app/(app)/decks/DeckSummaryPanel.tsx  server component: one deck row (name, archetype, You own x/N, $ to complete, ProgressBar)
app/(app)/decks/[id]/page.tsx         deck detail: header, 3 stat tiles, legality, missing table, full list (<details>)
tests/ui/deck-summary-panel.test.tsx
--- later tasks ---
app/(app)/decks/mine/…                Task 7 builder
app/(app)/admin/decks/…               Task 8 curation
```

---

### Task 1: Schema, identity keys, decks data layer

**Files:** modify `lib/schema.ts`, `lib/db.ts`; create `lib/decks/types.ts`, `lib/decks/identity.ts`, `lib/decks/data.ts`, `tests/helpers/decks.ts`, `tests/decks-identity.test.ts`, `tests/decks-data.test.ts`

- [x] **Step 1: Schema.** Append to `lib/schema.ts` and run it from `lib/db.ts` after `HISTORY_SCHEMA_SQL`:

```ts
// Phase 4: decks. owner_user_id NULL = curated meta deck (spec §5); personal decks are scoped by owner
// in lib/decks/data.ts. Lines reference cards (not printings): ownership is matched by the per-game
// identity key in lib/decks/identity.ts.
export const DECK_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id),
    owner_user_id TEXT,                 -- NULL = meta deck
    name TEXT NOT NULL,
    archetype TEXT,
    tier INTEGER,                       -- 1..4, meta decks only
    format TEXT,                        -- e.g. 'standard' (Pokémon), 'constructed' (Riftbound)
    source_note TEXT,                   -- where the list came from (meta decks)
    is_draft INTEGER NOT NULL DEFAULT 0, -- personal decks saved with validation errors
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_decks_owner ON decks(owner_user_id);
  CREATE INDEX IF NOT EXISTS idx_decks_game ON decks(game_id);

  CREATE TABLE IF NOT EXISTS deck_cards (
    deck_id INTEGER NOT NULL REFERENCES decks(id),
    card_id INTEGER NOT NULL REFERENCES cards(id),
    zone TEXT NOT NULL,                 -- main | leader | legend | champion | rune | battlefield
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (deck_id, card_id, zone)
  );
`;
```

- [x] **Step 2: Types + identity** — `lib/decks/types.ts`:

```ts
// lib/decks/types.ts — the validator contract (spec §8) and the deck vocabulary shared by data, gap, UI.
export const GAME_SLUGS = ["pokemon", "one-piece", "riftbound"] as const;
export type GameSlug = (typeof GAME_SLUGS)[number];
export const isGameSlug = (s: unknown): s is GameSlug => typeof s === "string" && (GAME_SLUGS as readonly string[]).includes(s);

export type Zone = "main" | "leader" | "legend" | "champion" | "rune" | "battlefield";
/** Zones each game's decks use, in display order. */
export const ZONES: Record<GameSlug, readonly Zone[]> = {
  pokemon: ["main"],
  "one-piece": ["leader", "main"],
  riftbound: ["legend", "champion", "main", "rune", "battlefield"],
};
export const ZONE_LABEL: Record<Zone, string> = { main: "Main deck", leader: "Leader", legend: "Legend", champion: "Chosen champion", rune: "Runes", battlefield: "Battlefields" };

export interface DeckCardInput { cardId: number; name: string; zone: Zone; quantity: number; attrs: Record<string, string>; rarity: string | null }
export interface DeckInput { gameSlug: GameSlug; cards: DeckCardInput[] }
export interface ValidationError { code: string; message: string; cardId?: number }
export interface ValidationResult { valid: boolean; errors: ValidationError[] }
```

`lib/decks/identity.ts`:

```ts
// lib/decks/identity.ts
// "Same card" per game. tcgcsv names carry printing noise ("Rare Candy - 191/198", "Pikachu (Cosmos Holo)",
// "Loki (OP17-119) (Alternate Art)"); baseName strips it. Pokémon and Riftbound reprints/alt arts are the
// same card by name; One Piece alt arts share attrs.Number, so number is the identity there.
import type { GameSlug } from "./types";

/** Strips " - 123/456…" suffixes and trailing parentheticals, collapses whitespace. */
export function baseName(name: string): string {
  return name
    .replace(/\s+-\s+[A-Za-z]*\d+[A-Za-z]?\/\d+.*$/, "")   // " - 266/182", " - 191/193 (Cosmos Holo)"
    .replace(/(\s*\([^)]*\))+\s*$/, "")                    // "(Alternate Art)", "(Secret)", "(OP17-119) (Alt)"
    .replace(/\s+/g, " ")
    .trim();
}

/** `;`-joined attr lists (One Piece Color, Riftbound Domain/Tag) → trimmed items. */
export const splitList = (v: string | undefined | null): string[] =>
  (v ?? "").split(";").map((s) => s.trim()).filter(Boolean);

export function identityKey(game: GameSlug, card: { name: string; attrs: Record<string, string> }): string {
  if (game === "one-piece") {
    const n = card.attrs.Number?.trim();
    if (n) return `num:${n.toUpperCase()}`;
  }
  return `name:${baseName(card.name).toLowerCase()}`;
}
```

- [x] **Step 3: Failing tests.** `tests/decks-identity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { baseName, splitList, identityKey } from "@/lib/decks/identity";

describe("baseName", () => {
  it("strips printing suffixes and parentheticals", () => {
    expect(baseName("Rare Candy - 191/198")).toBe("Rare Candy");
    expect(baseName("Reversal Energy - 266/182")).toBe("Reversal Energy");
    expect(baseName("Double Turbo Energy - 151/172 (Cosmos Holo)")).toBe("Double Turbo Energy");
    expect(baseName("Double Turbo Energy (Secret)")).toBe("Double Turbo Energy");
    expect(baseName("Loki (OP17-119) (Alternate Art)")).toBe("Loki");
    expect(baseName("Akali, Deadly Weapon (Alternate Art)")).toBe("Akali, Deadly Weapon");
    expect(baseName("Charizard ex")).toBe("Charizard ex");
    expect(baseName("Monkey.D.Luffy")).toBe("Monkey.D.Luffy");
  });
});
describe("splitList", () => {
  it("splits ;-joined attrs", () => {
    expect(splitList("Green;Purple")).toEqual(["Green", "Purple"]);
    expect(splitList(" Fury ; Body ")).toEqual(["Fury", "Body"]);
    expect(splitList(undefined)).toEqual([]);
  });
});
describe("identityKey", () => {
  it("is by base name for Pokémon and Riftbound, by number for One Piece", () => {
    expect(identityKey("pokemon", { name: "Rare Candy - 191/198", attrs: {} })).toBe("name:rare candy");
    expect(identityKey("pokemon", { name: "Rare Candy", attrs: { Number: "191/198" } })).toBe("name:rare candy");
    expect(identityKey("riftbound", { name: "Akali, Deadly Weapon (Alternate Art)", attrs: {} })).toBe("name:akali, deadly weapon");
    expect(identityKey("one-piece", { name: "Loki (OP17-119) (Alternate Art)", attrs: { Number: "OP17-119" } })).toBe("num:OP17-119");
    expect(identityKey("one-piece", { name: "Nami", attrs: {} })).toBe("name:nami"); // no number → name fallback
  });
});
```

`tests/helpers/decks.ts` (used by data/gap/resolve tests; validators use in-memory fixtures from the same `card()` builder):

```ts
// tests/helpers/decks.ts — deck-shaped catalog rows on top of seedMiniCatalog(): a Riftbound game and a
// handful of cards per game with the attrs the validators read. Returns ids by nickname.
import { db } from "@/lib/db";
import type { DeckCardInput, Zone } from "@/lib/decks/types";

/** In-memory validator fixture. */
export const card = (over: Partial<DeckCardInput> & { name: string }): DeckCardInput => ({
  cardId: 0, zone: "main" as Zone, quantity: 1, attrs: {}, rarity: null, ...over,
});

export async function seedDeckFixtures() {
  const c = await db();
  await c.batch(
    [
      { sql: "INSERT INTO games (tcgplayer_category_id, name, slug) VALUES (89, 'Riftbound', 'riftbound')", args: [] },
      { sql: "INSERT INTO sets (game_id, tcgplayer_group_id, name, code, release_date) VALUES (3, 950, 'Origins', 'OGN', '2025-10-31'), (1, 605, 'Obsidian Flames', 'OBF', '2023-08-11')", args: [] },
      { sql: `INSERT INTO cards (set_id, tcgplayer_product_id, name, number, rarity, image_url, attrs) VALUES
        (4, 3001, 'Charizard ex', '125/197', 'Double Rare', NULL, '{"Card Type":"Fire","HP":"330","Stage":"Stage 2"}'),
        (4, 3002, 'Rare Candy', '191/197', 'Uncommon', NULL, '{"Card Type":"Trainer - Item"}'),
        (1, 3003, 'Rare Candy - 191/198', '191/198', 'Uncommon', NULL, '{"Card Type":"Item"}'),
        (4, 3004, 'Basic Fire Energy', '230/197', 'Common', NULL, '{"Card Type":"Basic Energy"}'),
        (2, 3005, 'Nami', 'OP01-016', 'R', NULL, '{"CardType":"Character","Color":"Blue","Number":"OP01-016","Cost":"1"}'),
        (2, 3006, 'Nami (Alternate Art)', 'OP01-016', 'SR', NULL, '{"CardType":"Character","Color":"Blue","Number":"OP01-016","Cost":"1"}'),
        (2, 3007, 'Monkey.D.Luffy', 'OP01-003', 'L', NULL, '{"CardType":"Leader","Color":"Red;Green","Number":"OP01-003","Life":"5"}'),
        (3, 3008, 'Renekton, Butcher of the Sands', '141/166', 'Rare', NULL, '{"Card Type":"Legend","Tag":"Renekton","Domain":"Fury;Body"}'),
        (3, 3009, 'Renekton, Rampager', '142/166', 'Rare', NULL, '{"Card Type":"Champion Unit","Tag":"Renekton;Shurima","Domain":"Fury","Energy Cost":"4","Might":"5"}'),
        (3, 3010, 'Body Rune', 'R04', 'Common', NULL, '{"Card Type":"Rune","Domain":"Body"}'),
        (3, 3011, 'Heisho, Shell of the World', '158/166', 'Uncommon', NULL, '{"Card Type":"Battlefield"}')`, args: [] },
      { sql: `INSERT INTO printings (card_id, subtype) VALUES (5,'Holofoil'),(6,'Normal'),(7,'Normal'),(8,'Normal'),(9,'Normal'),(10,'Normal'),(11,'Normal'),(12,'Normal'),(13,'Normal'),(14,'Normal'),(15,'Normal')`, args: [] },
      { sql: `INSERT INTO latest_prices (printing_id, date, market) VALUES (6,'2026-09-07',18.90),(7,'2026-09-07',1.60),(8,'2026-09-07',0.80),(9,'2026-09-07',0.10),(10,'2026-09-07',2.50),(11,'2026-09-07',40.00),(12,'2026-09-07',3.00),(13,'2026-09-07',12.00),(14,'2026-09-07',9.00),(15,'2026-09-07',0.50),(16,'2026-09-07',1.20)`, args: [] },
    ],
    "write"
  );
  return {
    games: { riftbound: 3 },
    sets: { obsidian: 4, origins: 3 },
    cards: { charizardEx: 5, rareCandyObf: 6, rareCandySvi: 7, fireEnergy: 8, nami: 9, namiAlt: 10, luffyLeader: 11, renektonLegend: 12, renektonChampion: 13, bodyRune: 14, heisho: 15 },
  };
}
```

(Card/printing ids continue from `seedMiniCatalog`'s 4 cards / 5 printings; `seedMiniCatalog()` must be called first. Verify the ids by querying in the test's `beforeAll` if they drift — but keep the helper's returned map as the single source.)

`tests/decks-data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("decks-data");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { seedDeckFixtures } from "./helpers/decks";
import { listMetaDecks, listMyDecks, getDeck, createDeck, renameDeck, deleteDeck, saveDeckCards, upsertMetaDeck, isAdminUser } from "@/lib/decks/data";

let f: Awaited<ReturnType<typeof seedDeckFixtures>>;
const ADMIN = "admin_1", U1 = "user_1", U2 = "user_2";
beforeAll(async () => {
  await seedMiniCatalog();
  f = await seedDeckFixtures();
  const c = await db();
  await c.execute({ sql: `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, isAdmin) VALUES (?, 'Admin', 'admin@example.com', 0, '2026-09-01', '2026-09-01', 1), (?, 'U1', 'u1@example.com', 0, '2026-09-01', '2026-09-01', 0)`, args: [ADMIN, U1] });
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("meta decks", () => {
  it("only an admin can create or replace a meta deck", async () => {
    expect(await isAdminUser(ADMIN)).toBe(true);
    expect(await isAdminUser(U1)).toBe(false);
    await expect(upsertMetaDeck(U1, { gameSlug: "pokemon", name: "Zard", lines: [] })).rejects.toThrow(/admin/i);
    const id = await upsertMetaDeck(ADMIN, {
      gameSlug: "pokemon", name: "Charizard ex / Pidgeot", archetype: "Charizard ex", tier: 1, format: "standard", sourceNote: "Regional top cuts, Aug 30",
      lines: [{ cardId: f.cards.charizardEx, zone: "main", quantity: 3 }, { cardId: f.cards.rareCandyObf, zone: "main", quantity: 4 }],
    });
    const list = await listMetaDecks("pokemon");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: "Charizard ex / Pidgeot", tier: 1, isMeta: true, isDraft: false, cardCount: 7, gameSlug: "pokemon" });
    expect(await listMetaDecks("one-piece")).toEqual([]);
    // replace by id: lines are swapped wholesale
    await upsertMetaDeck(ADMIN, { id, gameSlug: "pokemon", name: "Charizard ex / Pidgeot", tier: 2, lines: [{ cardId: f.cards.charizardEx, zone: "main", quantity: 2 }] });
    const d = await getDeck(id, U1);
    expect(d?.tier).toBe(2);
    expect(d?.cards.map((l) => [l.cardId, l.quantity])).toEqual([[f.cards.charizardEx, 2]]);
    expect(d?.cards[0]).toMatchObject({ name: "Charizard ex", setName: "Obsidian Flames", number: "125/197", market: 18.9, attrs: { "Card Type": "Fire" } });
  });
  it("rejects lines whose card is from another game, an unknown card, or a bad zone/quantity", async () => {
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", lines: [{ cardId: f.cards.nami, zone: "main", quantity: 1 }] })).rejects.toThrow(/game/i);
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", lines: [{ cardId: 99999, zone: "main", quantity: 1 }] })).rejects.toThrow(/card/i);
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", lines: [{ cardId: f.cards.charizardEx, zone: "rune", quantity: 1 }] })).rejects.toThrow(/zone/i);
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "x", lines: [{ cardId: f.cards.charizardEx, zone: "main", quantity: 0 }] })).rejects.toThrow(/quantity/i);
    await expect(upsertMetaDeck(ADMIN, { gameSlug: "pokemon", name: "  ", lines: [] })).rejects.toThrow(/name/i);
  });
});

describe("personal decks", () => {
  it("are scoped to their owner; meta decks are visible to everyone signed in", async () => {
    const id = await createDeck(U1, { gameSlug: "one-piece", name: "Blue Nami" });
    await saveDeckCards(U1, id, [{ cardId: f.cards.luffyLeader, zone: "leader", quantity: 1 }, { cardId: f.cards.nami, zone: "main", quantity: 4 }], true);
    expect((await listMyDecks(U1)).map((d) => [d.id, d.isDraft, d.cardCount])).toEqual([[id, true, 5]]);
    expect(await listMyDecks(U2)).toEqual([]);
    expect(await getDeck(id, U2)).toBeNull();
    expect((await getDeck(id, U1))?.cards).toHaveLength(2);
    const meta = (await listMetaDecks("pokemon"))[0];
    expect(await getDeck(meta.id, U2)).not.toBeNull();
    expect(await getDeck(meta.id, null)).not.toBeNull(); // meta decks need no user
    expect(await getDeck(id, null)).toBeNull();
  });
  it("owner-only writes", async () => {
    const id = (await listMyDecks(U1))[0].id;
    expect(await renameDeck(U2, id, "hijack")).toBe(false);
    expect(await renameDeck(U1, id, "Nami Blue")).toBe(true);
    await expect(saveDeckCards(U2, id, [], false)).rejects.toThrow(/not found/i);
    expect(await deleteDeck(U2, id)).toBe(false);
    expect(await deleteDeck(U1, id)).toBe(true);
    expect(await getDeck(id, U1)).toBeNull();
    expect((await (await db()).execute({ sql: "SELECT COUNT(*) AS n FROM deck_cards WHERE deck_id = ?", args: [id] })).rows[0].n).toBe(0);
  });
  it("a user cannot write a meta deck through the personal path", async () => {
    const meta = (await listMetaDecks("pokemon"))[0];
    expect(await renameDeck(U1, meta.id, "x")).toBe(false);
    await expect(saveDeckCards(U1, meta.id, [], false)).rejects.toThrow(/not found/i);
    expect(await deleteDeck(ADMIN, meta.id)).toBe(false); // meta decks are not deleted through the personal path either
  });
});
```

- [x] **Step 4: Implement `lib/decks/data.ts`:**

```ts
// lib/decks/data.ts
// Decks. Meta decks (owner_user_id IS NULL) are readable by any signed-in user and written only by
// admins (upsertMetaDeck); personal decks are scoped to their owner on every read and write.
import { db } from "@/lib/db";
import { type GameSlug, type Zone, ZONES, isGameSlug } from "./types";

export interface DeckSummary {
  id: number; gameSlug: GameSlug; gameName: string; name: string; archetype: string | null; tier: number | null;
  format: string | null; sourceNote: string | null; isMeta: boolean; isDraft: boolean; updatedAt: string; cardCount: number;
}
export interface DeckLine {
  cardId: number; zone: Zone; quantity: number; name: string; setName: string; number: string | null; rarity: string | null;
  imageUrl: string | null; attrs: Record<string, string>; market: number | null; // cheapest printing's market
}
export interface DeckDetail extends DeckSummary { cards: DeckLine[] }
export interface DeckLineInput { cardId: number; zone: Zone; quantity: number }

const NAME_MAX = 80;
const QTY_MAX = 99;
function cleanName(name: string): string {
  const n = name.trim();
  if (n.length === 0 || n.length > NAME_MAX) throw new Error(`Deck name must be 1–${NAME_MAX} characters`);
  return n;
}

const SUMMARY_SQL = `SELECT d.id, d.name, d.archetype, d.tier, d.format, d.source_note, d.owner_user_id, d.is_draft, d.updated_at,
                            g.slug AS game_slug, g.name AS game_name,
                            COALESCE((SELECT SUM(dc.quantity) FROM deck_cards dc WHERE dc.deck_id = d.id), 0) AS card_count
                     FROM decks d JOIN games g ON g.id = d.game_id`;
const toSummary = (x: Record<string, unknown>): DeckSummary => ({
  id: Number(x.id), gameSlug: String(x.game_slug) as GameSlug, gameName: String(x.game_name), name: String(x.name),
  archetype: x.archetype == null ? null : String(x.archetype), tier: x.tier == null ? null : Number(x.tier),
  format: x.format == null ? null : String(x.format), sourceNote: x.source_note == null ? null : String(x.source_note),
  isMeta: x.owner_user_id == null, isDraft: Number(x.is_draft) === 1, updatedAt: String(x.updated_at), cardCount: Number(x.card_count),
});

export async function isAdminUser(userId: string): Promise<boolean> {
  const c = await db();
  const r = await c.execute({ sql: `SELECT "isAdmin" FROM "user" WHERE id = ?`, args: [userId] });
  return r.rows.length === 1 && Number(r.rows[0].isAdmin) === 1;
}

/** Curated decks for one game: tier 1 first, untiered last, then name. */
export async function listMetaDecks(gameSlug: GameSlug): Promise<DeckSummary[]> {
  const c = await db();
  const r = await c.execute({ sql: `${SUMMARY_SQL} WHERE d.owner_user_id IS NULL AND g.slug = ? ORDER BY d.tier IS NULL, d.tier, d.name`, args: [gameSlug] });
  return r.rows.map(toSummary);
}

export async function listMyDecks(userId: string): Promise<DeckSummary[]> {
  const c = await db();
  const r = await c.execute({ sql: `${SUMMARY_SQL} WHERE d.owner_user_id = ? ORDER BY d.updated_at DESC, d.id DESC`, args: [userId] });
  return r.rows.map(toSummary);
}

/** A meta deck (any caller, `userId` may be null) or the caller's own deck; null otherwise. */
export async function getDeck(id: number, userId: string | null): Promise<DeckDetail | null> {
  const c = await db();
  const d = (await c.execute({ sql: `${SUMMARY_SQL} WHERE d.id = ? AND (d.owner_user_id IS NULL OR d.owner_user_id = ?)`, args: [id, userId] })).rows[0];
  if (!d) return null;
  const rows = (await c.execute({
    sql: `SELECT dc.card_id, dc.zone, dc.quantity, ca.name, ca.number, ca.rarity, ca.image_url, ca.attrs, se.name AS set_name,
                 (SELECT MIN(lp.market) FROM printings p JOIN latest_prices lp ON lp.printing_id = p.id WHERE p.card_id = ca.id AND lp.market IS NOT NULL) AS market
          FROM deck_cards dc JOIN cards ca ON ca.id = dc.card_id JOIN sets se ON se.id = ca.set_id
          WHERE dc.deck_id = ? ORDER BY dc.zone, ca.name, dc.card_id`,
    args: [id],
  })).rows;
  const summary = toSummary(d);
  const order = ZONES[summary.gameSlug];
  const cards: DeckLine[] = rows.map((x) => {
    let attrs: Record<string, string> = {};
    try { attrs = JSON.parse(String(x.attrs ?? "{}")); } catch { /* keep {} */ }
    return {
      cardId: Number(x.card_id), zone: String(x.zone) as Zone, quantity: Number(x.quantity), name: String(x.name), setName: String(x.set_name),
      number: x.number == null ? null : String(x.number), rarity: x.rarity == null ? null : String(x.rarity),
      imageUrl: x.image_url == null ? null : String(x.image_url), attrs, market: x.market == null ? null : Number(x.market),
    };
  }).sort((a, b) => order.indexOf(a.zone) - order.indexOf(b.zone) || a.name.localeCompare(b.name));
  return { ...summary, cards };
}

async function gameIdFor(slug: string): Promise<number> {
  if (!isGameSlug(slug)) throw new Error("Unknown game");
  const c = await db();
  const r = await c.execute({ sql: "SELECT id FROM games WHERE slug = ?", args: [slug] });
  if (r.rows.length === 0) throw new Error("Unknown game");
  return Number(r.rows[0].id);
}

/** Every line's card must exist, belong to the deck's game, use one of the game's zones, and carry a sane quantity. */
async function checkLines(gameSlug: GameSlug, gameId: number, lines: DeckLineInput[]): Promise<void> {
  const zones = ZONES[gameSlug] as readonly string[];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0 || l.quantity > QTY_MAX) throw new Error(`Quantity must be a whole number from 1 to ${QTY_MAX}`);
    if (!zones.includes(l.zone)) throw new Error(`Zone "${l.zone}" is not used by this game`);
    const k = `${l.cardId}|${l.zone}`;
    if (seen.has(k)) throw new Error("A card appears twice in the same zone");
    seen.add(k);
  }
  if (lines.length === 0) return;
  const c = await db();
  const ids = [...new Set(lines.map((l) => l.cardId))];
  const r = await c.execute({ sql: `SELECT ca.id, se.game_id FROM cards ca JOIN sets se ON se.id = ca.set_id WHERE ca.id IN (${ids.map(() => "?").join(",")})`, args: ids });
  const byId = new Map(r.rows.map((x) => [Number(x.id), Number(x.game_id)]));
  for (const id of ids) {
    const g = byId.get(id);
    if (g === undefined) throw new Error("Card not found");
    if (g !== gameId) throw new Error("Card belongs to another game");
  }
}

async function replaceLines(deckId: number, lines: DeckLineInput[]): Promise<void> {
  const c = await db();
  await c.batch(
    [
      { sql: "DELETE FROM deck_cards WHERE deck_id = ?", args: [deckId] },
      ...lines.map((l) => ({ sql: "INSERT INTO deck_cards (deck_id, card_id, zone, quantity) VALUES (?, ?, ?, ?)", args: [deckId, l.cardId, l.zone, l.quantity] })),
      { sql: "UPDATE decks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", args: [deckId] },
    ],
    "write"
  );
}

export interface MetaDeckInput { id?: number; gameSlug: GameSlug; name: string; archetype?: string | null; tier?: number | null; format?: string | null; sourceNote?: string | null; lines: DeckLineInput[] }

/** Admin only. Creates a meta deck, or replaces name/metadata/lines of an existing one (by id). */
export async function upsertMetaDeck(adminUserId: string, input: MetaDeckInput): Promise<number> {
  if (!(await isAdminUser(adminUserId))) throw new Error("Only an admin can curate meta decks");
  const name = cleanName(input.name);
  if (input.tier != null && (!Number.isInteger(input.tier) || input.tier < 1 || input.tier > 4)) throw new Error("Tier must be 1–4");
  const gameId = await gameIdFor(input.gameSlug);
  await checkLines(input.gameSlug, gameId, input.lines);
  const c = await db();
  let id = input.id;
  if (id != null) {
    const r = await c.execute({
      sql: "UPDATE decks SET name = ?, archetype = ?, tier = ?, format = ?, source_note = ? WHERE id = ? AND owner_user_id IS NULL AND game_id = ?",
      args: [name, input.archetype ?? null, input.tier ?? null, input.format ?? null, input.sourceNote ?? null, id, gameId],
    });
    if (r.rowsAffected !== 1) throw new Error("Meta deck not found");
  } else {
    const r = await c.execute({
      sql: "INSERT INTO decks (game_id, owner_user_id, name, archetype, tier, format, source_note) VALUES (?, NULL, ?, ?, ?, ?, ?) RETURNING id",
      args: [gameId, name, input.archetype ?? null, input.tier ?? null, input.format ?? null, input.sourceNote ?? null],
    });
    id = Number(r.rows[0].id);
  }
  await replaceLines(id, input.lines);
  return id;
}

export async function createDeck(userId: string, input: { gameSlug: GameSlug; name: string }): Promise<number> {
  const gameId = await gameIdFor(input.gameSlug);
  const c = await db();
  const r = await c.execute({ sql: "INSERT INTO decks (game_id, owner_user_id, name, is_draft) VALUES (?, ?, ?, 1) RETURNING id", args: [gameId, userId, cleanName(input.name)] });
  return Number(r.rows[0].id);
}

export async function renameDeck(userId: string, id: number, name: string): Promise<boolean> {
  const c = await db();
  const r = await c.execute({ sql: "UPDATE decks SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND owner_user_id = ?", args: [cleanName(name), id, userId] });
  return r.rowsAffected === 1;
}

/** Replaces the owner's deck lines wholesale; `isDraft` is what the caller's validation said. */
export async function saveDeckCards(userId: string, id: number, lines: DeckLineInput[], isDraft: boolean): Promise<void> {
  const c = await db();
  const d = (await c.execute({ sql: "SELECT d.game_id, g.slug FROM decks d JOIN games g ON g.id = d.game_id WHERE d.id = ? AND d.owner_user_id = ?", args: [id, userId] })).rows[0];
  if (!d) throw new Error("Deck not found");
  await checkLines(String(d.slug) as GameSlug, Number(d.game_id), lines);
  await replaceLines(id, lines);
  await c.execute({ sql: "UPDATE decks SET is_draft = ? WHERE id = ?", args: [isDraft ? 1 : 0, id] });
}

export async function deleteDeck(userId: string, id: number): Promise<boolean> {
  const c = await db();
  const own = await c.execute({ sql: "SELECT 1 FROM decks WHERE id = ? AND owner_user_id = ?", args: [id, userId] });
  if (own.rows.length === 0) return false;
  await c.batch([{ sql: "DELETE FROM deck_cards WHERE deck_id = ?", args: [id] }, { sql: "DELETE FROM decks WHERE id = ? AND owner_user_id = ?", args: [id, userId] }], "write");
  return true;
}
```

- [x] **Step 5:** tests, typecheck, lint green. **Commit** — `feat(decks): decks/deck_cards schema, identity keys, decks data layer (meta + personal)`

---

### Task 2: Validator contract + Pokémon rules

**Files:** create `lib/decks/validate.ts`, `lib/decks/rules/pokemon.ts`, `tests/rules-pokemon.test.ts`

- [x] **Step 1: Failing tests** — `tests/rules-pokemon.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateDeck } from "@/lib/decks/validate";
import { card } from "./helpers/decks";

const poke = (name: string, over: Record<string, unknown> = {}) => card({ name, attrs: { "Card Type": "Fire", HP: "120", Stage: "Basic" }, ...over });
const trainer = (name: string, over: Record<string, unknown> = {}) => card({ name, attrs: { "Card Type": "Trainer - Item" }, ...over });
const energy = (name = "Basic Fire Energy", over: Record<string, unknown> = {}) => card({ name, attrs: { "Card Type": "Basic Energy" }, ...over });
/** A legal 60: 4 Charmander, 4 Charizard ex (Stage 2), 4 Rare Candy, 48 basic energy. */
const legal = () => [
  poke("Charmander", { cardId: 1, quantity: 4 }),
  poke("Charizard ex", { cardId: 2, quantity: 4, attrs: { "Card Type": "Fire", HP: "330", Stage: "Stage 2" } }),
  trainer("Rare Candy", { cardId: 3, quantity: 4 }),
  energy("Basic Fire Energy", { cardId: 4, quantity: 48 }),
];
const codes = (cards: ReturnType<typeof card>[]) => validateDeck({ gameSlug: "pokemon", cards }).errors.map((e) => e.code);

describe("Pokémon deck rules", () => {
  it("accepts a legal 60-card deck", () => {
    expect(validateDeck({ gameSlug: "pokemon", cards: legal() })).toEqual({ valid: true, errors: [] });
  });
  it("requires exactly 60 cards", () => {
    const d = legal(); d[3].quantity = 47;
    expect(codes(d)).toEqual(["size"]);
    d[3].quantity = 49;
    expect(codes(d)).toEqual(["size"]);
    expect(validateDeck({ gameSlug: "pokemon", cards: d }).errors[0].message).toMatch(/61/);
  });
  it("requires at least one Basic Pokémon (trainers and fossils don't count)", () => {
    const d = [trainer("Rare Candy", { cardId: 3, quantity: 4 }), energy("Basic Fire Energy", { cardId: 4, quantity: 56 })];
    expect(codes(d)).toEqual(["no-basic"]);
    const fossil = card({ name: "Antique Armor Fossil", cardId: 9, quantity: 4, attrs: { "Card Type": "Trainer - Item", HP: "60" } });
    expect(codes([fossil, energy("Basic Fire Energy", { cardId: 4, quantity: 56 })])).toEqual(["no-basic"]);
  });
  it("limits any name to 4 copies, counting reprints by base name, except Basic Energy", () => {
    const d = legal();
    d.push(trainer("Rare Candy - 191/198", { cardId: 33, quantity: 1 }));
    d[3].quantity = 47;
    const r = validateDeck({ gameSlug: "pokemon", cards: d });
    expect(r.errors.map((e) => e.code)).toEqual(["copies"]);
    expect(r.errors[0].message).toMatch(/Rare Candy/);
    expect(r.errors[0].cardId).toBe(3);
    // 48 basic energy is fine (above); legacy "Energy" card type with a basic energy name is exempt too
    const legacy = legal(); legacy[3] = card({ name: "Fire Energy", cardId: 4, quantity: 48, attrs: { "Card Type": "Energy" } });
    expect(codes(legacy)).toEqual([]);
    // Special energy is NOT exempt
    const special = legal(); special[3].quantity = 43; special.push(card({ name: "Double Turbo Energy", cardId: 5, quantity: 5, attrs: { "Card Type": "Special Energy" } }));
    expect(codes(special)).toEqual(["copies"]);
  });
  it("treats ex / V / VMAX as different names", () => {
    const d = legal(); d[3].quantity = 44;
    d.push(poke("Charizard", { cardId: 6, quantity: 4, attrs: { "Card Type": "Fire", HP: "150", Stage: "Stage 2" } }));
    expect(codes(d)).toEqual([]);
  });
  it("allows one ACE SPEC and one Radiant Pokémon", () => {
    const d = legal(); d[3].quantity = 46;
    d.push(trainer("Prime Catcher", { cardId: 7, quantity: 2, rarity: "ACE SPEC Rare" }));
    expect(codes(d)).toEqual(["ace-spec"]);
    d[4].quantity = 1; d.push(trainer("Max Rod", { cardId: 8, quantity: 1, rarity: "Rare Ace" }));
    expect(codes(d)).toEqual(["ace-spec"]); // two different ACE SPECs is still two
    const e = legal(); e[3].quantity = 46;
    e.push(poke("Radiant Charizard", { cardId: 10, quantity: 2, rarity: "Radiant Rare" }));
    expect(codes(e)).toEqual(["radiant"]);
  });
  it("rejects cards in zones Pokémon does not use", () => {
    const d = legal(); d[3].quantity = 47; d.push(card({ name: "Body Rune", cardId: 11, zone: "rune", quantity: 1 }));
    expect(codes(d)).toEqual(["zone"]);
  });
  it("reports every problem at once", () => {
    const d = [poke("Charmander", { cardId: 1, quantity: 5 })];
    expect(codes(d).sort()).toEqual(["copies", "size"]);
  });
});
```

- [x] **Step 2: Implement.** `lib/decks/validate.ts`:

```ts
// lib/decks/validate.ts — spec §8: one contract, one module per game, pure functions over attrs.
import type { DeckInput, ValidationResult, GameSlug } from "./types";
import { validatePokemon } from "./rules/pokemon";
import { validateOnePiece } from "./rules/one-piece";
import { validateRiftbound } from "./rules/riftbound";

const RULES: Record<GameSlug, (input: DeckInput) => ValidationResult> = { pokemon: validatePokemon, "one-piece": validateOnePiece, riftbound: validateRiftbound };

export function validateDeck(input: DeckInput): ValidationResult {
  const r = RULES[input.gameSlug](input);
  return { valid: r.errors.length === 0, errors: r.errors };
}

/** Human-readable rule list per game, for ValidationList: each rule is ok unless an error with its code exists. */
export const RULE_TEXT: Record<GameSlug, Array<{ code: string; text: string }>> = {
  pokemon: [
    { code: "size", text: "Exactly 60 cards" }, { code: "no-basic", text: "At least one Basic Pokémon" },
    { code: "copies", text: "No more than 4 of a card (Basic Energy excepted)" }, { code: "ace-spec", text: "At most one ACE SPEC" },
    { code: "radiant", text: "At most one Radiant Pokémon" }, { code: "zone", text: "Only main-deck cards" },
  ],
  "one-piece": [
    { code: "leader", text: "Exactly one Leader" }, { code: "size", text: "Exactly 50 cards in the main deck" },
    { code: "copies", text: "No more than 4 of a card number" }, { code: "color", text: "Every card shares a colour with the Leader" },
    { code: "zone", text: "Leaders only in the Leader slot" },
  ],
  riftbound: [
    { code: "legend", text: "Exactly one Legend" }, { code: "champion", text: "One Chosen Champion matching the Legend" },
    { code: "size", text: "Exactly 40 main-deck cards including the Chosen Champion" }, { code: "copies", text: "No more than 3 of a card" },
    { code: "signature", text: "At most 3 Signature cards, all for your Legend" }, { code: "domain", text: "Every card within the Legend's domains" },
    { code: "rune", text: "Exactly 12 runes in your domains" }, { code: "battlefield", text: "Exactly 3 different Battlefields" }, { code: "zone", text: "Only units, spells and gear in the main deck" },
  ],
};
export function describeRules(input: DeckInput): Array<{ ok: boolean; text: string }> {
  const failed = new Set(validateDeck(input).errors.map((e) => e.code));
  return RULE_TEXT[input.gameSlug].map((r) => ({ ok: !failed.has(r.code), text: r.text }));
}
```

(The One Piece and Riftbound imports fail to resolve until Tasks 3–4 — create those two files now as stubs that return `{ valid: true, errors: [] }` with a `// Task 3 / Task 4` comment, so this task typechecks; the later tasks replace them.)

`lib/decks/rules/pokemon.ts`:

```ts
// lib/decks/rules/pokemon.ts — exactly 60; ≥1 Basic Pokémon; ≤4 per base name (Basic Energy exempt);
// ≤1 ACE SPEC; ≤1 Radiant. Standard-format (regulation mark) legality is NOT checked: tcgcsv carries no marks.
import type { DeckInput, DeckCardInput, ValidationError, ValidationResult } from "../types";
import { baseName } from "../identity";

const POKEMON_TYPES = new Set(["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Fairy", "Dragon", "Colorless"]);
const BASIC_ENERGY_NAME = /^(Basic )?(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/i;
const DECK_SIZE = 60, MAX_COPIES = 4;

export const isPokemon = (c: DeckCardInput) => POKEMON_TYPES.has(c.attrs["Card Type"] ?? "");
export const isBasicPokemon = (c: DeckCardInput) => isPokemon(c) && (c.attrs.Stage ?? "") === "Basic";
export const isBasicEnergy = (c: DeckCardInput) => {
  const t = c.attrs["Card Type"] ?? "";
  return t === "Basic Energy" || (t === "Energy" && BASIC_ENERGY_NAME.test(baseName(c.name)));
};
const isAceSpec = (c: DeckCardInput) => /ace spec|rare ace/i.test(c.rarity ?? "");
const isRadiant = (c: DeckCardInput) => /radiant/i.test(c.rarity ?? "");

export function validatePokemon({ cards }: DeckInput): ValidationResult {
  const errors: ValidationError[] = [];
  const main = cards.filter((c) => c.zone === "main");
  for (const c of cards) if (c.zone !== "main") errors.push({ code: "zone", message: `${baseName(c.name)} is in a zone Pokémon decks don't use (${c.zone})`, cardId: c.cardId });

  const total = main.reduce((n, c) => n + c.quantity, 0);
  if (total !== DECK_SIZE) errors.push({ code: "size", message: `A deck must have exactly ${DECK_SIZE} cards (this one has ${total})` });
  if (!main.some(isBasicPokemon)) errors.push({ code: "no-basic", message: "A deck needs at least one Basic Pokémon" });

  const byName = new Map<string, { n: number; cardId: number; name: string }>();
  for (const c of main) {
    if (isBasicEnergy(c)) continue;
    const key = baseName(c.name).toLowerCase();
    const e = byName.get(key) ?? { n: 0, cardId: c.cardId, name: baseName(c.name) };
    e.n += c.quantity;
    byName.set(key, e);
  }
  for (const e of byName.values()) if (e.n > MAX_COPIES) errors.push({ code: "copies", message: `${e.name}: ${e.n} copies (max ${MAX_COPIES})`, cardId: e.cardId });

  const aces = main.filter(isAceSpec).reduce((n, c) => n + c.quantity, 0);
  if (aces > 1) errors.push({ code: "ace-spec", message: `${aces} ACE SPEC cards (max 1)` });
  const radiants = main.filter(isRadiant).reduce((n, c) => n + c.quantity, 0);
  if (radiants > 1) errors.push({ code: "radiant", message: `${radiants} Radiant Pokémon (max 1)` });

  return { valid: errors.length === 0, errors };
}
```

- [x] **Step 3:** green; **Commit** — `feat(decks): validator contract and Pokémon deck rules`

---

### Task 3: One Piece rules

**Files:** replace stub `lib/decks/rules/one-piece.ts`; create `tests/rules-one-piece.test.ts`

- [x] **Step 1: Failing tests:**

```ts
import { describe, it, expect } from "vitest";
import { validateDeck } from "@/lib/decks/validate";
import { card } from "./helpers/decks";

const leader = (colors = "Red;Green", over: Record<string, unknown> = {}) =>
  card({ name: "Monkey.D.Luffy", cardId: 1, zone: "leader", attrs: { CardType: "Leader", Color: colors, Number: "OP01-003", Life: "5" }, ...over });
const ch = (name: string, number: string, color: string, quantity: number, cardId: number, over: Record<string, unknown> = {}) =>
  card({ name, cardId, quantity, attrs: { CardType: "Character", Color: color, Number: number, Cost: "3" }, ...over });
/** 50 red/green characters, 4 per number. */
const legal = () => {
  const cards = [leader()];
  for (let i = 0; i < 12; i++) cards.push(ch(`Card ${i}`, `OP01-${String(10 + i).padStart(3, "0")}`, i % 2 ? "Red" : "Green", 4, 10 + i));
  cards.push(ch("Filler", "OP01-099", "Red", 2, 99));
  return cards;
};
const codes = (cards: ReturnType<typeof card>[]) => validateDeck({ gameSlug: "one-piece", cards }).errors.map((e) => e.code);

describe("One Piece deck rules", () => {
  it("accepts a legal Leader + 50", () => expect(validateDeck({ gameSlug: "one-piece", cards: legal() })).toEqual({ valid: true, errors: [] }));
  it("requires exactly one Leader in the leader slot, and no Leaders in the main deck", () => {
    expect(codes(legal().slice(1))).toEqual(["leader"]);
    const two = legal(); two.push(leader("Blue", { cardId: 2 }));
    expect(codes(two)).toEqual(["leader"]);
    const misplaced = legal(); misplaced[0] = { ...misplaced[0], zone: "main" };
    expect(codes(misplaced).sort()).toEqual(["leader", "size", "zone"]);
  });
  it("requires exactly 50 main-deck cards", () => {
    const d = legal(); d[d.length - 1].quantity = 3;
    expect(codes(d)).toEqual(["size"]);
  });
  it("limits copies by card number, so alt arts count together", () => {
    const d = legal(); d[d.length - 1].quantity = 1;
    d.push(ch("Card 0 (Alternate Art)", "OP01-010", "Green", 1, 500));
    const r = validateDeck({ gameSlug: "one-piece", cards: d });
    expect(r.errors.map((e) => e.code)).toEqual(["copies"]);
    expect(r.errors[0].message).toMatch(/OP01-010/);
  });
  it("every card must share a colour with the Leader; multi-colour cards need one match", () => {
    const d = legal(); d[d.length - 1] = ch("Nami", "OP01-016", "Blue", 2, 16);
    const r = validateDeck({ gameSlug: "one-piece", cards: d });
    expect(r.errors.map((e) => e.code)).toEqual(["color"]);
    expect(r.errors[0].cardId).toBe(16);
    const dual = legal(); dual[dual.length - 1] = ch("Zoro", "OP01-025", "Blue;Red", 2, 25);
    expect(codes(dual)).toEqual([]);
    const mono = legal(); mono[0] = leader("Red"); mono[1] = ch("Card 0", "OP01-010", "Red;Green", 4, 10); // dual card in a mono deck: fine
    expect(codes(mono).filter((c) => c === "color")).toHaveLength(6); // the six pure-Green 4-stacks are off-colour now
  });
  it("cards with no colour are not colour-checked", () => {
    const d = legal(); d[d.length - 1] = ch("Mystery", "OP01-098", "", 2, 98);
    expect(codes(d)).toEqual([]);
  });
});
```

- [x] **Step 2: Implement:**

```ts
// lib/decks/rules/one-piece.ts — exactly 1 Leader + exactly 50; ≤4 per card number (alt arts share it);
// every main-deck card shares ≥1 colour with the Leader. DON!! cards are not deck cards.
import type { DeckInput, DeckCardInput, ValidationError, ValidationResult } from "../types";
import { baseName, splitList } from "../identity";

const MAIN_SIZE = 50, MAX_COPIES = 4;
const isLeader = (c: DeckCardInput) => (c.attrs.CardType ?? "") === "Leader";
const numberOf = (c: DeckCardInput) => (c.attrs.Number ?? "").trim().toUpperCase() || `name:${baseName(c.name).toLowerCase()}`;

export function validateOnePiece({ cards }: DeckInput): ValidationResult {
  const errors: ValidationError[] = [];
  const leaders = cards.filter((c) => c.zone === "leader");
  const main = cards.filter((c) => c.zone === "main");
  for (const c of cards) if (c.zone !== "leader" && c.zone !== "main") errors.push({ code: "zone", message: `${baseName(c.name)} is in a zone One Piece decks don't use (${c.zone})`, cardId: c.cardId });

  const leaderCount = leaders.reduce((n, c) => n + c.quantity, 0);
  if (leaderCount !== 1 || !leaders.every(isLeader)) errors.push({ code: "leader", message: leaderCount === 0 ? "Pick a Leader" : `Exactly one Leader card in the Leader slot (found ${leaderCount})` });
  for (const c of main) if (isLeader(c)) errors.push({ code: "zone", message: `${baseName(c.name)} is a Leader and belongs in the Leader slot`, cardId: c.cardId });

  const total = main.reduce((n, c) => n + c.quantity, 0);
  if (total !== MAIN_SIZE) errors.push({ code: "size", message: `The main deck must have exactly ${MAIN_SIZE} cards (this one has ${total})` });

  const byNumber = new Map<string, { n: number; cardId: number }>();
  for (const c of main) {
    const k = numberOf(c);
    const e = byNumber.get(k) ?? { n: 0, cardId: c.cardId };
    e.n += c.quantity;
    byNumber.set(k, e);
  }
  for (const [k, e] of byNumber) if (e.n > MAX_COPIES) errors.push({ code: "copies", message: `${k.replace(/^name:/, "")}: ${e.n} copies (max ${MAX_COPIES})`, cardId: e.cardId });

  const leader = leaders.length === 1 && isLeader(leaders[0]) ? leaders[0] : null;
  if (leader) {
    const colors = new Set(splitList(leader.attrs.Color).map((s) => s.toLowerCase()));
    for (const c of main) {
      const own = splitList(c.attrs.Color).map((s) => s.toLowerCase());
      if (own.length > 0 && !own.some((col) => colors.has(col))) errors.push({ code: "color", message: `${baseName(c.name)} (${own.join("/")}) doesn't match the Leader's colours`, cardId: c.cardId });
    }
  }
  return { valid: errors.length === 0, errors };
}
```

- [x] **Step 3:** green; **Commit** — `feat(decks): One Piece deck rules`

---

### Task 4: Riftbound rules

**Files:** replace stub `lib/decks/rules/riftbound.ts`; create `tests/rules-riftbound.test.ts`

- [x] **Step 1: Failing tests:**

```ts
import { describe, it, expect } from "vitest";
import { validateDeck } from "@/lib/decks/validate";
import { card } from "./helpers/decks";

const legend = (over: Record<string, unknown> = {}) => card({ name: "Renekton, Butcher of the Sands", cardId: 1, zone: "legend", attrs: { "Card Type": "Legend", Tag: "Renekton", Domain: "Fury;Body" }, ...over });
const champion = (over: Record<string, unknown> = {}) => card({ name: "Renekton, Rampager", cardId: 2, zone: "champion", attrs: { "Card Type": "Champion Unit", Tag: "Renekton;Shurima", Domain: "Fury" }, ...over });
const unit = (name: string, cardId: number, quantity: number, domain = "Fury", over: Record<string, unknown> = {}) => card({ name, cardId, quantity, attrs: { "Card Type": "Unit", Domain: domain, "Energy Cost": "2", Might: "2" }, ...over });
const rune = (domain: string, cardId: number, quantity: number) => card({ name: `${domain} Rune`, cardId, quantity, zone: "rune", attrs: { "Card Type": "Rune", Domain: domain } });
const bf = (name: string, cardId: number) => card({ name, cardId, zone: "battlefield", attrs: { "Card Type": "Battlefield" } });
/** Legal: legend, champion, 39 main (13×3), 12 runes, 3 battlefields. */
const legal = () => {
  const cards = [legend(), champion()];
  for (let i = 0; i < 13; i++) cards.push(unit(`Unit ${i}`, 10 + i, 3, i % 2 ? "Fury" : "Body"));
  cards.push(rune("Fury", 50, 6), rune("Body", 51, 6));
  cards.push(bf("Heisho", 60), bf("Targon", 61), bf("Bandle", 62));
  return cards;
};
const codes = (cards: ReturnType<typeof card>[]) => validateDeck({ gameSlug: "riftbound", cards }).errors.map((e) => e.code).sort();

describe("Riftbound deck rules", () => {
  it("accepts a legal constructed deck", () => expect(validateDeck({ gameSlug: "riftbound", cards: legal() })).toEqual({ valid: true, errors: [] }));
  it("requires exactly one Legend", () => {
    expect(codes(legal().filter((c) => c.zone !== "legend"))).toEqual(["legend"]);
    expect(codes([...legal(), legend({ cardId: 3 })])).toEqual(["legend"]);
    expect(codes(legal().map((c) => (c.zone === "legend" ? { ...c, attrs: { ...c.attrs, "Card Type": "Unit" } } : c)))).toEqual(["legend"]);
  });
  it("requires one Chosen Champion that is a Champion Unit sharing the Legend's tag", () => {
    const none = legal().filter((c) => c.zone !== "champion");
    expect(codes(none)).toEqual(["champion", "size"]);
    const wrong = legal().map((c) => (c.zone === "champion" ? { ...c, attrs: { ...c.attrs, Tag: "Ahri;Ionia" } } : c));
    expect(codes(wrong)).toEqual(["champion"]);
    const notChampion = legal().map((c) => (c.zone === "champion" ? { ...c, attrs: { ...c.attrs, "Card Type": "Unit" } } : c));
    expect(codes(notChampion)).toEqual(["champion"]);
  });
  it("main deck is exactly 40 counting the Chosen Champion", () => {
    const d = legal(); d[2].quantity = 2;
    const r = validateDeck({ gameSlug: "riftbound", cards: d });
    expect(r.errors.map((e) => e.code)).toEqual(["size"]);
    expect(r.errors[0].message).toMatch(/39/);
  });
  it("limits any name to 3 copies across main deck and Chosen Champion", () => {
    const d = legal(); d[2].quantity = 1; d.push(unit("Renekton, Rampager", 2, 2, "Fury", { attrs: { "Card Type": "Champion Unit", Tag: "Renekton;Shurima", Domain: "Fury" } }));
    // 1 (champion) + 2 (main) = 3 → fine; +1 more breaks it
    expect(codes(d)).toEqual([]);
    d[d.length - 1].quantity = 3; d[3].quantity = 2; // keep 40
    expect(codes(d)).toEqual(["copies"]);
  });
  it("allows at most 3 Signature cards, all tagged for the Legend", () => {
    const d = legal(); d[2].quantity = 1; d[3].quantity = 2;
    d.push(card({ name: "Renekton's Wrath", cardId: 70, quantity: 3, attrs: { "Card Type": "Signature Spell", Tag: "Renekton", Domain: "Fury" } }));
    expect(codes(d)).toEqual([]);
    d[d.length - 1].quantity = 4; d[3].quantity = 1;
    expect(codes(d)).toEqual(["signature"]);
    const foreign = legal(); foreign[2].quantity = 1;
    foreign.push(card({ name: "Ahri's Charm", cardId: 71, quantity: 2, attrs: { "Card Type": "Signature Spell", Tag: "Ahri", Domain: "Fury" } }));
    expect(codes(foreign)).toEqual(["signature"]);
  });
  it("every main-deck card and rune must be within the Legend's domains (multi-domain needs all)", () => {
    const d = legal(); d[2] = unit("Unit 0", 10, 3, "Mind");
    const r = validateDeck({ gameSlug: "riftbound", cards: d });
    expect(r.errors.map((e) => e.code)).toEqual(["domain"]);
    expect(r.errors[0].cardId).toBe(10);
    const multi = legal(); multi[2] = unit("Unit 0", 10, 3, "Fury;Chaos");
    expect(codes(multi)).toEqual(["domain"]);
    const colorless = legal(); colorless[2] = unit("Unit 0", 10, 3, "None");
    expect(codes(colorless)).toEqual([]);
    const badRune = legal(); badRune[badRune.length - 5] = rune("Mind", 50, 6);
    expect(codes(badRune)).toEqual(["domain"]);
  });
  it("requires exactly 12 runes and 3 distinct battlefields", () => {
    const d = legal(); d[d.length - 4].quantity = 5;
    expect(codes(d)).toEqual(["rune"]);
    const two = legal().filter((c) => c.name !== "Bandle");
    expect(codes(two)).toEqual(["battlefield"]);
    const dupe = legal(); dupe[dupe.length - 1] = bf("Heisho", 63);
    expect(codes(dupe)).toEqual(["battlefield"]);
  });
  it("keeps legends, runes, battlefields and tokens out of the main deck", () => {
    const d = legal(); d[2].quantity = 1;
    d.push(card({ name: "Body Rune", cardId: 80, quantity: 1, attrs: { "Card Type": "Rune", Domain: "Body" } }));
    d.push(card({ name: "Poro", cardId: 81, quantity: 1, attrs: { "Card Type": "Unit;Token", Domain: "Body" } }));
    expect(codes(d)).toEqual(["zone", "zone"]);
  });
});
```

- [x] **Step 2: Implement:**

```ts
// lib/decks/rules/riftbound.ts — Riot Core Rules §103 (constructed): 1 Legend; 1 Chosen Champion (a Champion
// Unit sharing the Legend's champion tag) counted inside an exactly-40 main deck; ≤3 per name across main +
// champion; ≤3 Signature cards, all for the Legend; every main/champion/rune card's domains ⊆ the Legend's
// identity ("None"/missing = colourless); exactly 12 runes; exactly 3 distinct Battlefields; no tokens.
import type { DeckInput, DeckCardInput, ValidationError, ValidationResult } from "../types";
import { baseName, splitList } from "../identity";

const MAIN_SIZE = 40, MAX_COPIES = 3, MAX_SIGNATURE = 3, RUNES = 12, BATTLEFIELDS = 3;
const types = (c: DeckCardInput) => splitList(c.attrs["Card Type"]);
const hasType = (c: DeckCardInput, t: string) => types(c).includes(t);
const isSignature = (c: DeckCardInput) => types(c).some((t) => t.startsWith("Signature"));
const isMainType = (c: DeckCardInput) => {
  const ts = types(c);
  return ts.length > 0 && ts.every((t) => ["Unit", "Champion Unit", "Spell", "Gear", "Signature Spell", "Signature Gear", "Signature Unit"].includes(t));
};
const domains = (c: DeckCardInput) => splitList(c.attrs.Domain).map((d) => d.toLowerCase()).filter((d) => d !== "none");
const tags = (c: DeckCardInput) => splitList(c.attrs.Tag).map((t) => t.toLowerCase());
const label = (c: DeckCardInput) => baseName(c.name);

export function validateRiftbound({ cards }: DeckInput): ValidationResult {
  const errors: ValidationError[] = [];
  const zone = (z: string) => cards.filter((c) => c.zone === z);
  const legends = zone("legend"), champions = zone("champion"), main = zone("main"), runes = zone("rune"), battlefields = zone("battlefield");
  for (const c of cards) if (!["legend", "champion", "main", "rune", "battlefield"].includes(c.zone)) errors.push({ code: "zone", message: `${label(c)} is in a zone Riftbound decks don't use (${c.zone})`, cardId: c.cardId });

  const legendCount = legends.reduce((n, c) => n + c.quantity, 0);
  const legend = legends.length === 1 && legendCount === 1 && hasType(legends[0], "Legend") ? legends[0] : null;
  if (!legend) errors.push({ code: "legend", message: legendCount === 0 ? "Pick a Legend" : "Exactly one Legend card in the Legend slot" });
  const identity = new Set(legend ? domains(legend) : []);
  const legendTags = new Set(legend ? tags(legend) : []);

  const championCount = champions.reduce((n, c) => n + c.quantity, 0);
  const champion = champions.length === 1 && championCount === 1 ? champions[0] : null;
  if (!champion) errors.push({ code: "champion", message: championCount === 0 ? "Pick a Chosen Champion" : "Exactly one Chosen Champion" });
  else if (!hasType(champion, "Champion Unit")) errors.push({ code: "champion", message: `${label(champion)} is not a Champion Unit`, cardId: champion.cardId });
  else if (legend && !tags(champion).some((t) => legendTags.has(t))) errors.push({ code: "champion", message: `${label(champion)} is not ${label(legend)}'s champion`, cardId: champion.cardId });

  const deck = [...main, ...champions];
  const total = deck.reduce((n, c) => n + c.quantity, 0);
  if (total !== MAIN_SIZE) errors.push({ code: "size", message: `The main deck must have exactly ${MAIN_SIZE} cards including the Chosen Champion (this one has ${total})` });
  for (const c of main) if (!isMainType(c)) errors.push({ code: "zone", message: `${label(c)} (${types(c).join("/") || "unknown type"}) can't be in the main deck`, cardId: c.cardId });

  const byName = new Map<string, { n: number; cardId: number; name: string }>();
  for (const c of deck) {
    const k = label(c).toLowerCase();
    const e = byName.get(k) ?? { n: 0, cardId: c.cardId, name: label(c) };
    e.n += c.quantity;
    byName.set(k, e);
  }
  for (const e of byName.values()) if (e.n > MAX_COPIES) errors.push({ code: "copies", message: `${e.name}: ${e.n} copies (max ${MAX_COPIES})`, cardId: e.cardId });

  const signatures = deck.filter(isSignature);
  const sigCount = signatures.reduce((n, c) => n + c.quantity, 0);
  if (sigCount > MAX_SIGNATURE) errors.push({ code: "signature", message: `${sigCount} Signature cards (max ${MAX_SIGNATURE})` });
  if (legend) for (const c of signatures) if (!tags(c).some((t) => legendTags.has(t))) errors.push({ code: "signature", message: `${label(c)} is a Signature card for another champion`, cardId: c.cardId });

  if (legend) for (const c of [...deck, ...runes]) {
    const off = domains(c).filter((d) => !identity.has(d));
    if (off.length > 0) errors.push({ code: "domain", message: `${label(c)} is ${off.join("/")} — outside ${label(legend)}'s domains`, cardId: c.cardId });
  }

  const runeCount = runes.reduce((n, c) => n + c.quantity, 0);
  if (runeCount !== RUNES || !runes.every((c) => hasType(c, "Rune"))) errors.push({ code: "rune", message: `The rune deck must be exactly ${RUNES} runes (this one has ${runeCount})` });

  const bfNames = battlefields.flatMap((c) => Array(c.quantity).fill(label(c).toLowerCase()));
  if (bfNames.length !== BATTLEFIELDS || new Set(bfNames).size !== bfNames.length || !battlefields.every((c) => hasType(c, "Battlefield")))
    errors.push({ code: "battlefield", message: `Exactly ${BATTLEFIELDS} different Battlefields (found ${bfNames.length}${new Set(bfNames).size !== bfNames.length ? ", with a duplicate" : ""})` });

  return { valid: errors.length === 0, errors };
}
```

- [x] **Step 3:** green; **Commit** — `feat(decks): Riftbound deck rules (Core Rules §103 constructed)`

---

### Task 5: Gap analysis, decklist parser/resolver, import CLI

**Files:** create `lib/decks/gap.ts`, `lib/decks/resolve.ts`, `scripts/import-deck.mts`, `tests/decks-gap.test.ts`, `tests/decks-resolve.test.ts`; modify `README.md` (one "Curating meta decks locally" paragraph)

- [x] **Step 1: Failing tests** — `tests/decks-gap.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("decks-gap");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { seedDeckFixtures } from "./helpers/decks";
import { createPortfolio, addItem } from "@/lib/portfolios";
import { loadOwnedByKey, analyzeGap } from "@/lib/decks/gap";
import type { DeckDetail } from "@/lib/decks/data";

let f: Awaited<ReturnType<typeof seedDeckFixtures>>;
const U = "u1";
const line = (over: Partial<DeckDetail["cards"][number]> & { cardId: number }): DeckDetail["cards"][number] => ({
  zone: "main", quantity: 1, name: "x", setName: "s", number: null, rarity: null, imageUrl: null, attrs: {}, market: null, ...over,
});
const deck = (cards: DeckDetail["cards"], gameSlug: DeckDetail["gameSlug"] = "pokemon"): DeckDetail => ({
  id: 1, gameSlug, gameName: "g", name: "d", archetype: null, tier: null, format: null, sourceNote: null, isMeta: true, isDraft: false, updatedAt: "", cardCount: 0, cards,
});

beforeAll(async () => {
  await seedMiniCatalog();
  f = await seedDeckFixtures();
  const a = await createPortfolio(U, "A"), b = await createPortfolio(U, "B");
  await addItem(U, a.id, { printingId: 7, quantity: 2, condition: "NM" });  // Rare Candy (SVI reprint)
  await addItem(U, b.id, { printingId: 6, quantity: 1, condition: "LP" });  // Rare Candy (OBF)
  await addItem(U, a.id, { printingId: 10, quantity: 3, condition: "NM" }); // Nami alt art
  await createPortfolio("other", "Not mine").then((p) => addItem("other", p.id, { printingId: 5, quantity: 4, condition: "NM" })); // Charizard ex, someone else's
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("loadOwnedByKey", () => {
  it("aggregates the user's copies across all binders by identity key", async () => {
    const owned = await loadOwnedByKey(U, "pokemon");
    expect(owned.get("name:rare candy")).toBe(3);
    expect(owned.get("name:charizard ex")).toBeUndefined();
    expect((await loadOwnedByKey(U, "one-piece")).get("num:OP01-016")).toBe(3);
  });
});

describe("analyzeGap", () => {
  it("allocates owned copies to lines in order and prices the missing ones from the line's market", async () => {
    const owned = await loadOwnedByKey(U, "pokemon");
    const g = analyzeGap(deck([
      line({ cardId: f.cards.charizardEx, name: "Charizard ex", quantity: 3, market: 18.9 }),
      line({ cardId: f.cards.rareCandyObf, name: "Rare Candy", quantity: 4, market: 1.6 }),
      line({ cardId: f.cards.fireEnergy, name: "Basic Fire Energy", quantity: 10, market: null }),
    ]), owned);
    expect(g.lines.map((l) => [l.owned, l.missing, l.missingCost])).toEqual([[0, 3, 56.7], [3, 1, 1.6], [0, 10, null]]);
    expect(g).toMatchObject({ total: 17, owned: 3, missing: 14, missingCost: 58.3, unpricedMissing: 10 });
  });
  it("shares one identity's copies across two lines (e.g. Riftbound champion + main copies)", async () => {
    const owned = new Map([["name:renekton, rampager", 2]]);
    const g = analyzeGap(deck([
      line({ cardId: f.cards.renektonChampion, name: "Renekton, Rampager", zone: "champion", quantity: 1, market: 12 }),
      line({ cardId: f.cards.renektonChampion, name: "Renekton, Rampager", zone: "main", quantity: 2, market: 12 }),
    ], "riftbound"), owned);
    expect(g.lines.map((l) => [l.owned, l.missing])).toEqual([[1, 0], [1, 1]]);
    expect(g.missingCost).toBe(12);
  });
  it("counts One Piece alt arts as the same card", async () => {
    const owned = await loadOwnedByKey(U, "one-piece");
    const g = analyzeGap(deck([line({ cardId: f.cards.nami, name: "Nami", quantity: 4, attrs: { Number: "OP01-016" }, market: 2.5 })], "one-piece"), owned);
    expect(g.lines[0]).toMatchObject({ owned: 3, missing: 1, missingCost: 2.5 });
  });
});
```

`tests/decks-resolve.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("decks-resolve");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { seedDeckFixtures } from "./helpers/decks";
import { parseDecklist, resolveDecklist } from "@/lib/decks/resolve";

let f: Awaited<ReturnType<typeof seedDeckFixtures>>;
beforeAll(async () => { await seedMiniCatalog(); f = await seedDeckFixtures(); });
afterAll(() => { closeDb(); tmp.clean(); });

describe("parseDecklist", () => {
  it("reads quantities in the common shapes and ignores headers/totals", () => {
    const text = `Pokémon: 8\n4 Charmander MEW 4\n4x Charizard ex OBF 125\n\nTrainer: 4\nRare Candy x4\nTotal Cards: 60`;
    expect(parseDecklist(text, "pokemon")).toEqual([
      { raw: "4 Charmander MEW 4", quantity: 4, text: "Charmander", zone: "main" },
      { raw: "4x Charizard ex OBF 125", quantity: 4, text: "Charizard ex", zone: "main" },
      { raw: "Rare Candy x4", quantity: 4, text: "Rare Candy", zone: "main" },
    ]);
  });
  it("maps One Piece and Riftbound section headers to zones", () => {
    expect(parseDecklist(`Leader\n1 OP01-003 Monkey.D.Luffy\nMain\n4 OP01-016 Nami`, "one-piece").map((l) => [l.zone, l.text])).toEqual([["leader", "OP01-003 Monkey.D.Luffy"], ["main", "OP01-016 Nami"]]);
    expect(parseDecklist(`Legend:\n1 Renekton, Butcher of the Sands\nChampion:\n1 Renekton, Rampager\nRunes:\n12 Body Rune\nBattlefields:\n1 Heisho, Shell of the World`, "riftbound").map((l) => l.zone)).toEqual(["legend", "champion", "rune", "battlefield"]);
  });
  it("defaults a bare line to quantity 1", () => {
    expect(parseDecklist("Heisho, Shell of the World", "riftbound")[0]).toMatchObject({ quantity: 1, text: "Heisho, Shell of the World" });
  });
});

describe("resolveDecklist", () => {
  it("resolves exact names (any printing, cheapest priced first) and One Piece numbers", async () => {
    const r = await resolveDecklist("pokemon", parseDecklist("4 Rare Candy\n3 Charizard ex", "pokemon"));
    expect(r[0].cardId).toBe(f.cards.rareCandySvi); // $0.80 SVI reprint beats $1.60 OBF
    expect(r[1].cardId).toBe(f.cards.charizardEx);
    const op = await resolveDecklist("one-piece", parseDecklist("1 OP01-003 Monkey.D.Luffy\n4 OP01-016", "one-piece"));
    expect(op.map((x) => x.cardId)).toEqual([f.cards.luffyLeader, f.cards.nami]); // the $2.50 regular over the $40 alt art
  });
  it("offers candidates for a fuzzy or ambiguous line and leaves cardId null", async () => {
    const [r] = await resolveDecklist("pokemon", parseDecklist("2 Charizard", "pokemon"));
    expect(r.cardId).toBeNull();
    expect(r.candidates.map((c) => c.name)).toContain("Charizard ex");
    const [none] = await resolveDecklist("pokemon", parseDecklist("1 Definitely Not A Card", "pokemon"));
    expect(none).toMatchObject({ cardId: null, candidates: [] });
  });
});
```

- [x] **Step 2: Implement `lib/decks/gap.ts`:**

```ts
// lib/decks/gap.ts — spec §5: gap analysis at read time. Ownership is the user's copies across ALL binders,
// aggregated by identity key (any printing counts), allocated to the deck's lines in order.
import { db } from "@/lib/db";
import { identityKey } from "./identity";
import type { GameSlug } from "./types";
import type { DeckDetail, DeckLine } from "./data";

export interface GapLine extends DeckLine { key: string; owned: number; missing: number; missingCost: number | null }
export interface GapAnalysis { lines: GapLine[]; total: number; owned: number; missing: number; missingCost: number; unpricedMissing: number }

/** identity key → total copies the user owns of that card (any printing, any binder) within one game. */
export async function loadOwnedByKey(userId: string, gameSlug: GameSlug): Promise<Map<string, number>> {
  const c = await db();
  const rows = (await c.execute({
    sql: `SELECT ca.name, ca.attrs, SUM(ci.quantity) AS n
          FROM collection_items ci
          JOIN portfolios po ON po.id = ci.portfolio_id AND po.user_id = ?
          JOIN printings p ON p.id = ci.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          JOIN games g ON g.id = se.game_id AND g.slug = ?
          GROUP BY ca.id`,
    args: [userId, gameSlug],
  })).rows;
  const owned = new Map<string, number>();
  for (const r of rows) {
    let attrs: Record<string, string> = {};
    try { attrs = JSON.parse(String(r.attrs ?? "{}")); } catch { /* keep {} */ }
    const k = identityKey(gameSlug, { name: String(r.name), attrs });
    owned.set(k, (owned.get(k) ?? 0) + Number(r.n));
  }
  return owned;
}

/** Pure: allocate `owned` copies to the deck's lines in order; price missing copies at the line's market. */
export function analyzeGap(deck: DeckDetail, owned: Map<string, number>): GapAnalysis {
  const left = new Map(owned);
  const lines: GapLine[] = deck.cards.map((l) => {
    const key = identityKey(deck.gameSlug, l);
    const have = left.get(key) ?? 0;
    const use = Math.min(have, l.quantity);
    left.set(key, have - use);
    const missing = l.quantity - use;
    return { ...l, key, owned: use, missing, missingCost: missing === 0 ? 0 : l.market == null ? null : round2(missing * l.market) };
  });
  const total = lines.reduce((n, l) => n + l.quantity, 0);
  const ownedN = lines.reduce((n, l) => n + l.owned, 0);
  const missingCost = round2(lines.reduce((n, l) => n + (l.missingCost ?? 0), 0));
  const unpricedMissing = lines.filter((l) => l.missing > 0 && l.market == null).reduce((n, l) => n + l.missing, 0);
  return { lines, total, owned: ownedN, missing: total - ownedN, missingCost, unpricedMissing };
}
const round2 = (n: number) => Math.round(n * 100) / 100;
```

- [x] **Step 3: Implement `lib/decks/resolve.ts`:**

```ts
// lib/decks/resolve.ts — decklist text → catalog cards. Shared by the admin curation screen (Task 8) and
// scripts/import-deck.mts. Exact matches resolve to the cheapest priced printing's card (any set); anything
// else returns candidates for a human to pick from.
import { db } from "@/lib/db";
import { baseName } from "./identity";
import type { GameSlug, Zone } from "./types";

export interface ParsedLine { raw: string; quantity: number; text: string; zone: Zone }
export interface Candidate { cardId: number; name: string; setName: string; number: string | null }
export interface Resolution { line: ParsedLine; cardId: number | null; candidates: Candidate[] }

const HEADERS: Array<[RegExp, Zone]> = [
  [/^(pok[eé]mon|trainers?|energy|main( deck)?|deck|cards)\b/i, "main"],
  [/^leader\b/i, "leader"], [/^legend\b/i, "legend"], [/^(chosen )?champion\b/i, "champion"], [/^runes?\b/i, "rune"], [/^battlefields?\b/i, "battlefield"],
];
const SKIP = /^(total|\d+\s*cards?\s*$|don!!|#|\/\/)/i;
const SET_TAIL = /\s+[A-Z]{2,4}\s+\d{1,3}[a-z]?$/;          // "… MEW 4", "… OBF 125"
const PAREN_TAIL = /\s*\((?:[A-Z]{2,4}-)?\d{1,3}[a-z]?\)$/;  // "… (OGN-006)"

export function parseDecklist(text: string, game: GameSlug): ParsedLine[] {
  const out: ParsedLine[] = [];
  let zone: Zone = game === "one-piece" ? "main" : game === "riftbound" ? "main" : "main";
  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim();
    if (!raw || SKIP.test(raw)) continue;
    const header = HEADERS.find(([re]) => re.test(raw) && /^[^\d]/.test(raw) && (/[:：]\s*\d*$/.test(raw) || /^[A-Za-zé ]+$/.test(raw)));
    if (header) { zone = header[1]; continue; }
    let quantity = 1, text = raw;
    let m = raw.match(/^(\d+)\s*[xX×]?\s+(.+)$/);
    if (m) { quantity = Number(m[1]); text = m[2]; }
    else if ((m = raw.match(/^(.+?)\s*[xX×]\s*(\d+)$/))) { quantity = Number(m[2]); text = m[1]; }
    text = text.replace(SET_TAIL, "").replace(PAREN_TAIL, "").trim();
    if (!text) continue;
    out.push({ raw, quantity, text, zone });
  }
  return out;
}

const OP_NUMBER = /^([A-Z]{1,3}\d{2}-\d{3})\b\s*(.*)$/;

export async function resolveDecklist(game: GameSlug, lines: ParsedLine[]): Promise<Resolution[]> {
  const c = await db();
  const out: Resolution[] = [];
  for (const line of lines) {
    let exact;
    const num = game === "one-piece" ? line.text.toUpperCase().match(OP_NUMBER) : null;
    if (num) {
      exact = await c.execute({
        sql: `SELECT ca.id, ca.name, se.name AS set_name, ca.number, (SELECT MIN(lp.market) FROM printings p JOIN latest_prices lp ON lp.printing_id = p.id WHERE p.card_id = ca.id) AS market
              FROM cards ca JOIN sets se ON se.id = ca.set_id JOIN games g ON g.id = se.game_id
              WHERE g.slug = ? AND UPPER(json_extract(ca.attrs, '$.Number')) = ? ORDER BY market IS NULL, market, se.release_date DESC LIMIT 20`,
        args: [game, num[1]],
      });
    } else {
      // exact base-name match: candidates are every card whose baseName equals the text (case-insensitive)
      const like = `${baseName(line.text).replace(/[%_]/g, (ch) => "\\" + ch)}%`;
      const rows = (await c.execute({
        sql: `SELECT ca.id, ca.name, se.name AS set_name, ca.number, (SELECT MIN(lp.market) FROM printings p JOIN latest_prices lp ON lp.printing_id = p.id WHERE p.card_id = ca.id) AS market
              FROM cards ca JOIN sets se ON se.id = ca.set_id JOIN games g ON g.id = se.game_id
              WHERE g.slug = ? AND ca.name LIKE ? ESCAPE '\\' ORDER BY market IS NULL, market, se.release_date DESC LIMIT 50`,
        args: [game, like],
      })).rows;
      const want = baseName(line.text).toLowerCase();
      exact = { rows: rows.filter((r) => baseName(String(r.name)).toLowerCase() === want) };
      if (exact.rows.length === 0 && rows.length > 0) {
        out.push({ line, cardId: null, candidates: rows.slice(0, 5).map(toCandidate) });
        continue;
      }
    }
    if (exact.rows.length === 0) {
      const fuzzy = (await c.execute({
        sql: `SELECT ca.id, ca.name, se.name AS set_name, ca.number FROM cards ca JOIN sets se ON se.id = ca.set_id JOIN games g ON g.id = se.game_id
              WHERE g.slug = ? AND ca.name LIKE ? ESCAPE '\\' ORDER BY ca.name LIMIT 5`,
        args: [game, `%${line.text.replace(/[%_]/g, (ch) => "\\" + ch)}%`],
      })).rows;
      out.push({ line, cardId: null, candidates: fuzzy.map(toCandidate) });
      continue;
    }
    out.push({ line, cardId: Number(exact.rows[0].id), candidates: exact.rows.slice(0, 5).map(toCandidate) });
  }
  return out;
}
const toCandidate = (r: Record<string, unknown>): Candidate => ({ cardId: Number(r.id), name: String(r.name), setName: String(r.set_name), number: r.number == null ? null : String(r.number) });
```

(The `LIKE 'name%'` prefilter plus the exact `baseName` comparison is what makes "Rare Candy" match both "Rare Candy" and "Rare Candy - 191/198" but not "Rare Candy Bar". "Charizard" prefilters "Charizard ex" but the exact test fails → candidates, `cardId: null`. Adjust the test fixtures only if a real behaviour is wrong, not to make a wrong behaviour pass.)

- [x] **Step 4: CLI** — `scripts/import-deck.mts`:

```ts
// scripts/import-deck.mts — local curation until the admin screen ships (Task 8), and a repeatable way to
// load decklists afterwards. Usage (bash; PowerShell: set $env:TURSO_DATABASE_URL first):
//   TURSO_DATABASE_URL=file:hitstreak.local.db npx tsx scripts/import-deck.mts \
//     --game pokemon --name "Charizard ex / Pidgeot" --tier 1 --format standard --source "Regional top cuts, Aug 30" \
//     --as dev@example.com --file decks/zard.txt [--id 3]
// The --as user must have "user".isAdmin = 1 (flip it once locally: UPDATE "user" SET "isAdmin" = 1 WHERE email = '…').
// Unresolved lines are printed with candidates and nothing is written.
import { readFileSync } from "node:fs";
import { db, closeDb } from "@/lib/db";
import { parseDecklist, resolveDecklist } from "@/lib/decks/resolve";
import { upsertMetaDeck } from "@/lib/decks/data";
import { isGameSlug } from "@/lib/decks/types";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? undefined : process.argv[i + 1]; };
const game = arg("game"), name = arg("name"), file = arg("file"), as = arg("as");
if (!isGameSlug(game) || !name || !file || !as) { console.error("usage: --game <pokemon|one-piece|riftbound> --name <deck> --file <list.txt> --as <admin email> [--tier N] [--format F] [--archetype A] [--source S] [--id N]"); process.exit(2); }

const c = await db();
const user = (await c.execute({ sql: `SELECT id FROM "user" WHERE email = ?`, args: [as] })).rows[0];
if (!user) { console.error(`no user with email ${as}`); process.exit(2); }
const lines = parseDecklist(readFileSync(file, "utf8"), game);
const resolved = await resolveDecklist(game, lines);
const unresolved = resolved.filter((r) => r.cardId == null);
for (const r of unresolved) console.error(`UNRESOLVED: "${r.line.raw}"${r.candidates.length ? " — did you mean: " + r.candidates.map((x) => `${x.name} (${x.setName} ${x.number ?? ""})`).join(" | ") : ""}`);
if (unresolved.length > 0) { closeDb(); process.exit(1); }
const id = await upsertMetaDeck(String(user.id), {
  id: arg("id") ? Number(arg("id")) : undefined, gameSlug: game, name, archetype: arg("archetype") ?? null,
  tier: arg("tier") ? Number(arg("tier")) : null, format: arg("format") ?? null, sourceNote: arg("source") ?? null,
  lines: resolved.map((r) => ({ cardId: r.cardId!, zone: r.line.zone, quantity: r.line.quantity })),
});
console.log(`meta deck ${id}: ${name} — ${lines.reduce((n, l) => n + l.quantity, 0)} cards in ${lines.length} lines`);
closeDb();
```

(`.mts` with top-level await, run via `npx tsx`; `@/` alias works because tsconfig `paths` covers `**/*.mts` — `scripts/db-counts.mts` is the precedent. If tsx does not honour the alias, use relative imports.) README: add a short "Curating meta decks locally" paragraph under Development with the command and the `isAdmin` flip.

- [x] **Step 5:** green; **Commit** — `feat(decks): gap analysis, decklist parser/resolver, local import CLI`

---

### Task 6: Meta browser + deck detail pages

**Files:** replace `app/(app)/decks/page.tsx`; create `app/(app)/decks/DeckSummaryPanel.tsx`, `app/(app)/decks/[id]/page.tsx`, `tests/ui/deck-summary-panel.test.tsx`; modify `docs/design/README.md` ("Implemented as": meta deck row → `DeckSummaryPanel`; group label stays the `GroupLabel` candidate from §13)

- [x] **Step 1: `DeckSummaryPanel`** (server component — no hooks; it is a `Link` around a `Panel`):

```tsx
import Link from "next/link";
import type { DeckSummary } from "@/lib/decks/data";
import type { GapAnalysis } from "@/lib/decks/gap";
import { formatMoney } from "@/lib/format";
import { Panel, ProgressBar, TierBadge } from "@/components/ui";

/** One meta deck in the browser: name, archetype, You own x / N, $ to complete, completion bar. */
export default function DeckSummaryPanel({ deck, gap }: { deck: DeckSummary; gap: GapAnalysis }) {
  const ratio = gap.total > 0 ? gap.owned / gap.total : 0;
  const complete = gap.missing === 0 && gap.total > 0;
  return (
    <Link href={`/decks/${deck.id}`} className="block">
      <Panel className="flex flex-col gap-2.5 transition-colors hover:border-ink">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex items-center gap-2 font-semibold text-ink">
            {deck.name}
            {deck.tier != null && <TierBadge tier={deck.tier} />}
          </span>
          {deck.archetype && deck.archetype !== deck.name && <span className="text-[13px] text-dim">{deck.archetype}</span>}
        </div>
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-muted">You own <span className="num font-semibold text-ink">{gap.owned} / {gap.total}</span></span>
          <span className="num">
            {complete ? <span className="font-semibold text-gain">Complete</span> : <><span className="font-semibold text-ink">{formatMoney(gap.missingCost)}</span> <span className="text-muted">to complete</span></>}
          </span>
        </div>
        <ProgressBar value={ratio} label={`${deck.name} completion`} tone={complete ? "gain" : gap.owned > 0 ? "accent" : "muted"} />
        {gap.unpricedMissing > 0 && <span className="text-xs text-dim">{gap.unpricedMissing} missing {gap.unpricedMissing === 1 ? "copy has" : "copies have"} no market price</span>}
      </Panel>
    </Link>
  );
}
```

Test: renders name, tier badge, "You own 51 / 60", "$86.40 to complete", progressbar `aria-valuenow` 85, link to `/decks/7`; a complete deck shows "Complete" and tone gain; unpriced note appears when `unpricedMissing > 0`. (Build `gap` objects by hand; no DB.)

- [x] **Step 2: Browser page** — `app/(app)/decks/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listGames } from "@/lib/catalog";
import { listMetaDecks, getDeck } from "@/lib/decks/data";
import { loadOwnedByKey, analyzeGap } from "@/lib/decks/gap";
import { isGameSlug } from "@/lib/decks/types";
import { SectionHeading, Pill, EmptyState } from "@/components/ui";
import DeckSummaryPanel from "./DeckSummaryPanel";

export const metadata = { title: "Decks — Hitstreak" };
export const dynamic = "force-dynamic"; // gap analysis is per user

const DEFAULT_GAME = "pokemon";
const TIER_LABEL = (t: number | null) => (t == null ? "Other" : `Tier ${t}`);

export default async function DecksPage({ searchParams }: PageProps<"/decks">) {
  const { game } = await searchParams;
  const gameSlug = isGameSlug(game) ? game : DEFAULT_GAME;
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const games = await listGames();
  const current = games.find((g) => g.slug === gameSlug);
  if (!current) notFound();

  const [decks, owned] = await Promise.all([listMetaDecks(gameSlug), loadOwnedByKey(session.user.id, gameSlug)]);
  // Gap needs each deck's lines; curated lists are few, so one detail read per deck is fine here.
  const gaps = await Promise.all(decks.map(async (d) => analyzeGap((await getDeck(d.id, null))!, owned)));
  const tiers = [...new Set(decks.map((d) => d.tier))].sort((a, b) => (a ?? 99) - (b ?? 99));

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading as="h1" title="Meta decks" caption={`${decks.length} curated for ${current.name}`} />
      <div className="flex flex-wrap gap-1.5">
        {games.map((g) => <Pill key={g.slug} href={`/decks?game=${g.slug}`} selected={g.slug === gameSlug}>{g.name}</Pill>)}
      </div>
      {decks.length === 0 ? (
        <EmptyState title="No curated decks yet" body={`Meta decks for ${current.name} appear here once they are curated.`} />
      ) : (
        tiers.map((t) => (
          <div key={String(t)} className="flex flex-col gap-2.5">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{TIER_LABEL(t)}</span>
            <div className="grid gap-3 md:grid-cols-2">
              {decks.map((d, i) => (d.tier === t ? <DeckSummaryPanel key={d.id} deck={d} gap={gaps[i]} /> : null))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
```

(Personal decks, "My decks" and "New deck" arrive with the builder in Task 7 — leave them out; the mockup's uppercase group label is the same ad-hoc pattern AlertList uses and is already a §13 primitive candidate.)

- [x] **Step 3: Detail page** — `app/(app)/decks/[id]/page.tsx`:

```tsx
import { cache } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { getDeck } from "@/lib/decks/data";
import { loadOwnedByKey, analyzeGap } from "@/lib/decks/gap";
import { describeRules } from "@/lib/decks/validate";
import { ZONES, ZONE_LABEL } from "@/lib/decks/types";
import { formatMoney } from "@/lib/format";
import { SectionHeading, Panel, StatTile, TierBadge, ValidationList, CardRow } from "@/components/ui";

export const dynamic = "force-dynamic";

const load = cache(async (id: string) => {
  const deckId = parseRouteId(id);
  if (deckId == null) notFound();
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const deck = await getDeck(deckId, session.user.id);
  if (!deck) notFound();
  return { userId: session.user.id, deck };
});

export async function generateMetadata({ params }: PageProps<"/decks/[id]">) {
  const { id } = await params;
  const { deck } = await load(id);
  return { title: `${deck.name} — Hitstreak` };
}

export default async function DeckDetailPage({ params }: PageProps<"/decks/[id]">) {
  const { id } = await params;
  const { userId, deck } = await load(id);
  const gap = analyzeGap(deck, await loadOwnedByKey(userId, deck.gameSlug));
  const rules = describeRules({ gameSlug: deck.gameSlug, cards: deck.cards.map((l) => ({ cardId: l.cardId, name: l.name, zone: l.zone, quantity: l.quantity, attrs: l.attrs, rarity: l.rarity })) });
  const missing = gap.lines.filter((l) => l.missing > 0).sort((a, b) => (b.missingCost ?? 0) - (a.missingCost ?? 0));
  const caption = [deck.tier != null ? `Tier ${deck.tier}` : null, deck.format, deck.sourceNote ? `curated from ${deck.sourceNote}` : null].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/decks?game=${deck.gameSlug}`} className="text-[13px] text-muted hover:text-ink">← Meta decks</Link>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">{deck.gameName}{caption ? ` · ${caption}` : ""}</span>
        <div className="flex flex-wrap items-center gap-3">
          <SectionHeading as="h1" title={deck.name} />
          {deck.tier != null && <TierBadge tier={deck.tier} />}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="You own" value={`${gap.owned} / ${gap.total}`} />
        <StatTile label="Missing" value={`${gap.missing} card${gap.missing === 1 ? "" : "s"}`} />
        <StatTile label="Cost to complete" value={formatMoney(gap.missingCost)} tone={gap.missing === 0 ? "gain" : "default"} />
      </div>
      {gap.unpricedMissing > 0 && <p className="text-[13px] text-dim">{gap.unpricedMissing} missing {gap.unpricedMissing === 1 ? "copy has" : "copies have"} no market price and {gap.unpricedMissing === 1 ? "is" : "are"} left out of the cost.</p>}

      <div className="grid gap-5 md:grid-cols-[1fr_320px]">
        <Panel className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-ink">Missing cards</span>
            <span className="text-xs text-dim">· priced at market</span>
          </div>
          {missing.length === 0 ? (
            <p className="text-[13px] text-gain">You own every card in this deck.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {missing.map((l) => (
                <li key={`${l.zone}-${l.cardId}`}>
                  <CardRow
                    name={l.name}
                    subtitle={[l.setName, l.number, l.zone !== "main" ? ZONE_LABEL[l.zone] : null].filter(Boolean).join(" · ")}
                    imageUrl={l.imageUrl}
                    right={<><span className="text-sm font-semibold text-ink">×{l.missing}</span><span className="text-[11px] text-dim">{l.missingCost == null ? "no price" : formatMoney(l.missingCost)}</span></>}
                  />
                </li>
              ))}
            </ul>
          )}
          <details className="text-[13px]">
            <summary className="cursor-pointer text-muted hover:text-ink">Show full list ({gap.total})</summary>
            <div className="mt-2 flex flex-col gap-3">
              {ZONES[deck.gameSlug].map((z) => {
                const lines = gap.lines.filter((l) => l.zone === z);
                if (lines.length === 0) return null;
                return (
                  <div key={z} className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{ZONE_LABEL[z]}</span>
                    {lines.map((l) => (
                      <div key={l.cardId} className="flex items-baseline justify-between gap-3 border-b border-hairline-soft py-1 last:border-b-0">
                        <span className={l.missing === 0 ? "text-ink" : "text-muted"}><span className="num text-dim">×{l.quantity}</span> {l.name} <span className="text-xs text-dim">{l.setName} · {l.number ?? "—"}</span></span>
                        <span className={`num text-xs ${l.missing === 0 ? "text-gain" : "text-dim"}`}>{l.missing === 0 ? "owned" : `${l.owned} of ${l.quantity}`}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </details>
        </Panel>
        <Panel className="flex flex-col gap-2.5">
          <span className="font-semibold text-ink">Legality</span>
          <ValidationList items={rules} />
        </Panel>
      </div>
    </div>
  );
}
```

("Copy to my decks" / "Open in builder" arrive in Task 7.)

- [x] **Step 4:** tests, typecheck, lint. Manually (dev server on :3000 with the `dev@example.com` session; flip `isAdmin` for that user once via SQL): import a real Pokémon list with the Task 5 CLI, open `/decks`, `/decks/<id>`; check `/decks?game=riftbound` empty state; `/decks/999999` → 404. **Commit** — `feat(decks): meta deck browser with gap analysis and deck detail (missing cards, full list, legality)`

---

### Task 7: Deck builder

**Files:** create `lib/decks/gap-math.ts`, `lib/decks/zone.ts`, `tests/decks-zone.test.ts`, `app/(app)/decks/actions.ts`, `tests/decks-actions.test.ts`, `app/(app)/decks/mine/page.tsx`, `app/(app)/decks/mine/NewDeckForm.tsx`, `app/(app)/decks/mine/DeckActions.tsx`, `app/(app)/decks/mine/[id]/page.tsx`, `app/(app)/decks/mine/[id]/Builder.tsx`, `app/(app)/decks/[id]/CopyDeckButton.tsx`, `tests/ui/new-deck-form.test.tsx`, `tests/ui/builder.test.tsx`; modify `lib/decks/gap.ts`, `lib/decks/validate.ts`, `lib/decks/data.ts`, `lib/catalog.ts`, `components/ui/useCardSearch.ts`, `app/(app)/decks/page.tsx`, `app/(app)/decks/[id]/page.tsx`, `tests/ranges.test.ts`, `tests/catalog-read.test.ts`, `docs/design/README.md`

The builder validates **live in the browser**, so everything it imports must be db-free. Three enabling
changes come first (Steps 1–3), then the actions, then the screens.

- [x] **Step 1: db-free gap math.** Move `GapLine`, `GapAnalysis` and `analyzeGap` out of `lib/decks/gap.ts`
  into a new `lib/decks/gap-math.ts` (it may import only `./identity`, `./types` and `import type` from
  `./data`), and relax the deck parameter so the builder can pass its live lines:

```ts
// lib/decks/gap-math.ts
// Pure gap arithmetic, split out of lib/decks/gap.ts so the builder ("use client") can reuse it without
// dragging lib/db into the client bundle (same reason as lib/ranges.ts).
import { identityKey } from "./identity";
import type { GameSlug } from "./types";
import type { DeckLine } from "./data";

export interface GapLine extends DeckLine { key: string; owned: number; missing: number; missingCost: number | null }
export interface GapAnalysis { lines: GapLine[]; total: number; owned: number; missing: number; missingCost: number; unpricedMissing: number }

/** Allocate `owned` copies to the deck's lines in order; price missing copies at the line's market.
 *  Takes the structural minimum, not a whole DeckDetail, so the builder can pass unsaved lines. */
export function analyzeGap(deck: { gameSlug: GameSlug; cards: DeckLine[] }, owned: Map<string, number>): GapAnalysis {
  // …body moved verbatim from gap.ts…
}
```

`lib/decks/gap.ts` keeps `loadOwnedByKey` and adds `export * from "./gap-math";` so every existing
import site (`app/(app)/decks/page.tsx`, `[id]/page.tsx`, `tests/decks-gap.test.ts`) is unchanged.
Extend `tests/ranges.test.ts`'s guard: add `lib/decks/gap-math.ts`, `lib/decks/validate.ts`,
`lib/decks/zone.ts` and `lib/decks/identity.ts` to the "must not reach lib/db" list, and assert
`gap.analyzeGap === gapMath.analyzeGap`. The `REACHES_DB` regex there matches `db|history`; add
`decks/data|decks/gap` as alternatives **only** for the new files (`gap-math` legitimately
`import type`s from `./data`, which is erased at compile time — the guard must therefore ignore
`import type` lines: match `/^import\s+(?!type\b)/m`-anchored imports, or simply strip lines starting
with `import type` before testing).

- [x] **Step 2: default zone** — `lib/decks/zone.ts`:

```ts
// lib/decks/zone.ts
// Where a card lands when you add it in the builder, and which zones hold exactly one card.
// Pure (no db): the builder runs this on every search hit.
import { splitList } from "./identity";
import type { GameSlug, Zone } from "./types";

/** Zones that hold a single card: adding a second replaces the first. */
export const SINGLE_CARD_ZONES: readonly Zone[] = ["leader", "legend", "champion"];
export const isSingleCardZone = (z: Zone) => SINGLE_CARD_ZONES.includes(z);

/** The zone a card belongs in, read from its type. Anything unrecognised goes to the main deck, where
 *  the validator will flag it — better a visible wrong row than a silently dropped card. */
export function defaultZone(game: GameSlug, card: { attrs: Record<string, string> }): Zone {
  if (game === "one-piece") return (card.attrs.CardType ?? "").trim() === "Leader" ? "leader" : "main";
  if (game === "riftbound") {
    const types = splitList(card.attrs["Card Type"]);
    if (types.includes("Legend")) return "legend";
    if (types.includes("Rune")) return "rune";
    if (types.includes("Battlefield")) return "battlefield";
    if (types.includes("Champion Unit")) return "champion";
  }
  return "main";
}
```

`tests/decks-zone.test.ts`: Pokémon anything → `main`; One Piece `CardType: "Leader"` → `leader`,
`"Character"` → `main`, missing → `main`; Riftbound `"Legend"` → `legend`, `"Rune"` → `rune`,
`"Battlefield"` → `battlefield`, `"Champion Unit"` → `champion`, `"Unit"` → `main`,
`"Gear;Battlefield;Token"` → `battlefield` (the validator rejects the token separately), `{}` → `main`;
`isSingleCardZone` true for leader/legend/champion, false for main/rune/battlefield.

- [x] **Step 3: search carries `attrs`, and can be filtered by game.**
  - `lib/catalog.ts`: add `attrs: Record<string, string>` to `SearchHit`, select `ca.attrs` in
    `searchCards`, and parse it exactly as `getCardDetail` does (`try { JSON.parse(String(r.attrs ?? "{}")) } catch { {} }`).
    Add one assertion to `tests/catalog-read.test.ts`'s search test that a hit carries its `attrs`.
  - `components/ui/useCardSearch.ts`: `CardHit` gains `number: string | null`, `setName: string`,
    `rarity: string | null`, `attrs: Record<string, string>`; the hook takes a third argument
    `gameSlug?: string` and appends `&game=${encodeURIComponent(gameSlug)}` when set (include it in the
    effect's dependency list and in the `results.query` tag — key the tag as `${q}|${gameSlug ?? ""}`
    so switching game re-fetches instead of showing another game's hits). `AddItemDialog` keeps working
    unchanged (it reads only the fields it already used).

- [x] **Step 4: `loadDeckCardInputs`** in `lib/decks/data.ts` — the server must validate a save without
  trusting the client's copy of `attrs`:

```ts
/** The name/attrs/rarity a validator needs for the given lines, read from the catalog. Lines whose card
 *  no longer exists are dropped; `saveDeckCards` rejects them separately. */
export async function loadDeckCardInputs(lines: DeckLineInput[]): Promise<DeckCardInput[]> {
  if (lines.length === 0) return [];
  const c = await db();
  const ids = [...new Set(lines.map((l) => l.cardId))];
  const rows = (await c.execute({
    sql: `SELECT id, name, rarity, attrs FROM cards WHERE id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  })).rows;
  const byId = new Map(rows.map((r) => {
    let attrs: Record<string, string> = {};
    try { attrs = JSON.parse(String(r.attrs ?? "{}")); } catch { /* keep {} */ }
    return [Number(r.id), { name: String(r.name), rarity: r.rarity == null ? null : String(r.rarity), attrs }];
  }));
  return lines.flatMap((l) => {
    const c = byId.get(l.cardId);
    return c ? [{ cardId: l.cardId, zone: l.zone, quantity: l.quantity, name: c.name, rarity: c.rarity, attrs: c.attrs }] : [];
  });
}
```

(`DeckCardInput` is imported from `./types`.)

- [x] **Step 5: `validationItems`** in `lib/decks/validate.ts`, so the builder's `ValidationList` shows the
  mockup's specific messages while still listing rules that pass:

```ts
/** One line per rule: the rule's text when it holds, or one line per concrete error when it doesn't
 *  ("Rare Candy: 5 copies (max 4)"). Rules with no error come first in RULE_TEXT order. */
export function validationItems(input: DeckInput): Array<{ ok: boolean; text: string }> {
  const errors = validateDeck(input).errors;
  return RULE_TEXT[input.gameSlug].flatMap((r) => {
    const hits = errors.filter((e) => e.code === r.code);
    return hits.length === 0 ? [{ ok: true, text: r.text }] : hits.map((e) => ({ ok: false, text: e.message }));
  });
}
```

Test in a new `describe` inside `tests/rules-pokemon.test.ts`: a legal deck gives six `ok: true` items in
`RULE_TEXT` order; a 61-card deck with 5 Rare Candy gives `ok: false` items whose text contains "61" and
"Rare Candy", and the untouched rules stay `ok: true`.

- [x] **Step 6: server actions** — `app/(app)/decks/actions.ts`:

```ts
"use server";
// Mutations for personal decks. Same contract as the portfolio and alert actions: the session is
// re-checked, ids are validated before SQL, failures come back as { ok: false, error }. The deck is
// validated HERE, from the catalog's own attrs — the client's copy is never trusted.
import { revalidatePath } from "next/cache";
import { withUser, assertId } from "@/lib/action-utils";
import { validateDeck } from "@/lib/decks/validate";
import { isGameSlug, type GameSlug, type ValidationError, type Zone, ZONES } from "@/lib/decks/types";
import * as D from "@/lib/decks/data";

function assertLines(gameSlug: GameSlug, lines: D.DeckLineInput[]): D.DeckLineInput[] {
  const zones = ZONES[gameSlug] as readonly string[];
  return lines.map((l) => {
    if (!zones.includes(l.zone)) throw new Error(`Zone "${l.zone}" is not used by this game`);
    return { cardId: assertId(l.cardId), zone: l.zone as Zone, quantity: assertId(l.quantity) };
  });
}

export async function createDeckAction(gameSlug: string, name: string) {
  const r = await withUser(async (u) => {
    if (!isGameSlug(gameSlug)) throw new Error("Unknown game");
    return D.createDeck(u, { gameSlug, name });
  });
  if (r.ok) revalidatePath("/decks/mine");
  return r;
}

export async function renameDeckAction(id: number, name: string) {
  const r = await withUser(async (u) => {
    if (!(await D.renameDeck(u, assertId(id), name))) throw new Error("Deck not found");
  });
  if (r.ok) { revalidatePath("/decks/mine"); revalidatePath(`/decks/mine/${id}`); }
  return r;
}

export async function deleteDeckAction(id: number) {
  const r = await withUser(async (u) => {
    if (!(await D.deleteDeck(u, assertId(id)))) throw new Error("Deck not found");
  });
  if (r.ok) revalidatePath("/decks/mine");
  return r;
}

/** Replaces the deck's lines and records whether it is legal. Returns the authoritative verdict. */
export async function saveDeckAction(id: number, lines: D.DeckLineInput[]) {
  const r = await withUser<{ valid: boolean; errors: ValidationError[] }>(async (u) => {
    const deckId = assertId(id);
    const deck = await D.getDeck(deckId, u);
    if (!deck || deck.isMeta) throw new Error("Deck not found");
    const checked = assertLines(deck.gameSlug, lines);
    const cards = await D.loadDeckCardInputs(checked);
    const { valid, errors } = validateDeck({ gameSlug: deck.gameSlug, cards });
    await D.saveDeckCards(u, deckId, checked, !valid);
    return { valid, errors };
  });
  if (r.ok) { revalidatePath(`/decks/mine/${id}`); revalidatePath("/decks/mine"); }
  return r;
}

/** Copies a meta deck (or one of your own) into a new personal deck; returns the new deck's id. */
export async function copyDeckAction(sourceId: number) {
  const r = await withUser(async (u) => {
    const source = await D.getDeck(assertId(sourceId), u);
    if (!source) throw new Error("Deck not found");
    const newId = await D.createDeck(u, { gameSlug: source.gameSlug, name: `${source.name} (copy)`.slice(0, 80) });
    const lines = source.cards.map((l) => ({ cardId: l.cardId, zone: l.zone, quantity: l.quantity }));
    const cards = await D.loadDeckCardInputs(lines);
    const { valid } = validateDeck({ gameSlug: source.gameSlug, cards });
    await D.saveDeckCards(u, newId, lines, !valid);
    return newId;
  });
  if (r.ok) revalidatePath("/decks/mine");
  return r;
}
```

`tests/decks-actions.test.ts` (mock `@/lib/session` and `next/cache` exactly as `tests/actions.test.ts`
does): no session → every action `{ ok: false, error: "Not signed in" }`; bad ids → `"Invalid id"`;
create with an unknown game → `"Unknown game"`; create + rename + delete round-trip for the owner, and
each refused for another user with `"Deck not found"`; `saveDeckAction` on a **meta** deck →
`"Deck not found"` (a user must not edit curated lists); a save of a legal Pokémon 60 → `{ valid: true }`
and `is_draft = 0` in the row; a save of 59 → `valid: false`, errors mention 59, `is_draft = 1`;
a save whose lines claim a wrong zone → `{ ok: false }`; `copyDeckAction` on a meta deck creates a deck
named `"… (copy)"` owned by the caller with the same lines, leaves the source untouched, and returns the
new id; `copyDeckAction` on someone else's personal deck → `"Deck not found"`.

- [x] **Step 7: my-decks list** — `app/(app)/decks/mine/page.tsx` (Server Component):

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listGames } from "@/lib/catalog";
import { listMyDecks } from "@/lib/decks/data";
import { SectionHeading, Panel, Button, EmptyState } from "@/components/ui";
import NewDeckForm from "./NewDeckForm";
import DeckActions from "./DeckActions";

export const metadata = { title: "My decks — Hitstreak" };
export const dynamic = "force-dynamic";

export default async function MyDecksPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const [decks, games] = await Promise.all([listMyDecks(session.user.id), listGames()]);
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        as="h1"
        title="My decks"
        caption={`${decks.length} deck${decks.length === 1 ? "" : "s"}`}
        trailing={<Button href="/decks" variant="secondary" size="sm">Meta decks</Button>}
      />
      {decks.length === 0 ? (
        <EmptyState title="No decks yet" body="Start one below, or copy a meta deck from the browser." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {decks.map((d) => (
            <Panel key={d.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/decks/mine/${d.id}`} className="font-semibold text-ink">{d.name}</Link>
                <span className="text-[13px] text-dim">{d.gameName}</span>
              </div>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="num text-muted">{d.cardCount} card{d.cardCount === 1 ? "" : "s"}</span>
                <span className={d.isDraft ? "text-accent" : "text-gain"}>{d.isDraft ? "Draft" : "Legal"}</span>
              </div>
              <DeckActions id={d.id} name={d.name} />
            </Panel>
          ))}
        </div>
      )}
      <Panel><NewDeckForm games={games.map((g) => ({ slug: g.slug, name: g.name }))} /></Panel>
    </div>
  );
}
```

`NewDeckForm.tsx` (client): game `Pill`s (default the first), an `Input` for the name, a `Button`
"Create deck"; on success `router.push(\`/decks/mine/${id}\`)`. `DeckActions.tsx` (client): a "Rename"
toggle that swaps in an `Input` + Save (like `PortfolioForm`'s `RenameToggle`), and a "Delete" `Button`
guarded by `window.confirm(\`Delete "${name}"?\`)`; both `router.refresh()` on success and render
`role="alert"` text on failure. Both use `size="sm"`.

`tests/ui/new-deck-form.test.tsx`: renders one pill per game with the first selected; typing a name and
clicking Create calls `createDeckAction("pokemon", "Zard")` and pushes `/decks/mine/12`; a second pill
switches the game passed to the action; an action error renders an alert and does not navigate; Create
is disabled while the name is blank.

- [x] **Step 8: the builder** — `app/(app)/decks/mine/[id]/page.tsx` (server: loads and gates) plus
  `Builder.tsx` (client: all interaction).

```tsx
// app/(app)/decks/mine/[id]/page.tsx
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { getDeck } from "@/lib/decks/data";
import { loadOwnedByKey } from "@/lib/decks/gap";
import Builder from "./Builder";

export const dynamic = "force-dynamic";

const load = cache(async (id: string) => {
  const deckId = parseRouteId(id);
  if (deckId == null) notFound();
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const deck = await getDeck(deckId, session.user.id);
  // Curated decks are read-only: copy one first (see /decks/[id]).
  if (!deck || deck.isMeta) notFound();
  return { userId: session.user.id, deck };
});

export async function generateMetadata({ params }: PageProps<"/decks/mine/[id]">) {
  const { id } = await params;
  const { deck } = await load(id);
  return { title: `${deck.name} — Hitstreak` };
}

export default async function BuilderPage({ params }: PageProps<"/decks/mine/[id]">) {
  const { id } = await params;
  const { userId, deck } = await load(id);
  const owned = await loadOwnedByKey(userId, deck.gameSlug);
  return <Builder deck={deck} owned={Object.fromEntries(owned)} />;
}
```

`Builder.tsx` — `"use client"`, props `{ deck: DeckDetail; owned: Record<string, number> }`:

- State: `lines: DeckLine[]` (seeded from `deck.cards`), `q`, `busy`, `error`, `saved: "clean" | "dirty" | ValidationResult`.
- Search: `const { hits, settled, error: searchError } = useCardSearch(q, true, deck.gameSlug)`.
  Each hit row is a `CardRow` with `subtitle` = `${setName} · ${number ?? "—"} · own ${ownedOf(hit)} · ${formatMoney(cheapest(hit.printings))}` and an `onClick` that adds it.
- `add(hit)`: `zone = defaultZone(deck.gameSlug, hit)`; build the line from the hit
  (`market` = cheapest non-null `printings[].market`); if `isSingleCardZone(zone)` replace whatever is in
  that zone; else bump the existing `(cardId, zone)` line's quantity (cap 99) or append it.
- `setQuantity(line, n)`: `n <= 0` removes the line; single-card zones stay at 1.
- Layout: three columns from `md` up (`md:grid-cols-[280px_minmax(0,1fr)_300px]`), stacked on phones —
  search, deck, legality. The deck column groups lines by `ZONES[deck.gameSlug]`, each group headed by
  `ZONE_LABEL[zone]` and its subtotal (the uppercase group label, same as the browser page), rows showing
  `×N`, name, set · number, `own N` (gain when covered, accent when short) and the line's market.
- Legality panel: `<ValidationList items={validationItems({ gameSlug: deck.gameSlug, cards: lines.map(toCardInput) })} />`
  where `toCardInput` maps a line to `{ cardId, name, zone, quantity, attrs, rarity }`.
- Cost panel: `analyzeGap({ gameSlug: deck.gameSlug, cards: lines }, new Map(Object.entries(owned)))` →
  three `StatTile`s (Cards, You own `owned / total`, Cost to complete).
- Save: a `Button` in the header calls `saveDeckAction(deck.id, lines.map(({cardId, zone, quantity}) => ({cardId, zone, quantity})))`;
  on `{ ok: true }` store the returned verdict and show "Saved · legal" or "Saved as draft" (the client's
  own live validation is advisory; the server's verdict is what the header reports), then `router.refresh()`.
  On `{ ok: false }` render the error with `role="alert"`. The button is disabled while `busy`.
- A "← My decks" back link, the deck name as `SectionHeading`, and `{game} · {format ?? "no format"}` as caption.

`tests/ui/builder.test.tsx` (mock `@/app/(app)/decks/actions`, `next/navigation`, and `fetch` for the
search, as `tests/ui/add-item-dialog.test.tsx` does): renders the existing lines grouped by zone with
subtotals; searching and clicking a hit adds it to the right zone (a Riftbound `Rune` hit lands under
Runes, a One Piece `Leader` hit replaces the leader slot); `+` bumps and `−` at 1 removes; the legality
list shows a failing rule's concrete message and flips to `ok` when the deck is fixed; Save calls
`saveDeckAction` with the current lines and shows "Saved as draft" when the server says
`valid: false`; an action error renders an alert and does not clear the dirty state.

- [x] **Step 9: the two links.**
  - `app/(app)/decks/page.tsx`: pass `trailing={<Button href="/decks/mine" variant="secondary" size="sm">My decks</Button>}` to the `SectionHeading`.
  - `app/(app)/decks/[id]/page.tsx`: render `<CopyDeckButton sourceId={deck.id} />` next to the heading when
    `deck.isMeta`. `CopyDeckButton.tsx` (client) calls `copyDeckAction(sourceId)` and pushes
    `/decks/mine/${id}` on success, with `role="alert"` on failure — this is the mockup's
    "Copy to my decks" and "Open in builder" in one control.
  - `docs/design/README.md` "Implemented as": add `Deck builder zone group → the shared uppercase group
    label (GroupLabel candidate, §13)` only if a new pattern appears; otherwise leave it.

- [x] **Step 10:** `npm test`, `npm run typecheck`, `npm run lint` all green. **Commit** —
  `feat(decks): personal deck builder with live legality, my-decks list, copy from a meta deck`

---

### Task 8: Admin curation

**Files:** create `app/(app)/admin/decks/page.tsx`, `app/(app)/admin/decks/actions.ts`, `app/(app)/admin/decks/CurationForm.tsx`, `app/(app)/admin/decks/MetaDeckRow.tsx`, `tests/decks-admin-actions.test.ts`, `tests/ui/curation-form.test.tsx`; modify `lib/decks/data.ts`, `lib/decks/resolve.ts`, `proxy.ts`, `tests/proxy.test.ts`, `tests/decks-resolve.test.ts`, `tests/ui/deck-pages.test.tsx`, `app/(app)/decks/page.tsx`, `README.md`

The screen is the CLI's flow with a fix-up step: paste a list → resolve it against the catalog → pick a
card for anything ambiguous → fill in the metadata → save. It lives under `app/(app)/` so it inherits the
shell and the session gate; **admin-ness is checked in the page and in every action**, and a non-admin
gets `notFound()` rather than a redirect — the route should not advertise itself.

- [x] **Step 1: `deleteMetaDeck`** in `lib/decks/data.ts` (admin-only, mirrors `deleteDeck`'s shape but
  scoped to curated rows):

```ts
/** Admin only. Removes a curated deck and its lines. Personal decks are untouched (deleteDeck owns those). */
export async function deleteMetaDeck(adminUserId: string, id: number): Promise<boolean> {
  if (!(await isAdminUser(adminUserId))) throw new Error("Only an admin can curate meta decks");
  const c = await db();
  const found = await c.execute({ sql: "SELECT 1 FROM decks WHERE id = ? AND owner_user_id IS NULL", args: [id] });
  if (found.rows.length === 0) return false;
  await c.batch(
    [
      { sql: "DELETE FROM deck_cards WHERE deck_id = ?", args: [id] },
      { sql: "DELETE FROM decks WHERE id = ? AND owner_user_id IS NULL", args: [id] },
    ],
    "write"
  );
  return true;
}
```

Add to `tests/decks-data.test.ts`: a non-admin call rejects with `/admin/i` and leaves the deck; an admin
delete returns `true`, removes the row and its `deck_cards`; deleting a **personal** deck's id through
this path returns `false` and leaves it intact; deleting a missing id returns `false`.

- [x] **Step 2: `formatDecklist`** in `lib/decks/resolve.ts` — the inverse of `parseDecklist`, so "Edit"
  can round-trip an existing deck back through the same paste → resolve path:

```ts
/** Renders a deck as text `parseDecklist` can read back: one `N Name` line per deck line, grouped under
 *  the zone headers the parser recognises. Only zones the game uses appear. */
export function formatDecklist(deck: { gameSlug: GameSlug; cards: Array<{ zone: Zone; quantity: number; name: string }> }): string {
  const out: string[] = [];
  for (const zone of ZONES[deck.gameSlug]) {
    const lines = deck.cards.filter((l) => l.zone === zone);
    if (lines.length === 0) continue;
    if (ZONES[deck.gameSlug].length > 1) out.push(`${ZONE_HEADER[zone]}:`);
    for (const l of lines) out.push(`${l.quantity} ${l.name}`);
    out.push("");
  }
  return out.join("\n").trim();
}
```

with `const ZONE_HEADER: Record<Zone, string> = { main: "Main", leader: "Leader", legend: "Legend", champion: "Champion", rune: "Runes", battlefield: "Battlefields" }`
— these must be strings `parseDecklist`'s header alternation already accepts, so import `ZONES` and `Zone`
from `./types`. A single-zone game (Pokémon) gets no headers at all.

Add to `tests/decks-resolve.test.ts` a round-trip: build the fixture Pokémon deck's lines, `formatDecklist`
them, `parseDecklist` the result, `resolveDecklist` it, and assert `mergeResolved` gives back the same
`(cardId, zone, quantity)` set. Do the same for a One Piece deck with a leader, so the headers are exercised.
(Note the honest limitation in a comment: a card whose **name** now resolves to a cheaper printing comes
back as that printing's card id. Round-tripping is for editing a list, not for preserving printings.)

- [x] **Step 3: proxy.** Add `"/admin"` to `PROTECTED` in `proxy.ts`, and a case to `tests/proxy.test.ts`:
  `/admin/decks` without a cookie → 307 to `/sign-in?next=%2Fadmin%2Fdecks`.

- [x] **Step 4: actions** — `app/(app)/admin/decks/actions.ts`:

```ts
"use server";
// Meta-deck curation. Every action re-checks the session AND admin-ness: `withUser` only proves someone
// is signed in, so each body calls isAdminUser before touching a curated row. Failures come back as
// { ok: false, error } like every other action module.
import { revalidatePath } from "next/cache";
import { withUser, assertId } from "@/lib/action-utils";
import { isGameSlug, type GameSlug } from "@/lib/decks/types";
import { parseDecklist, resolveDecklist, type Resolution } from "@/lib/decks/resolve";
import * as D from "@/lib/decks/data";

const TEXT_MAX = 20_000; // a decklist is a few hundred bytes; this is the "someone pasted a book" guard

async function assertAdmin(userId: string) {
  if (!(await D.isAdminUser(userId))) throw new Error("Admins only");
}

/** Paste → parsed lines resolved against the catalog. A read, but admin-gated like the rest of the screen. */
export async function resolveDecklistAction(gameSlug: string, text: string) {
  return withUser<Resolution[]>(async (u) => {
    await assertAdmin(u);
    if (!isGameSlug(gameSlug)) throw new Error("Unknown game");
    if (typeof text !== "string" || text.length > TEXT_MAX) throw new Error("That list is too long");
    return resolveDecklist(gameSlug, parseDecklist(text, gameSlug));
  });
}

export interface SaveMetaDeckInput {
  id?: number; gameSlug: string; name: string; archetype?: string | null; tier?: number | null;
  format?: string | null; sourceNote?: string | null; lines: D.DeckLineInput[];
}

export async function saveMetaDeckAction(input: SaveMetaDeckInput) {
  const r = await withUser(async (u) => {
    await assertAdmin(u);
    if (!isGameSlug(input.gameSlug)) throw new Error("Unknown game");
    const lines = input.lines.map((l) => ({ cardId: assertId(l.cardId), zone: l.zone, quantity: assertId(l.quantity) }));
    return D.upsertMetaDeck(u, { ...input, id: input.id == null ? undefined : assertId(input.id), gameSlug: input.gameSlug as GameSlug, lines });
  });
  if (r.ok) { revalidatePath("/admin/decks"); revalidatePath("/decks"); }
  return r;
}

export async function deleteMetaDeckAction(id: number) {
  const r = await withUser(async (u) => {
    await assertAdmin(u);
    if (!(await D.deleteMetaDeck(u, assertId(id)))) throw new Error("Deck not found");
  });
  if (r.ok) { revalidatePath("/admin/decks"); revalidatePath("/decks"); }
  return r;
}
```

**Note on quantities:** `assertId` is a positive-integer check with no ceiling; `upsertMetaDeck` →
`checkLines` applies `QTY_MAX`, and unlike the builder's save nothing expensive runs before it (no
validator), so this is adequate. If you prefer symmetry with `app/(app)/decks/actions.ts`, reuse the same
`assertQuantity` helper — lift it into `lib/action-utils.ts` and have both modules import it.

`tests/decks-admin-actions.test.ts` (mock `@/lib/session` and `next/cache` as `tests/actions.test.ts`
does; seed an admin and a non-admin user): every action refused with `"Not signed in"` when there is no
session, and `"Admins only"` for a signed-in non-admin (assert the DB is unchanged after the refused
delete); `resolveDecklistAction` returns one resolution per parsed line with `cardId` set for an exact
name and `null` + candidates for an ambiguous one; an over-long paste is refused; `saveMetaDeckAction`
creates a deck and returns its id, then updates it in place when `id` is passed (lines replaced, not
appended); a bad game or a non-integer line id is refused; `deleteMetaDeckAction` removes the deck and its
lines, returns `"Deck not found"` for a personal deck's id, and revalidates both paths.

- [x] **Step 5: the page** — `app/(app)/admin/decks/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listGames } from "@/lib/catalog";
import { isAdminUser, listMetaDecks, getDeck } from "@/lib/decks/data";
import { formatDecklist } from "@/lib/decks/resolve";
import { GAME_SLUGS } from "@/lib/decks/types";
import { SectionHeading, Panel, EmptyState } from "@/components/ui";
import CurationForm from "./CurationForm";
import MetaDeckRow from "./MetaDeckRow";

export const metadata = { title: "Curate meta decks — Hitstreak" };
export const dynamic = "force-dynamic";

export default async function AdminDecksPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  // Not a redirect: a non-admin should not learn that this route exists.
  if (!(await isAdminUser(session.user.id))) notFound();

  const games = await listGames();
  const perGame = await Promise.all(GAME_SLUGS.map(async (slug) => ({ slug, decks: await listMetaDecks(slug) })));
  const all = perGame.flatMap((g) => g.decks);
  // Each row can hand the form its current list to edit.
  const texts = Object.fromEntries(
    await Promise.all(all.map(async (d) => {
      const full = await getDeck(d.id, null);
      return [d.id, full ? formatDecklist(full) : ""] as const;
    }))
  );

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading as="h1" title="Curate meta decks" caption={`${all.length} curated`} />
      <Panel>
        <CurationForm games={games.map((g) => ({ slug: g.slug, name: g.name }))} />
      </Panel>
      {all.length === 0 ? (
        <EmptyState title="Nothing curated yet" body="Paste a decklist above, or use scripts/import-deck.mts." />
      ) : (
        <div className="flex flex-col gap-3">
          {perGame.filter((g) => g.decks.length > 0).map((g) => (
            <div key={g.slug} className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                {games.find((x) => x.slug === g.slug)?.name ?? g.slug}
              </span>
              {g.decks.map((d) => <MetaDeckRow key={d.id} deck={d} decklist={texts[d.id] ?? ""} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

`MetaDeckRow.tsx` (client): a `Panel` with the deck's name, tier, card count and game; an "Edit" `Button`
(`size="sm"`) that dispatches a `CustomEvent("hitstreak:edit-deck", { detail })` on `window` carrying
`{ id, gameSlug, name, archetype, tier, format, sourceNote, decklist }`, which `CurationForm` listens for
and loads (a plain event keeps the two siblings decoupled without lifting state into the server page); and
a "Delete" `Button` guarded by `window.confirm(\`Delete "${name}"?\`)` calling `deleteMetaDeckAction`,
then `router.refresh()`. Errors render with `role="alert"`.

- [x] **Step 6: `CurationForm.tsx`** (client) — the paste → resolve → fix-up → save flow:

- State: `gameSlug`, `name`, `archetype`, `tier` (`"" | "1".."4"`), `format`, `sourceNote`, `text`,
  `editingId: number | null`, `resolutions: Resolution[] | null`, `picks: Record<number, number>`
  (resolution index → chosen cardId), `busy`, `error`, `notice`.
- Game `Pill`s; `Input`s for name/archetype/format/source; tier as `Pill`s (`—`, 1, 2, 3, 4); a
  `<textarea>` for the list carrying the same field classes as `Input` (`components/ui/Input.tsx` is the
  one place those live — reuse the string by exporting it, or wrap the textarea in a small local component
  with the same classes and say why in a comment).
- **Resolve**: `resolveDecklistAction(gameSlug, text)` → `setResolutions(data)`, `setPicks({})`.
- **Fix-up list**: one row per resolution. Resolved (`cardId != null` or picked) shows `×qty name` and a
  ✓-toned caption; unresolved shows the raw line, its `candidates` as `Pill`s (clicking sets `picks[i]`),
  and — when there are no candidates or none fit — a `SearchField` + `useCardSearch(q, true, gameSlug)`
  whose hits are `CardRow`s that also set `picks[i]`. A row's zone is shown when the game has more than
  one zone.
- **Save** is disabled until every resolution has a cardId (its own or a pick). It calls
  `saveMetaDeckAction({ id: editingId ?? undefined, gameSlug, name, archetype, tier, format, sourceNote, lines })`
  where `lines` merges the resolutions by `(cardId, zone)` summing quantities — reuse `mergeResolved` by
  first applying the picks (`resolutions.map((r, i) => picks[i] ? { ...r, cardId: picks[i] } : r)`), so the
  client and the CLI share one merge. On success: `setNotice("Saved")`, clear the form (or keep the
  metadata when editing), `router.refresh()`.
- Listens for the `hitstreak:edit-deck` event in a `useEffect` (add/remove listener; no state set during
  render) and loads the payload into the fields, setting `editingId`. A "Stop editing" `Button` clears it.

`tests/ui/curation-form.test.tsx` (mock `./actions` and `next/navigation`; stub `fetch` for the search):
pasting a list and clicking Resolve calls `resolveDecklistAction("pokemon", text)` and renders one row per
line; an unresolved row shows its candidates and Save stays disabled; clicking a candidate enables Save;
Save calls `saveMetaDeckAction` with the merged lines (two lines of the same card summed) and the metadata
from the fields; an action error renders an alert and Save stays available; switching the game pill before
resolving passes the new slug; the `hitstreak:edit-deck` event fills the fields and sets the id that Save
sends.

- [x] **Step 7: the way in.** On `app/(app)/decks/page.tsx`, the `SectionHeading`'s `trailing` already
  holds "My decks"; add an admin-only "Curate" `Button href="/admin/decks"` beside it — the page is a
  Server Component, so gate it on `await isAdminUser(session.user.id)` and render nothing for everyone
  else. Add a page-level test to `tests/ui/deck-pages.test.tsx`: `/admin/decks` renders for an admin, is
  `notFound` for a signed-in non-admin, and the "Curate" link appears on `/decks` only for an admin.

- [x] **Step 8: docs.** README "Curating meta decks locally" gains a sentence: the same flow is available
  in the app at `/admin/decks` for a user with `isAdmin = 1`, and the CLI remains the scriptable path.

- [x] **Step 9:** `npm test`, `npm run typecheck`, `npm run lint` all green. **Commit** —
  `feat(decks): admin meta-deck curation — paste, resolve, fix up, save`

---

### Task 9: Docs, spec amendments, deviations, final review, merge

README (Screens: `/decks`, `/decks/[id]`, curation CLI), spec §8 amendment (Pokémon Standard legality not validated — no marks in data; Riftbound rules as verified; One Piece colour = share-one), §13 follow-ups, plan checkboxes + deviations, whole-branch review, merge.

**Executed 2026-09-09 from that outline as an inline brief — no written step list, so there are no checkboxes here.** It shipped as `32134c4` (README + spec §8/§13 + this plan's deviations) and `92095b0` (the `scripts/import-deck.mts` leaf-module import fix and its guard test), with the whole-branch review and its fixes following.

## Self-review notes

- Spec coverage for Tasks 1–6: §5 decks/deck_cards ✔ (T1), gap analysis at read time ✔ (T5), §7 meta browser (game + tier filters → detail with decklist, gap, cost-to-complete) ✔ (T6), §8 validator contract + three rule sets ✔ (T2–T4; Standard-format legality deliberately absent — amendment), §10 validator unit tests happy path + every violation ✔, gap math ✔. Builder/admin are T7/T8 (not this run).
- Type consistency: `Zone`/`ZONES`/`GameSlug`/`DeckCardInput` from `lib/decks/types` used by rules, data, gap, pages; `DeckDetail`/`DeckLine` from `data.ts` used by `gap.ts` and pages; `card()` fixture builder in `tests/helpers/decks.ts` used by all three rule test files; `identityKey` is the single definition of "same card" for copies (rules) and ownership (gap).
- Ownership: meta decks readable with `userId` null or any user, writable only via `isAdminUser`; personal decks scoped by `owner_user_id` on every read/write; `loadOwnedByKey` joins `portfolios.user_id`.

## Executed 2026-09-09 — deviations

Shipped on `phase-4/decks` across Tasks 1–9 (`6d2ee93` … the Task 9 docs commit `32134c4`, then the
pre-merge review's fixes); `npm test` is 469 tests in 62 files. Where the code differs from the plan above:

- **Deck fixtures derive their ids.** `tests/helpers/decks.ts` inserts every row with `RETURNING id`
  (or looks it up by its TCGplayer key) and hands back `games` / `sets` / `cards` / `printings` maps
  instead of the plan's hard-coded literals: `seedMiniCatalog()` owns the rows underneath and its ids
  are not stable across suites. Tests use the map, never a literal id.
- **`baseName` strips more printing shapes than the plan listed.** Beyond `" - 191/198"` it also has to
  handle gallery/promo numbers (`"- TG05/TG30"`), slash-less promos (`"- 054"`) and set-code-prefixed
  energies (`"- MEE 001"`), while leaving product names such as `"Code Card - 151 Booster Pack"` alone.
  The Pokémon basic-energy predicate additionally tests the head segment of a `" - "` split, because
  `baseName` deliberately does not treat the set-code shape as a suffix everywhere.
- **Deck-line writes are one atomic batch, and meta-deck creation is a transaction.** `replaceLines`
  sends `DELETE` + every `INSERT` + the `updated_at` / `is_draft` `UPDATE` as a single `"write"` batch, so
  a deck is never briefly empty; `upsertMetaDeck`'s create path needs the new id for its lines, so
  `INSERT … RETURNING id` and the line batch run in one interactive write transaction and a failed line
  write rolls the deck row back.
- **A `MAX_LINES` cap (200) was added.** The plan bounded quantities but not line count; without it a
  paste is an unbounded write batch. It lives in `lib/decks/types.ts` rather than `data.ts` (as does
  `QTY_MAX`) so the client bundle and the curation action can both have it — see the Task 8 bullets below.
- **Every rule applies across zones, and a mis-zoned card gets its own `zone` error.** The plan's own
  Pokémon test demanded that the 60-card count include a card sitting in a zone Pokémon does not use, so
  all three rule sets settled on the same shape: a mis-zoned card is flagged *and* still counts toward
  size, copies, colour/domain and the ACE SPEC / Radiant limits. It is a real card in the deck; dropping
  it would hide the error the user needs to see.
- **The Pokémon predicates read the data, not a type whitelist.** tcgcsv's `Card Type` on a Pokémon is
  usually its energy type but is also `"Dark"`, `"Normal"`, typos (`"Lighnting"`), dual types, and NULL
  on ~270 cards that still carry HP and Stage. So `isPokemon` is "HP > 0 and not typed
  Trainer/Item/Supporter/Stadium/Tool/Energy", `Stage` is compared case-insensitively (one card is
  `"bASIC"`), and `isBasicEnergy` accepts `"Basic <Type> Energy"`, legacy `"Energy"` and untyped rows via
  a name fallback while excluding `"… Energy (Special)"`.
- **One Piece: a colourless Leader checks nothing.** Three alt-art Leaders carry no `Color`; failing the
  whole deck against an empty identity would be wrong, so the colour rule is skipped rather than failed.
  DON!! cards are rejected wherever they appear (`zone`), and the plan's mono-Leader assertion of 6
  colour errors is 5 — the plan counted a dual-colour card that legitimately shares the Leader's colour.
  A fixture `Nami` also had to move to `OP01-116`: at `OP01-016` it collided with the helper's existing
  `Nami` stack and the copies count came out of the wrong bucket.
- **Riftbound: Battlefields are inside the domain check, and tokens are rejected in every single-card
  zone.** Core Rules 103.4.b makes Battlefields "subject to Domain Identity if applicable"; all 71 in
  today's catalog are colourless so the check is a no-op, but it is written for the day one is not.
  Wrong-typed runes and battlefields get one message per card rather than a single count, and because
  the catalog types tokens as `"Unit;Token"` / `"Battlefield;Token"` / `"Gear;Battlefield;Token"`, the
  type alone is not enough: a token in the legend / champion / rune / battlefield slot is named as a
  token. The plan's Signature fixture (4 copies of one name) also tripped `copies`, so it became 3 + 1
  across two names to isolate the `signature` error.
- **Decklist parsing needed a tighter header rule and a wider prefilter.** A section header is the header
  word alone on its line (optionally `":"` / `"("` plus a count), otherwise `"Energy Retrieval"` is
  swallowed as an `Energy` header. One Piece `Character` / `Event` / `Stage` sections all map to the main
  deck. The exact-match prefilter's `LIMIT` went from the plan's 50 to 500, because `LIKE 'Pikachu%'`
  pulls 300+ `Pikachu ex` / `Pikachu V` rows before the exact `baseName` comparison happens in JS.
- **`mergeResolved` sums duplicate printings of one card.** PTCGL exports list one line per printing
  (`3 Charmander MEW 4` + `1 Charmander PAF 7`), both resolve to the same card, and `checkLines` would
  otherwise reject the pair as a duplicate line.
- **A bare One Piece name spanning several card numbers returns candidates.** Identity there is
  `attrs.Number`, and `"Nami"` is `OP01-016`, `OP10-013` and more; silently taking the cheapest would
  pick the wrong card, so the resolver hands back one candidate per Number and a human picks.
- **The CLI prints `e.message`, not a stack, and closes the DB on every exit path** (the error path
  included), so a bad `--as` or an unresolved line reads as a sentence.
- **Task 6's manual browser check became a kept test.** The dev server on :3000 is the user's and no
  credentials may be typed into it, so `tests/ui/deck-pages.test.tsx` renders the real page components
  (browser, detail, my-decks, builder, admin) as an end-to-end jsdom test against a seeded throwaway DB.
  It grew with Tasks 7 and 8 and now also seeds a second user with `isAdmin = 0`, so the `/admin/decks`
  404 case exercises a real signed-in non-admin rather than a missing user row.
- **`validationItems` needed an explicit return annotation.** The plan's snippet did not typecheck: with
  a bare `flatMap`, TypeScript takes the first branch's `ok: true[]` as the callback's whole return type.
  The plan's docstring also claimed failures were appended after the passing rules; the code keeps
  `RULE_TEXT` order and replaces a broken rule in place with its concrete errors, which is what the
  builder's panel wants.
- **`setQuantity` matches on `(cardId, zone)`, not object identity** — the builder rebuilds its line
  objects on every edit, so identity is not stable across renders.
- **`defaultZone` takes the deck's current lines.** Riftbound Champion Units are legal in the main deck
  alongside the Chosen Champion; routing every one of them to the single-card `champion` zone would
  silently replace the chosen one, so the first goes to `champion` and later ones to `main`.
- **The db-free guard test strips `import type` lines** before matching: type-only imports are erased at
  build time and are how the client-safe deck modules reference `DeckLine` / `DeckLineInput`. The
  search-route attrs test inserts its own card, because `seedMiniCatalog()`'s rows all carry `attrs: '{}'`.
- **Task 8 split `lib/decks/decklist.ts` out of `resolve.ts`.** `parseDecklist` / `formatDecklist` /
  `mergeResolved` and the line types are db-free and the curation form (`"use client"`) needs the merge,
  so they moved to a leaf module re-exported by `resolve.ts` — the same shape as `gap.ts` → `gap-math.ts`
  and `lib/history.ts` → `lib/ranges.ts`. **This broke `scripts/import-deck.mts`**, which still imported
  those names from `@/lib/decks/resolve`; fixed in Task 9 — see the CLI bullet below.
- **Two primitives and two shared helpers came out of Task 8.** A `Textarea` primitive was added and
  `h-11` was lifted out of `Input`'s shared `field` string so both can use the same skin; `assertQuantity`
  and `assertOptionalText` were lifted into `lib/action-utils.ts` for both action modules.
- **"Edit" travels as a `CustomEvent`.** `MetaDeckRow` and `CurationForm` are sibling client islands under
  a Server Component page, so the hand-off is a `hitstreak:edit-deck` window event whose name and payload
  type live in `app/(app)/admin/decks/edit-event.ts` — neither island imports the other and the page stays
  a Server Component.
- **The CLI's leaf-module import, and a guard test for it** *(Task 9, `92095b0`)*. Task 8's split left
  `scripts/import-deck.mts` importing `parseDecklist` / `mergeResolved` from `@/lib/decks/resolve`, and
  tsx's strict-ESM path for a `.mts` entry point does not see `export *` re-exports: the script died with
  "does not provide an export named 'mergeResolved'" before it ran. Product code, the bundler and
  `npx tsx -e` all resolve those re-exports fine — which is why nothing caught it. The imports now name
  `@/lib/decks/decklist`, and `tests/ranges.test.ts` gained a "scripts/*.mts import the pure decklist
  helpers from the leaf module" case that fails if any `scripts/*.mts` reaches through a re-export again.
- **The curation paste is bounded before it is resolved.** `resolveDecklistAction` caps the raw text at
  20 KB *and* the parsed line count at `MAX_LINES`: 20 KB of `"1 x"` lines is ~5,000 lines and up to
  ~10,000 sequential catalog queries held open in one server action. `assertOptionalText` caps archetype,
  format and source note at 200 characters, which the plan left unbounded.

### Known items, deliberately left

Also recorded in spec §13.

- The resolver picks the cheapest printing, so World Championship replica sets win: "Rare Candy" resolves
  to `Rare Candy - 2025 (Riley McKay)` (World Championship Decks, $0.11) ahead of every playable printing,
  and the same `MIN(market)` drives cost-to-complete.
- A few Riftbound alt arts carry no `Card Type` / `Domain` / `Tag` attrs at all (8 in today's catalog,
  e.g. `Ornn, Blacksmith (Alternate Art)`), so a deck line pointing at one validates as "unknown type".
  The resolver should prefer an attr-bearing printing of the same card.
- Decklist shapes still unparsed: PTCGL energy shorthand (`4 Basic {F} Energy SVE 2`), bare-number tails
  (`3 Fire Energy 12`), and OPTCGSim's `4xOP01-016` with no space after the `x`.
- `formatDecklist` emits names only, so editing a One Piece deck re-ambiguates every card whose name spans
  several numbers. Emitting `attrs.Number` for One Piece would fix it.
- N+1 reads: `/decks` runs `getDeck` per curated deck; `/admin/decks` does the same *and* ships every
  deck's formatted decklist to the browser; `resolveDecklist` runs up to two queries per line (bounded by
  `MAX_LINES`). Curated lists are a handful of decks today.
- `/decks` costs one extra `isAdminUser` query per page load, for every user, only to decide whether to
  render the "Curate" link.
- The curation screen shows no legality preview and `upsertMetaDeck` does not validate: a curated deck can
  be illegal by design (a partial list, a rotated format). `/decks/[id]` is where that shows.
- `GroupLabel` (the uppercase `tracking-[0.06em]` group label) now has four sites — the alerts list, the
  decks browser, the builder's zone headers and the admin list. Promote it in Phase 5.
- `withUser` returns `e.message` verbatim, so a malformed direct action call can echo a raw `TypeError` to
  the caller. Task 7 put that on non-admin surfaces too: `saveDeckAction`, `copyDeckAction`,
  `renameDeckAction` and `deleteDeckAction` are reachable by any signed-in user. The action layer's own
  `assert*` helpers return sentences, so it only bites a call that bypasses the UI; a message allowlist
  in `withUser` would close it.
- 45 Riftbound champions (78 Champion Unit printings — Gangplank, Illaoi, Riven, Sona, Kayle, Morgana and
  39 more) have no Legend in the catalog yet, so those champions cannot currently form a legal deck. The
  validator is right; the card pool is incomplete.
- Pokémon Standard-format (regulation mark) legality is not validated at all — tcgcsv carries no
  regulation marks. See the spec §8 amendment.
