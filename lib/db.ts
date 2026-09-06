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
