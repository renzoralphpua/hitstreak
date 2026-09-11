// libSQL (Turso) store. Remote over HTTP in prod; a local file: URL for tests.
import { createClient, type Client } from "@libsql/client";
import {
  SCHEMA_SQL, AUTH_SCHEMA_SQL, PORTFOLIO_SCHEMA_SQL, HISTORY_SCHEMA_SQL, DECK_SCHEMA_SQL,
  LOTS_MIGRATION_SQL, needsLotsMigration,
} from "./schema";

/**
 * The one thing `CREATE TABLE IF NOT EXISTS` cannot do: drop a constraint from a table that already
 * exists. A database created before acquisitions became lots still carries
 * `UNIQUE (portfolio_id, printing_id, condition)` on `collection_items`, and while it does, a second
 * purchase of the same card at a different price is silently merged into the first at the first
 * price. Rebuilds the table once, in a transaction; a no-op on every later boot and on fresh
 * databases, which are created without the constraint.
 */
async function migrateToLots(c: Client): Promise<void> {
  const r = await c.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'collection_items'");
  if (!needsLotsMigration(r.rows[0]?.sql as string | undefined)) return;
  const tx = await c.transaction("write");
  try {
    for (const stmt of LOTS_MIGRATION_SQL) await tx.execute(stmt);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

let client: Client | null = null;
let schemaReady: Promise<unknown> | null = null;

export async function db(): Promise<Client> {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set");
    // intMode must stay the default "number": ingest/prices.ts compares REAL/INTEGER values with ===
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  if (!schemaReady) {
    // cache the promise so concurrent callers share one CREATE; reset on failure to retry
    // app tables + Better Auth's tables + portfolios/collection_items + portfolio_history/share_links/
    // price_alerts + decks/deck_cards in one pass; all IF NOT EXISTS
    const c = client;
    schemaReady = c
      .executeMultiple(SCHEMA_SQL + AUTH_SCHEMA_SQL + PORTFOLIO_SCHEMA_SQL + HISTORY_SCHEMA_SQL + DECK_SCHEMA_SQL)
      // Runs after the CREATEs so a fresh database has the table to inspect, and shares the same
      // cached promise, so concurrent callers wait for the rebuild rather than racing it.
      .then(() => migrateToLots(c))
      .catch((e) => {
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
