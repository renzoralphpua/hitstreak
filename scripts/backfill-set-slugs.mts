// scripts/backfill-set-slugs.mts — gives every set a readable URL slug.
//
// Usage (bash; PowerShell: set $env:TURSO_DATABASE_URL first):
//   TURSO_DATABASE_URL=file:hitstreak.local.db npx tsx scripts/backfill-set-slugs.mts [--dry]
//
// Idempotent and additive: a set that already has a slug keeps it, because a slug is a URL and a URL
// that changes meaning is a broken link. Run it after a catalog sync brings in new sets.
import { db, closeDb } from "@/lib/db";
import { assignSlugs, toSlug, type Sluggable } from "@/lib/slug";

async function main(): Promise<number> {
  const dry = process.argv.includes("--dry");
  const c = await db();
  const rows = (await c.execute(
    `SELECT se.id, se.name, se.slug, g.slug AS game FROM sets se JOIN games g ON g.id = se.game_id ORDER BY se.id`
  )).rows;

  const sets: Sluggable[] = rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    gameSlug: String(r.game),
    slug: r.slug == null ? null : String(r.slug),
  }));

  const assigned = assignSlugs(sets);
  if (assigned.size === 0) {
    console.log(`all ${sets.length} sets already have a slug`);
    return 0;
  }

  // A slug only differs from its name when something inside the same game already took it.
  const byId = new Map(sets.map((s) => [s.id, s]));
  const qualified = [...assigned.entries()].filter(([id, s]) => s !== toSlug(byId.get(id)!.name));
  console.log(`${sets.length} sets · assigning ${assigned.size} slugs`);
  for (const [id, slug] of [...assigned].slice(0, 5)) console.log(`  ${String(id).padStart(4)} → ${slug}`);
  if (assigned.size > 5) console.log(`  … and ${assigned.size - 5} more`);
  if (qualified.length) {
    console.log(`  ${qualified.length} needed disambiguating inside their game: ${qualified.map(([, s]) => s).join(", ")}`);
  }
  if (dry) { console.log("--dry: nothing was written"); return 0; }

  // One statement per set, batched: the unique index is the backstop if two runs ever race.
  await c.batch(
    [...assigned].map(([id, slug]) => ({ sql: "UPDATE sets SET slug = ? WHERE id = ? AND slug IS NULL", args: [slug, id] })),
    "write"
  );
  const left = Number((await c.execute("SELECT COUNT(*) AS n FROM sets WHERE slug IS NULL")).rows[0].n);
  console.log(`done · sets still without a slug: ${left}`);
  return left === 0 ? 0 : 1;
}

main()
  .then((code) => { closeDb(); process.exit(code); })
  .catch((e) => { console.error(e); closeDb(); process.exit(1); });
