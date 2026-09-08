import { describe, it, expect } from "vitest";
import { validateDeck } from "@/lib/decks/validate";
import { card } from "./helpers/decks";

const poke = (name: string, over: Record<string, unknown> = {}) => card({ name, attrs: { "Card Type": "Fire", HP: "120", Stage: "Basic" }, ...over });
const trainer = (name: string, over: Record<string, unknown> = {}) => card({ name, attrs: { "Card Type": "Trainer - Item" }, ...over });
const energy = (name = "Basic Fire Energy", over: Record<string, unknown> = {}) => card({ name, attrs: { "Card Type": "Basic Energy" }, ...over });
/** A legal 60: 4 Charmander, 4 Charizard ex (Stage 2), 4 Rare Candy, 48 basic energy. */
const legal = () => [
  poke("Charmander", { cardId: 1, quantity: 4 }),
  poke("Charizard ex", { cardId: 2, quantity: 4, attrs: { "Card Type": "Fire", HP: "330", Stage: "Stage 2" } }),
  trainer("Rare Candy", { cardId: 3, quantity: 4 }),
  energy("Basic Fire Energy", { cardId: 4, quantity: 48 }),
];
const codes = (cards: ReturnType<typeof card>[]) => validateDeck({ gameSlug: "pokemon", cards }).errors.map((e) => e.code);

describe("Pokémon deck rules", () => {
  it("accepts a legal 60-card deck", () => {
    expect(validateDeck({ gameSlug: "pokemon", cards: legal() })).toEqual({ valid: true, errors: [] });
  });
  it("requires exactly 60 cards", () => {
    const d = legal(); d[3].quantity = 47;
    expect(codes(d)).toEqual(["size"]);
    d[3].quantity = 49;
    expect(codes(d)).toEqual(["size"]);
    expect(validateDeck({ gameSlug: "pokemon", cards: d }).errors[0].message).toMatch(/61/);
  });
  it("requires at least one Basic Pokémon (trainers and fossils don't count)", () => {
    const d = [trainer("Rare Candy", { cardId: 3, quantity: 4 }), energy("Basic Fire Energy", { cardId: 4, quantity: 56 })];
    expect(codes(d)).toEqual(["no-basic"]);
    const fossil = card({ name: "Antique Armor Fossil", cardId: 9, quantity: 4, attrs: { "Card Type": "Trainer - Item", HP: "60" } });
    expect(codes([fossil, energy("Basic Fire Energy", { cardId: 4, quantity: 56 })])).toEqual(["no-basic"]);
  });
  it("limits any name to 4 copies, counting reprints by base name, except Basic Energy", () => {
    const d = legal();
    d.push(trainer("Rare Candy - 191/198", { cardId: 33, quantity: 1 }));
    d[3].quantity = 47;
    const r = validateDeck({ gameSlug: "pokemon", cards: d });
    expect(r.errors.map((e) => e.code)).toEqual(["copies"]);
    expect(r.errors[0].message).toMatch(/Rare Candy/);
    expect(r.errors[0].cardId).toBe(3);
    // 48 basic energy is fine (above); legacy "Energy" card type with a basic energy name is exempt too
    const legacy = legal(); legacy[3] = card({ name: "Fire Energy", cardId: 4, quantity: 48, attrs: { "Card Type": "Energy" } });
    expect(codes(legacy)).toEqual([]);
    // Special energy is NOT exempt
    const special = legal(); special[3].quantity = 43; special.push(card({ name: "Double Turbo Energy", cardId: 5, quantity: 5, attrs: { "Card Type": "Special Energy" } }));
    expect(codes(special)).toEqual(["copies"]);
  });
  it("treats ex / V / VMAX as different names", () => {
    const d = legal(); d[3].quantity = 44;
    d.push(poke("Charizard", { cardId: 6, quantity: 4, attrs: { "Card Type": "Fire", HP: "150", Stage: "Stage 2" } }));
    expect(codes(d)).toEqual([]);
  });
  it("allows one ACE SPEC and one Radiant Pokémon", () => {
    const d = legal(); d[3].quantity = 46;
    d.push(trainer("Prime Catcher", { cardId: 7, quantity: 2, rarity: "ACE SPEC Rare" }));
    expect(codes(d)).toEqual(["ace-spec"]);
    d[4].quantity = 1; d.push(trainer("Max Rod", { cardId: 8, quantity: 1, rarity: "Rare Ace" }));
    expect(codes(d)).toEqual(["ace-spec"]); // two different ACE SPECs is still two
    const e = legal(); e[3].quantity = 46;
    e.push(poke("Radiant Charizard", { cardId: 10, quantity: 2, rarity: "Radiant Rare" }));
    expect(codes(e)).toEqual(["radiant"]);
  });
  it("rejects cards in zones Pokémon does not use", () => {
    const d = legal(); d[3].quantity = 47; d.push(card({ name: "Body Rune", cardId: 11, zone: "rune", quantity: 1 }));
    expect(codes(d)).toEqual(["zone"]);
  });
  it("reports every problem at once", () => {
    const d = [poke("Charmander", { cardId: 1, quantity: 5 })];
    expect(codes(d).sort()).toEqual(["copies", "size"]);
  });
});
