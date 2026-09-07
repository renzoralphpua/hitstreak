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
