import { describe, it, expect } from "vitest";
import { validateDeck } from "@/lib/decks/validate";
import { card } from "./helpers/decks";
import type { DeckCardInput } from "@/lib/decks/types";

const legend = (over: Partial<DeckCardInput> = {}) => card({ name: "Renekton, Butcher of the Sands", cardId: 1, zone: "legend", attrs: { "Card Type": "Legend", Tag: "Renekton", Domain: "Fury;Body" }, ...over });
const champion = (over: Partial<DeckCardInput> = {}) => card({ name: "Renekton, Rampager", cardId: 2, zone: "champion", attrs: { "Card Type": "Champion Unit", Tag: "Renekton;Shurima", Domain: "Fury" }, ...over });
const unit = (name: string, cardId: number, quantity: number, domain = "Fury", over: Partial<DeckCardInput> = {}) => card({ name, cardId, quantity, attrs: { "Card Type": "Unit", Domain: domain, "Energy Cost": "2", Might: "2" }, ...over });
const rune = (domain: string, cardId: number, quantity: number) => card({ name: `${domain} Rune`, cardId, quantity, zone: "rune", attrs: { "Card Type": "Rune", Domain: domain } });
const bf = (name: string, cardId: number, over: Partial<DeckCardInput> = {}) => card({ name, cardId, zone: "battlefield", attrs: { "Card Type": "Battlefield" }, ...over });
/** Legal: legend, champion, 39 main (13×3), 12 runes, 3 battlefields. Indices: 0 legend, 1 champion, 2..14 Unit 0..12, 15/16 runes, 17..19 battlefields. */
const legal = () => {
  const cards = [legend(), champion()];
  for (let i = 0; i < 13; i++) cards.push(unit(`Unit ${i}`, 10 + i, 3, i % 2 ? "Fury" : "Body"));
  cards.push(rune("Fury", 50, 6), rune("Body", 51, 6));
  cards.push(bf("Heisho", 60), bf("Targon", 61), bf("Bandle", 62));
  return cards;
};
const validate = (cards: DeckCardInput[]) => validateDeck({ gameSlug: "riftbound", cards });
const codes = (cards: DeckCardInput[]) => validate(cards).errors.map((e) => e.code).sort();

