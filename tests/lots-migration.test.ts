// The one schema change `CREATE TABLE IF NOT EXISTS` cannot make: dropping a constraint from a
// table that already exists. A database created before acquisitions became lots still carries
// UNIQUE (portfolio_id, printing_id, condition), and while it does, a second purchase of the same
// card at a different price is merged into the first at the FIRST price. These cases prove the
// rebuild runs, preserves every row, and actually changes the behaviour.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { tmpDb } from "./helpers/tmpdb";
import { LOTS_MIGRATION_SQL, needsLotsMigration } from "@/lib/schema";

const tmp = tmpDb("lots-migration");
let c: Client;

/** `collection_items` exactly as it shipped before lots, constraint and all. */
const OLD_TABLE = `CREATE TABLE collection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL,
  printing_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  condition TEXT NOT NULL DEFAULT 'NM',
  acquired_price REAL,
  acquired_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (portfolio_id, printing_id, condition)
)`;

const tableSql = async () =>
  String(
    (await c.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'collection_items'"))
      .rows[0].sql
  );

beforeAll(async () => {
  c = createClient({ url: process.env.TURSO_DATABASE_URL! });
  // The rebuilt table declares REFERENCES portfolios(id) / printings(id), and libSQL enforces
  // foreign keys, so the copy step needs both targets to exist — as they do in a real database,
  // where the migration runs after the CREATEs.
  await c.execute("CREATE TABLE portfolios (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, name TEXT NOT NULL)");
  await c.execute("CREATE TABLE printings (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, subtype TEXT NOT NULL)");
  await c.execute("INSERT INTO portfolios (id, user_id, name) VALUES (1, 'u1', 'Main')");
  await c.execute("INSERT INTO printings (id, card_id, subtype) VALUES (10, 1, 'Normal'), (11, 2, 'Holofoil')");
  await c.execute(OLD_TABLE);
  await c.execute("CREATE INDEX idx_items_portfolio ON collection_items(portfolio_id)");
  await c.execute(
    "INSERT INTO collection_items (portfolio_id, printing_id, quantity, condition, acquired_price, acquired_date) VALUES (1, 10, 2, 'NM', 3.5, '2026-01-04')"
  );
  await c.execute(
    "INSERT INTO collection_items (portfolio_id, printing_id, quantity, condition, acquired_price) VALUES (1, 11, 1, 'LP', NULL)"
  );
});
afterAll(() => { c.close(); tmp.clean(); });

describe("needsLotsMigration", () => {
  it("recognises the pre-lots table and leaves a migrated one alone", async () => {
    expect(needsLotsMigration(await tableSql())).toBe(true);
    expect(needsLotsMigration("CREATE TABLE collection_items (id INTEGER PRIMARY KEY)")).toBe(false);
    expect(needsLotsMigration(null)).toBe(false);
    expect(needsLotsMigration(undefined)).toBe(false);
  });
});

describe("the lots rebuild", () => {
  it("drops the constraint, keeps every row, and is a no-op on a second run", async () => {
    for (const stmt of LOTS_MIGRATION_SQL) await c.execute(stmt);

    const sql = await tableSql();
    expect(needsLotsMigration(sql)).toBe(false);

    // Existing rows become each holding's first lot — ids, prices and dates all survive.
    const rows = (await c.execute("SELECT id, printing_id, quantity, condition, acquired_price, acquired_date FROM collection_items ORDER BY id")).rows;
    expect(rows.map((r) => [Number(r.id), Number(r.printing_id), Number(r.quantity), r.condition, r.acquired_price, r.acquired_date])).toEqual([
      [1, 10, 2, "NM", 3.5, "2026-01-04"],
      [2, 11, 1, "LP", null, null],
    ]);

    // The indexes went with the dropped table and have to come back.
    const idx = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'collection_items'")).rows.map((r) => String(r.name));
    expect(idx).toContain("idx_items_portfolio");
    expect(idx).toContain("idx_items_printing");

    expect(needsLotsMigration(await tableSql())).toBe(false); // a later boot skips the rebuild
  });

  it("lets the same printing and condition be bought twice at different prices", async () => {
    // The whole point: this INSERT raised a constraint error before the rebuild, which is why the
    // old code had to upsert — and its COALESCE kept the first price and discarded the second.
    await c.execute(
      "INSERT INTO collection_items (portfolio_id, printing_id, quantity, condition, acquired_price) VALUES (1, 10, 1, 'NM', 9.0)"
    );
    const r = await c.execute({
      sql: "SELECT quantity, acquired_price FROM collection_items WHERE portfolio_id = 1 AND printing_id = 10 AND condition = 'NM' ORDER BY id",
      args: [],
    });
    expect(r.rows.map((x) => [Number(x.quantity), Number(x.acquired_price)])).toEqual([[2, 3.5], [1, 9]]);
    // Cost basis is the sum over lots: 2 × 3.50 + 1 × 9.00, not 3 × 3.50.
    const total = r.rows.reduce((sum, x) => sum + Number(x.quantity) * Number(x.acquired_price), 0);
    expect(total).toBeCloseTo(16);
  });
});
