// libSQL (Turso) store. Remote over HTTP in prod; a local file: URL for tests.
import { createClient, type Client } from "@libsql/client";
import { SCHEMA_SQL, AUTH_SCHEMA_SQL, COLLECTION_SCHEMA_SQL, HISTORY_SCHEMA_SQL, DECK_SCHEMA_SQL } from "./schema";

let client: Client | null = null;
let schemaReady: Promise<unknown> | null = null;
let localPragmas: Promise<unknown> | null = null;

// file: URLs only. WAL is a property OF THE FILE (set once, every later connection inherits it) and
// lets the reader read while the writer writes; busy_timeout is per-connection and makes this one
// wait for a lock rather than throw. Neither is sent to a remote Turso, which needs neither.
const LOCAL_PRAGMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 30000;
`;

export async function db(): Promise<Client> {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set");
    // intMode must stay the default "number": ingest/prices.ts compares REAL/INTEGER values with ===
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    localPragmas = url.startsWith("file:") ? client.executeMultiple(LOCAL_PRAGMA_SQL) : null;
  }
  // Two processes share the local file in development: `next dev` and a long ingest run. Without
  // these the ingest dies mid-replay with SQLITE_BUSY the moment a page loads.
  if (localPragmas) await localPragmas;
  if (!schemaReady) {
    // cache the promise so concurrent callers share one CREATE; reset on failure to retry
    // app tables + Better Auth's tables + collections/collection_items + collection_history/share_links/
    // price_alerts + decks/deck_cards in one pass; all IF NOT EXISTS
    schemaReady = client.executeMultiple(SCHEMA_SQL + AUTH_SCHEMA_SQL + COLLECTION_SCHEMA_SQL + HISTORY_SCHEMA_SQL + DECK_SCHEMA_SQL).catch((e) => {
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
    localPragmas = null;
  }
}