describe("Riftbound deck rules", () => {
  it("accepts a legal constructed deck", () => expect(validate(legal())).toEqual({ valid: true, errors: [] }));
  it("requires exactly one Legend", () => {
    expect(codes(legal().filter((c) => c.zone !== "legend"))).toEqual(["legend"]);
    expect(codes([...legal(), legend({ cardId: 3 })])).toEqual(["legend"]);
    const notALegend = legal().map((c) => (c.zone === "legend" ? { ...c, attrs: { ...c.attrs, "Card Type": "Unit" } } : c));
    expect(codes(notALegend)).toEqual(["legend"]);
    expect(validate(notALegend).errors[0]).toMatchObject({ cardId: 1, message: expect.stringMatching(/not a Legend/) });
  });
  it("requires one Chosen Champion that is a Champion Unit sharing the Legend's tag", () => {
    const none = legal().filter((c) => c.zone !== "champion");
    expect(codes(none)).toEqual(["champion", "size"]);
    const wrong = legal().map((c) => (c.zone === "champion" ? { ...c, attrs: { ...c.attrs, Tag: "Ahri;Ionia" } } : c));
    expect(codes(wrong)).toEqual(["champion"]);
    const notChampion = legal().map((c) => (c.zone === "champion" ? { ...c, attrs: { ...c.attrs, "Card Type": "Unit" } } : c));
    expect(codes(notChampion)).toEqual(["champion"]);
  });
  it("main deck is exactly 40 counting the Chosen Champion", () => {
    const d = legal(); d[2].quantity = 2;
    const r = validate(d);
    expect(r.errors.map((e) => e.code)).toEqual(["size"]);
    expect(r.errors[0].message).toMatch(/39/);
  });
  it("limits any name to 3 copies across main deck and Chosen Champion", () => {
    const d = legal(); d[2].quantity = 1; d.push(unit("Renekton, Rampager", 2, 2, "Fury", { attrs: { "Card Type": "Champion Unit", Tag: "Renekton;Shurima", Domain: "Fury" } }));
    // 1 (champion) + 2 (main) = 3 → fine; +1 more breaks it
    expect(codes(d)).toEqual([]);
    d[d.length - 1].quantity = 3; d[3].quantity = 2; // keep 40
    expect(codes(d)).toEqual(["copies"]);
  });
  it("allows at most 3 Signature cards, all tagged for the Legend", () => {
    const d = legal(); d[2].quantity = 1; d[3].quantity = 2;
    d.push(card({ name: "Renekton's Wrath", cardId: 70, quantity: 3, attrs: { "Card Type": "Signature Spell", Tag: "Renekton", Domain: "Fury" } }));
    expect(codes(d)).toEqual([]);
    // a 4th Signature card of a different name (a 4th copy of the same one would also be a copies error)
    d.push(card({ name: "Dominus", cardId: 72, quantity: 1, attrs: { "Card Type": "Signature Spell", Tag: "Renekton", Domain: "Fury;Body" } })); d[3].quantity = 1;
    expect(codes(d)).toEqual(["signature"]);
    const foreign = legal(); foreign[2].quantity = 1;
    foreign.push(card({ name: "Ahri's Charm", cardId: 71, quantity: 2, attrs: { "Card Type": "Signature Spell", Tag: "Ahri", Domain: "Fury" } }));
    expect(codes(foreign)).toEqual(["signature"]);
  });
  it("every main-deck card and rune must be within the Legend's domains (multi-domain needs all)", () => {
    const d = legal(); d[2] = unit("Unit 0", 10, 3, "Mind");
    const r = validate(d);
    expect(r.errors.map((e) => e.code)).toEqual(["domain"]);
    expect(r.errors[0].cardId).toBe(10);
    const multi = legal(); multi[2] = unit("Unit 0", 10, 3, "Fury;Chaos");
    expect(codes(multi)).toEqual(["domain"]);
    const colorless = legal(); colorless[2] = unit("Unit 0", 10, 3, "None");
    expect(codes(colorless)).toEqual([]);
    const badRune = legal(); badRune[badRune.length - 5] = rune("Mind", 50, 6);
    expect(codes(badRune)).toEqual(["domain"]);
  });
  it("requires exactly 12 runes and 3 distinct battlefields", () => {
    const d = legal(); d[d.length - 4].quantity = 5;
    expect(codes(d)).toEqual(["rune"]);
    const two = legal().filter((c) => c.name !== "Bandle");
    expect(codes(two)).toEqual(["battlefield"]);
    const dupe = legal(); dupe[dupe.length - 1] = bf("Heisho", 63);
    expect(codes(dupe)).toEqual(["battlefield"]);
  });
  it("keeps legends, runes, battlefields and tokens out of the main deck", () => {
    const d = legal(); d[2].quantity = 1;
    d.push(card({ name: "Body Rune", cardId: 80, quantity: 1, attrs: { "Card Type": "Rune", Domain: "Body" } }));
    d.push(card({ name: "Poro", cardId: 81, quantity: 1, attrs: { "Card Type": "Unit;Token", Domain: "Body" } }));
    expect(codes(d)).toEqual(["zone", "zone"]);
    // a Legend or a Battlefield filed under main is still counted toward the 40 (no size error) but flagged
    const e = legal(); e[2].quantity = 1;
    e.push(legend({ cardId: 90, zone: "main" }), bf("Targon", 91, { zone: "main" }));
    expect(codes(e)).toEqual(["zone", "zone"]);
    // a card in a zone Riftbound doesn't use is flagged and belongs to no zone
    const f = legal(); f.push(unit("Unit 0", 10, 1, "Body", { zone: "leader" }));
    expect(codes(f)).toEqual(["zone"]);
  });
});

