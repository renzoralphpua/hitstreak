import { describe, it, expect } from "vitest";
import { validateDeck } from "@/lib/decks/validate";
import { card } from "./helpers/decks";
import type { DeckCardInput } from "@/lib/decks/types";

const leader = (colors = "Red;Green", over: Partial<DeckCardInput> = {}) =>
  card({ name: "Monkey.D.Luffy", cardId: 1, zone: "leader", attrs: { CardType: "Leader", Color: colors, Number: "OP01-003", Life: "5" }, ...over });
const ch = (name: string, number: string, color: string, quantity: number, cardId: number, over: Partial<DeckCardInput> = {}) =>
  card({ name, cardId, quantity, attrs: { CardType: "Character", Color: color, Number: number, Cost: "3" }, ...over });
/** 50 red/green characters, 4 per number: Card 0..11 (even = Green, odd = Red) + 2 Filler. */
const legal = () => {
  const cards = [leader()];
  for (let i = 0; i < 12; i++) cards.push(ch(`Card ${i}`, `OP01-${String(10 + i).padStart(3, "0")}`, i % 2 ? "Red" : "Green", 4, 10 + i));
  cards.push(ch("Filler", "OP01-099", "Red", 2, 99));
  return cards;
};
const codes = (cards: ReturnType<typeof card>[]) => validateDeck({ gameSlug: "one-piece", cards }).errors.map((e) => e.code);

describe("One Piece deck rules", () => {
  it("accepts a legal Leader + 50", () => expect(validateDeck({ gameSlug: "one-piece", cards: legal() })).toEqual({ valid: true, errors: [] }));
  it("requires exactly one Leader in the leader slot, and no Leaders in the main deck", () => {
    expect(codes(legal().slice(1))).toEqual(["leader"]);
    const two = legal(); two.push(leader("Blue", { cardId: 2 }));
    expect(codes(two)).toEqual(["leader"]);
    const misplaced = legal(); misplaced[0] = { ...misplaced[0], zone: "main" };
    expect(codes(misplaced).sort()).toEqual(["leader", "size", "zone"]);
    // a non-Leader in the Leader slot is not a Leader
    const notALeader = legal(); notALeader[0] = ch("Nami", "OP01-016", "Red", 1, 16, { zone: "leader" });
    expect(codes(notALeader)).toEqual(["leader"]);
  });
  it("requires exactly 50 main-deck cards", () => {
    const d = legal(); d[d.length - 1].quantity = 3;
    expect(codes(d)).toEqual(["size"]);
    expect(validateDeck({ gameSlug: "one-piece", cards: d }).errors[0].message).toMatch(/51/);
  });
  it("limits copies by card number, so alt arts count together", () => {
    const d = legal(); d[d.length - 1].quantity = 1;
    d.push(ch("Card 0 (Alternate Art)", "OP01-010", "Green", 1, 500));
    const r = validateDeck({ gameSlug: "one-piece", cards: d });
    expect(r.errors.map((e) => e.code)).toEqual(["copies"]);
    expect(r.errors[0].message).toMatch(/OP01-010/);
    expect(r.errors[0].cardId).toBe(10);
    // numbers compare case-insensitively; a card with no Number falls back to its base name
    const lower = legal(); lower[lower.length - 1].quantity = 1;
    lower.push(ch("Card 0 (Alternate Art)", "op01-010", "Green", 1, 501));
    expect(codes(lower)).toEqual(["copies"]);
    const unnumbered = legal(); unnumbered[12].quantity = 1; // Card 11: 4 → 1 makes room
    unnumbered[unnumbered.length - 1] = ch("Promo Luffy", "", "Red", 2, 600);
    unnumbered.push(ch("Promo Luffy (Alternate Art)", "", "Red", 3, 601));
    expect(codes(unnumbered)).toEqual(["copies"]);
  });
  it("every card must share a colour with the Leader; multi-colour cards need one match", () => {
    // (OP01-016 is legal()'s Card 6, so a real Nami number there would also be a copies error)
    const d = legal(); d[d.length - 1] = ch("Nami", "OP01-116", "Blue", 2, 16);
    const r = validateDeck({ gameSlug: "one-piece", cards: d });
    expect(r.errors.map((e) => e.code)).toEqual(["color"]);
    expect(r.errors[0].cardId).toBe(16);
    const dual = legal(); dual[dual.length - 1] = ch("Zoro", "OP01-025", "Blue;Red", 2, 25);
    expect(codes(dual)).toEqual([]);
    const mono = legal(); mono[0] = leader("Red"); mono[1] = ch("Card 0", "OP01-010", "Red;Green", 4, 10); // dual card in a mono deck: fine
    // legal() has six Green stacks (Card 0, 2, 4, 6, 8, 10); Card 0 became dual, so five pure-Green stacks are off-colour now
    expect(codes(mono).filter((c) => c === "color")).toHaveLength(5);
    // colour compares case-insensitively and ignores stray whitespace
    const loose = legal(); loose[0] = leader(" red ; GREEN"); loose[loose.length - 1] = ch("Zoro", "OP01-025", "blue;Red ", 2, 25);
    expect(codes(loose)).toEqual([]);
  });
  it("cards with no colour are not colour-checked", () => {
    const d = legal(); d[d.length - 1] = ch("Mystery", "OP01-098", "", 2, 98);
    expect(codes(d)).toEqual([]);
    // 3 catalog Leaders (alt-art promos) carry no Color at all: nothing to match against, so no false errors
    const colourless = legal(); colourless[0] = leader("");
    expect(codes(colourless)).toEqual([]);
  });
  it("rejects DON!! cards and cards in zones One Piece does not use, still counting them toward the main deck", () => {
    const don = legal(); don[don.length - 1].quantity = 1;
    don.push(card({ name: "DON!! Card (Alternate Art)", cardId: 700, quantity: 1, attrs: { CardType: "DON!!" } }));
    expect(codes(don)).toEqual(["zone"]); // 49 + 1 DON!! = 50, so no size error, but the DON!! does not belong
    const rune = legal(); rune[rune.length - 1].quantity = 1;
    rune.push(ch("Filler", "OP01-099", "Red", 1, 99, { zone: "rune" }));
    expect(codes(rune)).toEqual(["zone"]);
    const runeCopies = legal(); runeCopies[runeCopies.length - 1].quantity = 1;
    runeCopies.push(ch("Card 0 (Alternate Art)", "OP01-010", "Blue", 1, 500, { zone: "rune" }));
    expect(codes(runeCopies).sort()).toEqual(["color", "copies", "zone"]);
  });
  it("reports every problem at once", () => {
    const d = [leader("Red"), ch("Nami", "OP01-016", "Blue", 5, 16)];
    expect(codes(d).sort()).toEqual(["color", "copies", "size"]);
    // with two Leaders there is no single colour identity to check against, so only the leader error is reported
    d.push(leader("Blue", { cardId: 2 }));
    expect(codes(d).sort()).toEqual(["copies", "leader", "size"]);
  });
});
