// Sorting a card grid. The cases that matter are the ones where a naive sort is quietly wrong:
// "161/131" before "25/131", an unpriced card leading a cheapest-first list, and a rarity order that
// has to work for three games that share no vocabulary.
import { describe, it, expect } from "vitest";
import {
  compareCardNumber, sortCards, SORT_OPTIONS, SET_SORT_KEYS, COLLECTION_SORT_KEYS,
  isSortKey, isSortDir, type SortableCard,
} from "@/lib/sort";

const card = (over: Partial<SortableCard> & { name: string }): SortableCard => ({
  number: "001/131", rarity: "Common", price: 1, paid: 1, gain: 0, owned: 0, ...over,
});

const names = (cards: SortableCard[]) => cards.map((c) => c.name);

describe("compareCardNumber", () => {
  it("orders numerically, not lexically", () => {
    const sorted = ["161/131", "25/131", "9/131"].sort(compareCardNumber);
    expect(sorted).toEqual(["9/131", "25/131", "161/131"]);
  });

  it("handles a prefixed number", () => {
    const sorted = ["OP08-118", "OP08-9", "OP08-20"].sort(compareCardNumber);
    expect(sorted).toEqual(["OP08-9", "OP08-20", "OP08-118"]);
  });

  it("puts a card with no number last — that is a sealed product", () => {
    const sorted = [null, "025/131", null, "001/131"].sort(compareCardNumber);
    expect(sorted).toEqual(["001/131", "025/131", null, null]);
  });

  it("is consistent, so the sort is stable", () => {
    expect(compareCardNumber("25/131", "25/131")).toBe(0);
    expect(Math.sign(compareCardNumber("a", "b"))).toBe(-Math.sign(compareCardNumber("b", "a")));
  });
});

describe("sortCards", () => {
  const cards = [
    card({ name: "Umbreon ex", number: "161/131", price: 1465, paid: 1100, gain: 365, owned: 2, rarity: "Special Illustration Rare" }),
    card({ name: "Pikachu", number: "025/131", price: 0.25, paid: 0.2, gain: 0.05, owned: 1, rarity: "Common" }),
    card({ name: "Sylveon ex", number: "086/131", price: 40, paid: 55, gain: -15, owned: 1, rarity: "Ultra Rare" }),
    card({ name: "Bulbasaur", number: "001/131", price: 0.1, paid: null, gain: null, owned: 0, rarity: "Common" }),
  ];

  it("sorts by card number, ascending, like a binder", () => {
    expect(names(sortCards(cards, "number", "asc"))).toEqual(["Bulbasaur", "Pikachu", "Sylveon ex", "Umbreon ex"]);
  });

  it("sorts by market price, dearest first", () => {
    expect(names(sortCards(cards, "price", "desc"))).toEqual(["Umbreon ex", "Sylveon ex", "Pikachu", "Bulbasaur"]);
  });

  it("sorts by gain, which is the one that shows a loss", () => {
    expect(names(sortCards(cards, "gain", "desc"))[0]).toBe("Umbreon ex");
    // Sylveon is the only loss, so it lands last among the cards that HAVE a gain.
    const ordered = names(sortCards(cards, "gain", "desc"));
    expect(ordered.indexOf("Sylveon ex")).toBeLessThan(ordered.indexOf("Bulbasaur"));
  });

  it("keeps unknown values at the bottom in BOTH directions", () => {
    // "We do not know what you paid" is not "you paid nothing"; it must never lead a cheapest-first
    // list, which is exactly what a plain comparator does with null.
    expect(names(sortCards(cards, "paid", "desc")).at(-1)).toBe("Bulbasaur");
    expect(names(sortCards(cards, "paid", "asc")).at(-1)).toBe("Bulbasaur");
  });

  it("orders rarity by scarcity in the list, rarest first", () => {
    // Two Commons, one Ultra Rare, one Special Illustration Rare — no rank table involved, which is
    // what lets this work for One Piece's "SEC" and Riftbound's "Epic" too.
    const ordered = names(sortCards(cards, "rarity", "desc"));
    // The two Commons land last, tie-broken by card number: 001 before 025.
    expect(ordered.slice(2)).toEqual(["Bulbasaur", "Pikachu"]);
    expect(ordered.slice(0, 2).sort()).toEqual(["Sylveon ex", "Umbreon ex"]);
  });

  it("puts a card with no rarity last rather than treating it as rarest", () => {
    const withNull = [...cards, card({ name: "Mystery", rarity: null, number: "999/131" })];
    expect(names(sortCards(withNull, "rarity", "desc")).at(-1)).toBe("Mystery");
    expect(names(sortCards(withNull, "rarity", "asc")).at(-1)).toBe("Mystery");
  });

  it("breaks ties by number then name, so the order is total", () => {
    const tied = [
      card({ name: "B", number: "002/131", price: 5 }),
      card({ name: "A", number: "002/131", price: 5 }),
      card({ name: "C", number: "001/131", price: 5 }),
    ];
    expect(names(sortCards(tied, "price", "desc"))).toEqual(["C", "A", "B"]);
  });

  it("does not mutate its input", () => {
    const before = names(cards);
    sortCards(cards, "price", "desc");
    expect(names(cards)).toEqual(before);
  });

  it("reverses cleanly", () => {
    const up = names(sortCards(cards, "name", "asc"));
    const down = names(sortCards(cards, "name", "desc"));
    expect(down).toEqual([...up].reverse());
  });
});

describe("the offered keys", () => {
  it("keeps paid and gain off a set grid, where almost every row would be blank", () => {
    expect(SET_SORT_KEYS).not.toContain("paid");
    expect(SET_SORT_KEYS).not.toContain("gain");
    expect(COLLECTION_SORT_KEYS).toContain("paid");
    expect(COLLECTION_SORT_KEYS).toContain("gain");
  });

  it("labels every key it offers", () => {
    for (const k of [...SET_SORT_KEYS, ...COLLECTION_SORT_KEYS]) {
      expect(SORT_OPTIONS[k]?.label, k).toBeTruthy();
    }
  });

  it("starts money high-to-low and a binder low-to-high", () => {
    expect(SORT_OPTIONS.price.defaultDir).toBe("desc");
    expect(SORT_OPTIONS.gain.defaultDir).toBe("desc");
    expect(SORT_OPTIONS.number.defaultDir).toBe("asc");
    expect(SORT_OPTIONS.name.defaultDir).toBe("asc");
  });

  it("validates what comes out of storage", () => {
    expect(isSortKey("price", SET_SORT_KEYS)).toBe(true);
    expect(isSortKey("paid", SET_SORT_KEYS)).toBe(false); // valid key, not offered here
    expect(isSortKey("nonsense", SET_SORT_KEYS)).toBe(false);
    expect(isSortDir("asc")).toBe(true);
    expect(isSortDir("sideways")).toBe(false);
  });
});
