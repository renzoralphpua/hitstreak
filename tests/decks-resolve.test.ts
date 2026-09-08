import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("decks-resolve");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { seedDeckFixtures } from "./helpers/decks";
import { db } from "@/lib/db";
import { mergeResolved, parseDecklist, resolveDecklist } from "@/lib/decks/resolve";

let f: Awaited<ReturnType<typeof seedDeckFixtures>>;
beforeAll(async () => { await seedMiniCatalog(); f = await seedDeckFixtures(); });
afterAll(() => { closeDb(); tmp.clean(); });

describe("parseDecklist", () => {
  it("reads quantities in the common shapes and ignores headers/totals", () => {
    const text = `Pokémon: 8\n4 Charmander MEW 4\n4x Charizard ex OBF 125\n\nTrainer: 4\nRare Candy x4\nTotal Cards: 60`;
    expect(parseDecklist(text, "pokemon")).toEqual([
      { raw: "4 Charmander MEW 4", quantity: 4, text: "Charmander", zone: "main" },
      { raw: "4x Charizard ex OBF 125", quantity: 4, text: "Charizard ex", zone: "main" },
      { raw: "Rare Candy x4", quantity: 4, text: "Rare Candy", zone: "main" },
    ]);
  });
  it("maps One Piece and Riftbound section headers to zones", () => {
    expect(parseDecklist(`Leader\n1 OP01-003 Monkey.D.Luffy\nMain\n4 OP01-016 Nami`, "one-piece").map((l) => [l.zone, l.text])).toEqual([["leader", "OP01-003 Monkey.D.Luffy"], ["main", "OP01-016 Nami"]]);
    expect(parseDecklist(`Legend:\n1 Renekton, Butcher of the Sands\nChampion:\n1 Renekton, Rampager\nRunes:\n12 Body Rune\nBattlefields:\n1 Heisho, Shell of the World`, "riftbound").map((l) => l.zone)).toEqual(["legend", "champion", "rune", "battlefield"]);
  });
  it("treats One Piece Character / Event / Stage sections as the main deck", () => {
    const text = `Leader\n1 OP01-003 Monkey.D.Luffy\nCharacter: 3\n4 OP01-016 Nami\nEvents (2)\n2 OP01-029 Gum-Gum Red Roc\nStage\n1 OP01-030 Thousand Sunny`;
    expect(parseDecklist(text, "one-piece").map((l) => [l.zone, l.quantity, l.text])).toEqual([
      ["leader", 1, "OP01-003 Monkey.D.Luffy"], ["main", 4, "OP01-016 Nami"], ["main", 2, "OP01-029 Gum-Gum Red Roc"], ["main", 1, "OP01-030 Thousand Sunny"],
    ]);
  });
  it("defaults a bare line to quantity 1", () => {
    expect(parseDecklist("Heisho, Shell of the World", "riftbound")[0]).toMatchObject({ quantity: 1, text: "Heisho, Shell of the World" });
  });
  it("treats a header word only as a header when it is the whole line (with an optional colon/count)", () => {
    // "Energy Retrieval" and "Energy Switch" are cards, not the "Energy" section header
    expect(parseDecklist(`Energy: 10\nEnergy Retrieval\n2 Energy Switch\nPokémon (8)\n1 Pikachu`, "pokemon").map((l) => [l.quantity, l.text])).toEqual([[1, "Energy Retrieval"], [2, "Energy Switch"], [1, "Pikachu"]]);
  });
  it("strips Riftbound / Limitless-style trailing set numbers and comment lines", () => {
    expect(parseDecklist(`// my list\n3 Heisho, Shell of the World (OGN-158)\n1 Body Rune OGN 4\n# note`, "riftbound").map((l) => l.text)).toEqual(["Heisho, Shell of the World", "Body Rune"]);
  });
});

