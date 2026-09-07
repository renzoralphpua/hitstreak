// scripts/db-counts.mts — quick sanity check of table sizes. Usage: npx tsx scripts/db-counts.mts
import { db, closeDb } from "../lib/db";

const c = await db();
for (const t of ["games", "sets", "cards", "printings", "price_snapshots", "latest_prices"]) {
  const r = await c.execute(`SELECT COUNT(*) AS n FROM ${t}`);
  console.log(t.padEnd(16), r.rows[0].n);
}
closeDb();