describe("Riftbound deck rules — catalog shapes (verified 2026-09-08)", () => {
  it("the champion tag may sit anywhere in a `;`-joined Tag, and a Champion Unit with no Domain is colourless", () => {
    // "Ornn, Forge God" is the one Champion Unit in the catalog with no Domain; champion tags read "Freljord;Ornn"
    const d = legal(); d[1] = champion({ attrs: { "Card Type": "Champion Unit", Tag: "Shurima;Renekton" } });
    expect(codes(d)).toEqual([]);
  });
  it("Signature cards match the Legend by any tag and may carry its full two-domain identity", () => {
    // e.g. "Forgefire Cape" is a Signature Gear tagged "Equipment;Ornn"; "Dominus" is Renekton's Signature Spell in "Fury;Body"
    const d = legal(); d[2].quantity = 2;
    d.push(card({ name: "Dominus", cardId: 72, quantity: 1, attrs: { "Card Type": "Signature Gear", Tag: "Equipment;Renekton", Domain: "Fury;Body" } }));
    expect(codes(d)).toEqual([]);
  });
  it("`Unit;Gear` is an ordinary main-deck card; `None`-typed and attr-less cards are not", () => {
    const d = legal(); d[2].quantity = 1;
    d.push(card({ name: "Patched Porobot", cardId: 73, quantity: 2, attrs: { "Card Type": "Unit;Gear", Tag: "Mech;Piltover;Poro", Domain: "Body" } }));
    expect(codes(d)).toEqual([]);
    const e = legal(); e[2].quantity = 1;
    e.push(card({ name: "Buff // Buff (Fist Bump Promo)", cardId: 74, quantity: 1, attrs: { "Card Type": "None" } }));
    e.push(card({ name: "Ornn, Blacksmith (Alternate Art)", cardId: 75, quantity: 1, attrs: {} }));
    const r = validate(e);
    expect(r.errors.map((x) => x.code)).toEqual(["zone", "zone"]);
    expect(r.errors[1].message).toMatch(/unknown type/);
  });
  it("non-Runes in the rune zone and non-Battlefields in the battlefield zone are flagged even when the counts are right", () => {
    const d = legal(); d[16] = unit("Unit 0", 10, 6, "Body", { zone: "rune" });
    const r = validate(d);
    expect(r.errors.map((x) => x.code)).toEqual(["rune"]);
    expect(r.errors[0].cardId).toBe(10);
    const e = legal(); e[19] = unit("Unit 0", 10, 1, "Body", { zone: "battlefield" });
    expect(codes(e)).toEqual(["battlefield"]);
  });
  it("tokens are never deck cards, even when typed as a Battlefield, Rune, Legend or Champion Unit", () => {
    // real catalog shapes: "Gear;Battlefield;Token", "Battlefield;Token", "Unit;Battlefield;Token"
    const d = legal(); d[19] = bf("Bandle", 62, { attrs: { "Card Type": "Gear;Battlefield;Token" } });
    const r = validate(d);
    expect(r.errors.map((x) => x.code)).toEqual(["battlefield"]);
    expect(r.errors[0]).toMatchObject({ cardId: 62, message: "Bandle is a token, not a Battlefield" });
    const e = legal(); e[18] = bf("Targon", 61, { attrs: { "Card Type": "Unit;Battlefield;Token" } });
    expect(codes(e)).toEqual(["battlefield"]);
    const f = legal(); f[16] = { ...rune("Body", 51, 6), attrs: { "Card Type": "Rune;Token", Domain: "Body" } };
    expect(codes(f)).toEqual(["rune"]);
    const g = legal(); g[0] = legend({ attrs: { "Card Type": "Legend;Token", Tag: "Renekton", Domain: "Fury;Body" } });
    expect(validate(g).errors.map((x) => x.code)).toEqual(["legend"]);
    const h = legal(); h[1] = champion({ attrs: { "Card Type": "Champion Unit;Token", Tag: "Renekton;Shurima", Domain: "Fury" } });
    expect(codes(h)).toEqual(["champion"]);
  });
  it("battlefields are colourless in the catalog (Domain `None` or missing) but obey domain identity when they carry one (Core Rules 103.4.b)", () => {
    const d = legal(); d[19] = bf("Bandle", 62, { attrs: { "Card Type": "Battlefield", Domain: "None" } });
    expect(codes(d)).toEqual([]);
    const e = legal(); e[19] = bf("Bandle", 62, { attrs: { "Card Type": "Battlefield", Domain: "Fury" } });
    expect(codes(e)).toEqual([]);
    const f = legal(); f[19] = bf("Bandle", 62, { attrs: { "Card Type": "Battlefield", Domain: "Mind" } });
    const r = validate(f);
    expect(r.errors.map((x) => x.code)).toEqual(["domain"]);
    expect(r.errors[0].cardId).toBe(62);
  });
  it("alt-art printings are the same card: for copies and for distinct battlefields", () => {
    const d = legal(); d[2].quantity = 1;
    d.push(unit("Unit 1 (Alternate Art)", 500, 2, "Fury")); // Unit 1 is 3 already → 5
    const r = validate(d);
    expect(r.errors.map((x) => x.code)).toEqual(["copies"]);
    expect(r.errors[0].cardId).toBe(11);
    const e = legal(); e[19] = bf("Heisho (Alternate Art)", 63);
    expect(codes(e)).toEqual(["battlefield"]);
    const runes = legal(); runes[16] = { ...rune("Body", 51, 6), name: "Body Rune (R04a)" };
    expect(codes(runes)).toEqual([]);
  });
  it("tags and domains compare trimmed and case-insensitively", () => {
    const d = legal();
    d[0] = legend({ attrs: { "Card Type": "Legend", Tag: "renekton", Domain: " fury ; BODY" } });
    d[1] = champion({ attrs: { "Card Type": "Champion Unit", Tag: "RENEKTON ; Shurima", Domain: "FURY" } });
    d[16] = rune("body", 51, 6);
    expect(codes(d)).toEqual([]);
  });
  it("reports every problem at once", () => {
    const d = [legend(), champion(), unit("Unit 0", 10, 5, "Mind")];
    expect(codes(d)).toEqual(["battlefield", "copies", "domain", "rune", "size"]);
    // with no Legend there is no identity or champion tag to check against
    expect(codes(d.slice(1))).toEqual(["battlefield", "copies", "legend", "rune", "size"]);
  });
});