describe("resolveDecklist", () => {
  it("resolves exact names (any printing, cheapest priced first) and One Piece numbers", async () => {
    const r = await resolveDecklist("pokemon", parseDecklist("4 Rare Candy\n3 Charizard ex", "pokemon"));
    expect(r[0].cardId).toBe(f.cards.rareCandySvi); // $0.80 SVI reprint beats $1.60 OBF
    expect(r[1].cardId).toBe(f.cards.charizardEx);
    const op = await resolveDecklist("one-piece", parseDecklist("1 OP01-003 Monkey.D.Luffy\n4 OP01-016", "one-piece"));
    expect(op.map((x) => x.cardId)).toEqual([f.cards.luffyLeader, f.cards.nami]); // the $2.50 regular over the $40 alt art
  });
  it("keeps the parsed line and lists every exact-match printing as a candidate", async () => {
    const [r] = await resolveDecklist("pokemon", parseDecklist("4 Rare Candy", "pokemon"));
    expect(r.line).toMatchObject({ quantity: 4, text: "Rare Candy", zone: "main" });
    expect(r.candidates.map((c) => c.cardId)).toEqual([f.cards.rareCandySvi, f.cards.rareCandyObf]);
    expect(r.candidates[0]).toMatchObject({ name: "Rare Candy - 191/198", setName: "Prismatic Evolutions", number: "191/198" });
  });
  it("matches names case-insensitively and does not cross games", async () => {
    const [r] = await resolveDecklist("pokemon", parseDecklist("2 charizard EX", "pokemon"));
    expect(r.cardId).toBe(f.cards.charizardEx);
    const [op] = await resolveDecklist("one-piece", parseDecklist("2 Charizard ex", "one-piece"));
    expect(op).toMatchObject({ cardId: null, candidates: [] });
  });
  it("offers candidates for a fuzzy or ambiguous line and leaves cardId null", async () => {
    const [r] = await resolveDecklist("pokemon", parseDecklist("2 Charizard", "pokemon"));
    expect(r.cardId).toBeNull();
    expect(r.candidates.map((c) => c.name)).toContain("Charizard ex");
    const [mid] = await resolveDecklist("riftbound", parseDecklist("1 Rampager", "riftbound"));
    expect(mid.cardId).toBeNull();
    expect(mid.candidates.map((c) => c.name)).toEqual(["Renekton, Rampager"]); // substring fallback
    const [none] = await resolveDecklist("pokemon", parseDecklist("1 Definitely Not A Card", "pokemon"));
    expect(none).toMatchObject({ cardId: null, candidates: [] });
  });
  it("refuses a bare One Piece name that spans more than one card Number, offering one candidate per Number", async () => {
    // both fixture Namis share OP01-016 (regular + alt art) — a single Number, so the bare name still resolves
    const [one] = await resolveDecklist("one-piece", parseDecklist("4 Nami", "one-piece"));
    expect(one.cardId).toBe(f.cards.nami);
    // a second, cheaper Nami under another Number makes the bare name ambiguous
    const c = await db();
    const ins = await c.execute({
      sql: "INSERT INTO cards (set_id, tcgplayer_product_id, name, number, rarity, image_url, attrs) VALUES (?, 3099, 'Nami', 'OP10-013', 'C', NULL, ?) RETURNING id",
      args: [f.sets.twoLegends, JSON.stringify({ CardType: "Character", Color: "Blue", Number: "OP10-013", Cost: "3" })],
    });
    const namiOp10 = Number(ins.rows[0].id);
    const pr = await c.execute({ sql: "INSERT INTO printings (card_id, subtype) VALUES (?, 'Normal') RETURNING id", args: [namiOp10] });
    await c.execute({ sql: "INSERT INTO latest_prices (printing_id, date, market) VALUES (?, '2026-09-07', 1.0)", args: [Number(pr.rows[0].id)] });

    const [amb] = await resolveDecklist("one-piece", parseDecklist("4 Nami", "one-piece"));
    expect(amb.cardId).toBeNull();
    // one candidate per Number, cheapest first; the $40 alt art folds into OP01-016
    expect(amb.candidates.map((x) => [x.cardId, x.number])).toEqual([[namiOp10, "OP10-013"], [f.cards.nami, "OP01-016"]]);
    // the number path still resolves
    const [byNum] = await resolveDecklist("one-piece", parseDecklist("4 OP10-013 Nami", "one-piece"));
    expect(byNum.cardId).toBe(namiOp10);
    // leave the shared catalog as the fixtures made it, so later tests never see a third Nami
    await c.batch(
      [
        { sql: "DELETE FROM latest_prices WHERE printing_id = ?", args: [Number(pr.rows[0].id)] },
        { sql: "DELETE FROM printings WHERE card_id = ?", args: [namiOp10] },
        { sql: "DELETE FROM cards WHERE id = ?", args: [namiOp10] },
      ],
      "write"
    );
  });
  it("escapes LIKE wildcards in the line text", async () => {
    const [r] = await resolveDecklist("pokemon", parseDecklist("1 %", "pokemon"));
    expect(r).toMatchObject({ cardId: null, candidates: [] });
    const [u] = await resolveDecklist("pokemon", parseDecklist("1 Rare_Candy", "pokemon"));
    expect(u).toMatchObject({ cardId: null, candidates: [] });
  });
});

describe("mergeResolved", () => {
  it("sums quantities when several printings of one card land in the same zone", async () => {
    const r = await resolveDecklist("pokemon", parseDecklist("3 Rare Candy SVI 191\n1 Rare Candy OBF 191\n2 Charizard ex", "pokemon"));
    expect(r.map((x) => x.cardId)).toEqual([f.cards.rareCandySvi, f.cards.rareCandySvi, f.cards.charizardEx]);
    expect(mergeResolved(r)).toEqual([
      { cardId: f.cards.rareCandySvi, zone: "main", quantity: 4 },
      { cardId: f.cards.charizardEx, zone: "main", quantity: 2 },
    ]);
  });
  it("keeps the same card apart across zones and drops unresolved lines", () => {
    const line = (text: string, zone: "main" | "leader", quantity: number) => ({ raw: text, text, zone, quantity });
    expect(mergeResolved([
      { line: line("Nami", "leader", 1), cardId: 7, candidates: [] },
      { line: line("Nami", "main", 2), cardId: 7, candidates: [] },
      { line: line("Nami", "main", 2), cardId: 7, candidates: [] },
      { line: line("Mystery", "main", 4), cardId: null, candidates: [] },
    ])).toEqual([{ cardId: 7, zone: "leader", quantity: 1 }, { cardId: 7, zone: "main", quantity: 4 }]);
  });
});
