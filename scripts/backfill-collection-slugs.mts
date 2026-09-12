// scripts/backfill-collection-slugs.mts — gives every existing collection a readable URL slug.
//
// Usage (bash; PowerShell: set $env:TURSO_DATABASE_URL first):
//   TURSO_DATABASE_URL=file:hitstreak.local.db npx tsx scripts/backfill-collection-slugs.mts [--dry]
//
// Adds `collections.slug` to a database created before the column existed, then fills it. The schema
// in lib/schema.ts is the single definition (there are no migrations before v1) but CREATE TABLE IF
// NOT EXISTS cannot add a column to a table that already exists, and dropping the local database
// would take the sample collection and six months of replayed prices with it.
//
// Idempotent: a collection that already has a slug keeps it, and the ALTER is skipped when the
// column is already there. Uniqueness is per user, matching the unique index.
// A RAW client on purpose: lib/db.ts runs the schema on first connection, and that pass creates the
// unique index over collections(user_id, slug) — which cannot exist until the column does.
import { createClient } from "@libsql/client";
import { toSlug } from "@/lib/slug";

async function main(): Promise<number> {
  const dry = process.argv.includes("--dry");
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  const c = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  // A long ingest run may hold the write lock; wait for it rather than failing.
  if (url.startsWith("file:")) await c.executeMultiple("PRAGMA busy_timeout = 30000;");

  const cols = (await c.execute("PRAGMA table_info(collections)")).rows.map((r) => String(r.name));
  // --dry does not add the column, so nothing after it may assume one.
  const hasSlug = cols.includes("slug") || !dry;
  if (!cols.includes("slug")) {
    if (dry) console.log("would ALTER TABLE collections ADD COLUMN slug TEXT");
    else {
      await c.execute("ALTER TABLE collections ADD COLUMN slug TEXT");
      await c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_user_slug ON collections(user_id, slug)");
      console.log("added collections.slug and its unique index");
    }
  }

  const rows = (await c.execute(
    `SELECT id, user_id, name, ${hasSlug ? "slug" : "NULL AS slug"} FROM collections ORDER BY user_id, created_at, id`
  )).rows;
  // One namespace per user, seeded with whatever is already taken there.
  const taken = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = taken.get(String(r.user_id)) ?? new Set<string>();
    if (r.slug != null) set.add(String(r.slug));
    taken.set(String(r.user_id), set);
  }

  let filled = 0;
  for (const r of rows) {
    if (r.slug != null) continue;
    const used = taken.get(String(r.user_id))!;
    const base = toSlug(String(r.name)) || "collection";
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    filled++;
    console.log(`${dry ? "would set" : "set"} ${r.id} "${r.name}" -> ${slug}`);
    if (!dry) await c.execute({ sql: "UPDATE collections SET slug = ? WHERE id = ?", args: [slug, Number(r.id)] });
  }

  console.log(`${rows.length} collections, ${filled} ${dry ? "would be " : ""}slugged`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { console.error(e); process.exitCode = 1; });
