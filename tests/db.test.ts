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
