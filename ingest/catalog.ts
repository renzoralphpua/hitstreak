// Idempotent catalog upserts keyed on TCGplayer natural IDs.
import { db } from "@/lib/db";
import type { TcgcsvGroup, TcgcsvProduct } from "./tcgcsv";

export interface GameSeed {
  tcgplayerCategoryId: number;
  name: string;
  slug: string;
}

export const GAMES: GameSeed[] = [
  { tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" },
  { tcgplayerCategoryId: 68, name: "One Piece Card Game", slug: "one-piece" },
  { tcgplayerCategoryId: 89, name: "Riftbound", slug: "riftbound" },
];

export async function ensureGame(g: GameSeed): Promise<void> {
  const c = await db();
  await c.execute({
    sql: `INSERT INTO games (tcgplayer_category_id, name, slug) VALUES (?, ?, ?)
          ON CONFLICT(tcgplayer_category_id) DO UPDATE SET name = excluded.name`,
    args: [g.tcgplayerCategoryId, g.name, g.slug],
  });
}

export async function upsertSets(categoryId: number, groups: TcgcsvGroup[]): Promise<void> {
  if (groups.length === 0) return;
  const c = await db();
  const gameRow = (await c.execute({
    sql: "SELECT id FROM games WHERE tcgplayer_category_id = ?",
    args: [categoryId],
  })).rows[0];
  if (!gameRow) throw new Error(`game for category ${categoryId} not seeded`);

  await c.batch(
    groups.map((g) => ({
      sql: `INSERT INTO sets (game_id, tcgplayer_group_id, name, code, release_date)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(tcgplayer_group_id) DO UPDATE SET
              name = excluded.name, code = excluded.code, release_date = excluded.release_date`,
      args: [Number(gameRow.id), g.groupId, g.name, g.abbreviation ?? null, g.publishedOn ?? null],
    })),
    "write"
  );
}

export async function upsertProducts(
  _categoryId: number,
  groupId: number,
  products: TcgcsvProduct[]
): Promise<void> {
  if (products.length === 0) return;
  const c = await db();
  const setRow = (await c.execute({
    sql: "SELECT id FROM sets WHERE tcgplayer_group_id = ?",
    args: [groupId],
  })).rows[0];
  if (!setRow) throw new Error(`set for group ${groupId} not upserted yet`);

  const CHUNK = 200;
  // Each 200-statement batch commits on its own; a failure mid-loop leaves earlier chunks applied. Acceptable: the daily run is idempotent and re-applies everything.
  for (let i = 0; i < products.length; i += CHUNK) {
    await c.batch(
      products.slice(i, i + CHUNK).map((p) => {
        const attrs: Record<string, string> = {};
        for (const e of p.extendedData ?? []) attrs[e.name] = e.value;
        return {
          // set_id is not updated on conflict: products are fetched per group, so a card's set is a call-site invariant.
          sql: `INSERT INTO cards (set_id, tcgplayer_product_id, name, number, rarity, image_url, attrs)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tcgplayer_product_id) DO UPDATE SET
                  name = excluded.name, number = excluded.number, rarity = excluded.rarity,
                  image_url = excluded.image_url, attrs = excluded.attrs`,
          args: [
            Number(setRow.id),
            p.productId,
            p.name,
            attrs["Number"] ?? null,
            attrs["Rarity"] ?? null,
            p.imageUrl ?? null,
            JSON.stringify(attrs),
          ],
        };
      }),
      "write"
    );
  }
}
