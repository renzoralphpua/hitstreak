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
  CREATE INDEX IF NOT EXISTS idx_snapshots_date ON price_snapshots(date); -- used by ingest/prices.ts (rows at a given date) and later by movers queries

  -- Current price per printing: O(1) app reads and the write-on-change diff base.
  CREATE TABLE IF NOT EXISTS latest_prices (
    printing_id INTEGER PRIMARY KEY REFERENCES printings(id),
    date TEXT NOT NULL,
    market REAL, low REAL, mid REAL, high REAL
  );
`;
