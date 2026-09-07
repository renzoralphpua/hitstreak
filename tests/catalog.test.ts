import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";

const tmp = tmpDb("catalog");

import { db, closeDb } from "@/lib/db";
import { ensureGame, upsertSets, upsertProducts } from "@/ingest/catalog";

beforeAll(async () => {
  await ensureGame({ tcgplayerCategoryId: 3, name: "Pokémon", slug: "pokemon" });
});

afterAll(() => {
  closeDb();
  tmp.clean();
});

const GROUPS = [{ groupId: 604, name: "Scarlet & Violet", abbreviation: "SVI", publishedOn: "2023-03-31T00:00:00" }];

const PRODUCTS = [
  {
    productId: 450101,
    name: "Pikachu",
    imageUrl: "https://img.example/450101.jpg",
    extendedData: [
      { name: "Number", value: "025/198" },
      { name: "Rarity", value: "Common" },
      { name: "HP", value: "60" },
    ],
  },
  { productId: 450999, name: "SV Booster Box", extendedData: [] }, // sealed: no number/rarity
];

describe("catalog upsert", () => {
  it("upserts sets and cards and is idempotent", async () => {
    await upsertSets(3, GROUPS);
    await upsertProducts(3, 604, PRODUCTS);
    // run again — no dupes
    await upsertSets(3, GROUPS);
    await upsertProducts(3, 604, PRODUCTS);

    const c = await db();
    expect((await c.execute("SELECT COUNT(*) AS n FROM sets")).rows[0].n).toBe(1);
    expect((await c.execute("SELECT COUNT(*) AS n FROM cards")).rows[0].n).toBe(2);

    const pika = (await c.execute({
      sql: "SELECT number, rarity, attrs FROM cards WHERE tcgplayer_product_id = ?",
      args: [450101],
    })).rows[0];
    expect(pika.number).toBe("025/198");
    expect(pika.rarity).toBe("Common");
    expect(JSON.parse(String(pika.attrs))).toEqual({ Number: "025/198", Rarity: "Common", HP: "60" });
  });

  it("updates changed fields on re-upsert", async () => {
    await upsertProducts(3, 604, [{ ...PRODUCTS[0], name: "Pikachu (Revised)" }]);
    const c = await db();
    const row = (await c.execute({
      sql: "SELECT name FROM cards WHERE tcgplayer_product_id = ?",
      args: [450101],
    })).rows[0];
    expect(row.name).toBe("Pikachu (Revised)");
  });

  it("throws when upserting products for a group whose set has not been upserted", async () => {
    await expect(
      upsertProducts(3, 999999, [{ productId: 1, name: "Orphan" }])
    ).rejects.toThrow("set for group 999999 not upserted yet");
  });

  it("chunks large product lists across multiple batches", async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ productId: 900000 + i, name: `Bulk ${i}` }));
    await upsertProducts(3, 604, many);
    const c = await db();
    const r = await c.execute("SELECT COUNT(*) AS n FROM cards WHERE tcgplayer_product_id >= 900000");
    expect(Number(r.rows[0].n)).toBe(201);
  });
});
