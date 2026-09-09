// tests/helpers/decks.ts — deck-shaped catalog rows on top of seedMiniCatalog(): a Riftbound game and a
// handful of cards per game with the attrs the validators read. Returns ids by nickname.
//
// Every row is inserted with RETURNING id (or looked up by its tcgplayer key), so the returned map is the
// real ids whatever seedMiniCatalog() left behind — tests must use the map, never literal ids.
import { db } from "@/lib/db";
import type { Client } from "@libsql/client";
import type { DeckCardInput, Zone } from "@/lib/decks/types";

/** In-memory validator fixture. */
export const card = (over: Partial<DeckCardInput> & { name: string }): DeckCardInput => ({
  cardId: 0, zone: "main" as Zone, quantity: 1, attrs: {}, rarity: null, ...over,
});

const PRICE_DATE = "2026-09-07";

type CardKey =
  | "charizardEx" | "rareCandyObf" | "rareCandySvi" | "fireEnergy"
  | "nami" | "namiAlt" | "luffyLeader"
  | "renektonLegend" | "renektonChampion" | "bodyRune" | "heisho";

interface CardSpec {
  key: CardKey;
  set: "prismatic" | "twoLegends" | "origins" | "obsidian";
  productId: number;
  name: string;
  number: string;
  rarity: string;
  attrs: Record<string, string>;
  subtype: string;
  market: number;
}

const CARDS: CardSpec[] = [
  { key: "charizardEx", set: "obsidian", productId: 3001, name: "Charizard ex", number: "125/197", rarity: "Double Rare", attrs: { "Card Type": "Fire", HP: "330", Stage: "Stage 2" }, subtype: "Holofoil", market: 18.9 },
  { key: "rareCandyObf", set: "obsidian", productId: 3002, name: "Rare Candy", number: "191/197", rarity: "Uncommon", attrs: { "Card Type": "Trainer - Item" }, subtype: "Normal", market: 1.6 },
  { key: "rareCandySvi", set: "prismatic", productId: 3003, name: "Rare Candy - 191/198", number: "191/198", rarity: "Uncommon", attrs: { "Card Type": "Item" }, subtype: "Normal", market: 0.8 },
  { key: "fireEnergy", set: "obsidian", productId: 3004, name: "Basic Fire Energy", number: "230/197", rarity: "Common", attrs: { "Card Type": "Basic Energy" }, subtype: "Normal", market: 0.1 },
  { key: "nami", set: "twoLegends", productId: 3005, name: "Nami", number: "OP01-016", rarity: "R", attrs: { CardType: "Character", Color: "Blue", Number: "OP01-016", Cost: "1" }, subtype: "Normal", market: 2.5 },
  { key: "namiAlt", set: "twoLegends", productId: 3006, name: "Nami (Alternate Art)", number: "OP01-016", rarity: "SR", attrs: { CardType: "Character", Color: "Blue", Number: "OP01-016", Cost: "1" }, subtype: "Normal", market: 40.0 },
  { key: "luffyLeader", set: "twoLegends", productId: 3007, name: "Monkey.D.Luffy", number: "OP01-003", rarity: "L", attrs: { CardType: "Leader", Color: "Red;Green", Number: "OP01-003", Life: "5" }, subtype: "Normal", market: 3.0 },
  { key: "renektonLegend", set: "origins", productId: 3008, name: "Renekton, Butcher of the Sands", number: "141/166", rarity: "Rare", attrs: { "Card Type": "Legend", Tag: "Renekton", Domain: "Fury;Body" }, subtype: "Normal", market: 12.0 },
  { key: "renektonChampion", set: "origins", productId: 3009, name: "Renekton, Rampager", number: "142/166", rarity: "Rare", attrs: { "Card Type": "Champion Unit", Tag: "Renekton;Shurima", Domain: "Fury", "Energy Cost": "4", Might: "5" }, subtype: "Normal", market: 9.0 },
  { key: "bodyRune", set: "origins", productId: 3010, name: "Body Rune", number: "R04", rarity: "Common", attrs: { "Card Type": "Rune", Domain: "Body" }, subtype: "Normal", market: 0.5 },
  { key: "heisho", set: "origins", productId: 3011, name: "Heisho, Shell of the World", number: "158/166", rarity: "Uncommon", attrs: { "Card Type": "Battlefield" }, subtype: "Normal", market: 1.2 },
];

async function idOf(c: Client, sql: string, args: (string | number)[]): Promise<number> {
  const r = await c.execute({ sql, args });
  if (r.rows.length !== 1) throw new Error(`seedDeckFixtures: expected one id from ${sql}`);
  return Number(r.rows[0].id);
}

/** Requires seedMiniCatalog() to have run first (it owns the pokemon/one-piece games and their sets). */
export async function seedDeckFixtures() {
  const c = await db();
  const pokemon = await idOf(c, "SELECT id FROM games WHERE slug = 'pokemon'", []);
  const onePiece = await idOf(c, "SELECT id FROM games WHERE slug = 'one-piece'", []);
  const riftbound = await idOf(c, "INSERT INTO games (tcgplayer_category_id, name, slug) VALUES (89, 'Riftbound', 'riftbound') RETURNING id", []);

  const prismatic = await idOf(c, "SELECT id FROM sets WHERE tcgplayer_group_id = 604", []);
  const twoLegends = await idOf(c, "SELECT id FROM sets WHERE tcgplayer_group_id = 900", []);
  const origins = await idOf(c, "INSERT INTO sets (game_id, tcgplayer_group_id, name, code, release_date) VALUES (?, 950, 'Origins', 'OGN', '2025-10-31') RETURNING id", [riftbound]);
  const obsidian = await idOf(c, "INSERT INTO sets (game_id, tcgplayer_group_id, name, code, release_date) VALUES (?, 605, 'Obsidian Flames', 'OBF', '2023-08-11') RETURNING id", [pokemon]);
  const sets = { prismatic, twoLegends, origins, obsidian };

  const cards = {} as Record<CardKey, number>;
  const printings = {} as Record<CardKey, number>;
  for (const s of CARDS) {
    const cardId = await idOf(
      c,
      "INSERT INTO cards (set_id, tcgplayer_product_id, name, number, rarity, image_url, attrs) VALUES (?, ?, ?, ?, ?, NULL, ?) RETURNING id",
      [sets[s.set], s.productId, s.name, s.number, s.rarity, JSON.stringify(s.attrs)]
    );
    const printingId = await idOf(c, "INSERT INTO printings (card_id, subtype) VALUES (?, ?) RETURNING id", [cardId, s.subtype]);
    await c.execute({ sql: "INSERT INTO latest_prices (printing_id, date, market) VALUES (?, ?, ?)", args: [printingId, PRICE_DATE, s.market] });
    cards[s.key] = cardId;
    printings[s.key] = printingId;
  }

  return {
    games: { pokemon, onePiece, riftbound },
    sets,
    cards,
    printings,
  };
}
