// scripts/seed-sample-binder.mts — a binder with enough shape to exercise every state the UI has.
// Usage (bash; PowerShell: set $env:TURSO_DATABASE_URL first):
//   TURSO_DATABASE_URL=file:hitstreak.local.db npx tsx scripts/seed-sample-binder.mts --as renzo@example.com [--name "Sample Binder"]
//
// Development only. It picks real printings out of whatever catalog the local database has, so the
// cards differ per machine, and it goes through lib/portfolios rather than raw SQL so every row is
// created the way the app creates them — validation, ownership checks and the 9999 ceiling included.
//
// The shape is deliberate. It seeds:
//   • a spread of values, so the grid has something to sort
//   • ONE holding bought twice at different prices — the lots case, which is invisible with one lot
//   • ONE holding with no acquired price — the "Add cost" tile, and a gain that is overstated
//   • ONE holding priced in part — "2 of 3 without a cost" in the list
//   • ONE unpriced printing — the "no price" tile
// Exit codes: 2 usage / unknown --as user, 1 nothing seedable in this catalog.
import { db, closeDb } from "@/lib/db";
import { createPortfolio, addItem } from "@/lib/portfolios";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? undefined : process.argv[i + 1]; };

/** Priced printings spread across the value range, so the binder is not all one kind of card. */
const PICK_PRICED = `
  SELECT p.id, ca.name, se.name AS set_name, lp.market
  FROM printings p
  JOIN cards ca ON ca.id = p.card_id
  JOIN sets se ON se.id = ca.set_id
  JOIN latest_prices lp ON lp.printing_id = p.id
  WHERE lp.market BETWEEN ? AND ?
  ORDER BY lp.market DESC
  LIMIT ?`;

/** A printing the ingest has never priced — the "no price" state has to come from a real one. */
const PICK_UNPRICED = `
  SELECT p.id, ca.name, se.name AS set_name
  FROM printings p
  JOIN cards ca ON ca.id = p.card_id
  JOIN sets se ON se.id = ca.set_id
  LEFT JOIN latest_prices lp ON lp.printing_id = p.id
  WHERE lp.printing_id IS NULL
  LIMIT 1`;

/** Cost basis a little under market, so the binder shows a gain rather than a flat line. */
const paidFor = (market: number, factor: number) => Math.round(market * factor * 100) / 100;

async function main(): Promise<number> {
  const as = arg("as");
  const name = arg("name") ?? "Sample Binder";
  if (!as) {
    console.error("usage: --as <email> [--name <binder name>]");
    return 2;
  }
  const c = await db();
  const user = (await c.execute({ sql: `SELECT id FROM "user" WHERE email = ?`, args: [as] })).rows[0];
  if (!user) {
    console.error(`no user with email ${as} — sign up first, then re-run`);
    return 2;
  }
  const userId = String(user.id);

  const band = async (lo: number, hi: number, n: number) =>
    (await c.execute({ sql: PICK_PRICED, args: [lo, hi, n] })).rows;
  const [big, mid, small] = await Promise.all([band(120, 4000, 4), band(15, 120, 5), band(1, 15, 5)]);
  const priced = [...big, ...mid, ...small];
  if (priced.length < 6) {
    console.error("this catalog has too few priced printings to make a useful binder — run the price ingest first");
    return 1;
  }
  const unpriced = (await c.execute(PICK_UNPRICED)).rows[0];

  const portfolio = await createPortfolio(userId, name);
  const note: string[] = [];

  // The bulk: one lot each, bought a bit below today's price.
  for (const [i, r] of priced.entries()) {
    const market = Number(r.market);
    await addItem(userId, portfolio.id, {
      printingId: Number(r.id),
      quantity: i % 4 === 0 ? 2 : 1,
      condition: i % 5 === 0 ? "LP" : "NM",
      acquiredPrice: paidFor(market, 0.7 + (i % 5) * 0.08),
      acquiredDate: `2026-0${(i % 8) + 1}-1${i % 9}`,
    });
  }

  // Bought twice at different prices. Cost basis is the sum of the two, which is the whole point of
  // lots — with one lot this state is indistinguishable from any other holding.
  const twice = priced[1];
  await addItem(userId, portfolio.id, {
    printingId: Number(twice.id),
    quantity: 1,
    condition: "NM",
    acquiredPrice: paidFor(Number(twice.market), 1.15), // bought again, higher, at the top
    acquiredDate: "2026-08-02",
  });
  note.push(`two lots at different prices: ${twice.name}`);

  // No price recorded at all — the "Add cost" tile.
  const uncosted = priced[priced.length - 1];
  await addItem(userId, portfolio.id, { printingId: Number(uncosted.id), quantity: 1, condition: "NM" });
  note.push(`no recorded cost: ${uncosted.name}`);

  // Priced in part: one lot with a price, one without, on the same holding.
  const partial = priced[priced.length - 2];
  await addItem(userId, portfolio.id, { printingId: Number(partial.id), quantity: 2, condition: "MP" });
  note.push(`partly costed: ${partial.name}`);

  if (unpriced) {
    await addItem(userId, portfolio.id, { printingId: Number(unpriced.id), quantity: 1, condition: "NM" });
    note.push(`no market price: ${unpriced.name}`);
  } else {
    note.push("no unpriced printing in this catalog — the 'no price' state is not covered");
  }

  console.log(`seeded binder ${portfolio.id} "${portfolio.name}" for ${as}`);
  for (const n of note) console.log(`  · ${n}`);
  console.log(`  · undo: DELETE FROM collection_items WHERE portfolio_id = ${portfolio.id}; DELETE FROM portfolios WHERE id = ${portfolio.id};`);
  return 0;
}

main()
  .then((code) => { closeDb(); process.exit(code); })
  .catch((e) => { console.error(e); closeDb(); process.exit(1); });
