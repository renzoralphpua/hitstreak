// lib/decks/rules/riftbound.ts — Riot Core Rules §103 (constructed): 1 Legend; 1 Chosen Champion (a Champion
// Unit sharing the Legend's champion tag) counted inside an exactly-40 main deck; ≤3 per name across main +
// champion; ≤3 Signature cards, all for the Legend; every main/champion/rune/battlefield card's domains ⊆ the
// Legend's identity ("None"/missing = colourless); exactly 12 runes; exactly 3 distinct Battlefields; no tokens.
//
// Catalog shapes (verified 2026-09-08): `Card Type` ∈ Unit / Champion Unit / Legend / Spell / Gear / Rune /
// Battlefield / Signature Spell / Signature Gear / Signature Unit, plus `;`-joined combos — "Unit;Gear" is a real
// main-deck card (Patched Porobot), anything with "Token" is not; one promo is typed "None" and sealed product /
// a few alt arts carry no attrs at all. Every Legend has exactly one Tag (the champion, e.g. "Kha'Zix") and two
// domains. Champion Units always carry a Tag but the champion is not always first ("Freljord;Ornn"); one has no
// Domain (Ornn, Forge God) and is colourless. Signature cards are multi-tagged ("Equipment;Ornn") and carry the
// Legend's full two-domain identity. Domain and Tag are Title-case with no stray whitespace — compared trimmed
// and case-insensitively anyway. All 71 Battlefields are colourless (Domain "None" or missing); 103.4.b still
// makes them "subject to Domain Identity if applicable", so a Battlefield that does carry a Domain is checked.
// Alt arts ("Body Rune (R04a)", "Bandle Tree (Alternate Art)") are the same card by base name.
import type { DeckInput, DeckCardInput, ValidationError, ValidationResult, Zone } from "../types";
import { ZONES } from "../types";
import { baseName, splitList } from "../identity";

const MAIN_SIZE = 40, MAX_COPIES = 3, MAX_SIGNATURE = 3, RUNES = 12, BATTLEFIELDS = 3;
const MAIN_TYPES = ["Unit", "Champion Unit", "Spell", "Gear", "Signature Spell", "Signature Gear", "Signature Unit"];

const types = (c: DeckCardInput) => splitList(c.attrs["Card Type"]);
const hasType = (c: DeckCardInput, t: string) => types(c).some((x) => x.toLowerCase() === t.toLowerCase());
const isSignature = (c: DeckCardInput) => types(c).some((t) => /^signature/i.test(t));
const isMainType = (c: DeckCardInput) => {
  const ts = types(c);
  return ts.length > 0 && ts.every((t) => MAIN_TYPES.some((m) => m.toLowerCase() === t.toLowerCase()));
};
const domains = (c: DeckCardInput) => splitList(c.attrs.Domain).map((d) => d.toLowerCase()).filter((d) => d !== "none");
const tags = (c: DeckCardInput) => splitList(c.attrs.Tag).map((t) => t.toLowerCase());
const label = (c: DeckCardInput) => baseName(c.name);
const count = (cs: DeckCardInput[]) => cs.reduce((n, c) => n + c.quantity, 0);

export function validateRiftbound({ cards }: DeckInput): ValidationResult {
  const errors: ValidationError[] = [];
  const zone = (z: Zone) => cards.filter((c) => c.zone === z);
  const legends = zone("legend"), champions = zone("champion"), main = zone("main"), runes = zone("rune"), battlefields = zone("battlefield");
  // A card in a zone Riftbound doesn't use belongs to none of the zones above: it is flagged and otherwise ignored.
  for (const c of cards) if (!ZONES.riftbound.includes(c.zone)) errors.push({ code: "zone", message: `${label(c)} is in a zone Riftbound decks don't use (${c.zone})`, cardId: c.cardId });

  const legendCount = count(legends);
  const legend = legends.length === 1 && legendCount === 1 && hasType(legends[0], "Legend") ? legends[0] : null;
  if (!legend) {
    errors.push({ code: "legend", message: legendCount === 0 ? "Pick a Legend" : legendCount === 1 ? `${label(legends[0])} is not a Legend card` : `Exactly one Legend card in the Legend slot (found ${legendCount})` });
  }
  const identity = new Set(legend ? domains(legend) : []);
  const legendTags = new Set(legend ? tags(legend) : []);
  const isForLegend = (c: DeckCardInput) => tags(c).some((t) => legendTags.has(t));

  const championCount = count(champions);
  const champion = champions.length === 1 && championCount === 1 ? champions[0] : null;
  if (!champion) errors.push({ code: "champion", message: championCount === 0 ? "Pick a Chosen Champion" : `Exactly one Chosen Champion (found ${championCount})` });
  else if (!hasType(champion, "Champion Unit")) errors.push({ code: "champion", message: `${label(champion)} is not a Champion Unit`, cardId: champion.cardId });
  else if (legend && !isForLegend(champion)) errors.push({ code: "champion", message: `${label(champion)} is not ${label(legend)}'s champion`, cardId: champion.cardId });

  // The Chosen Champion is one of the main deck's 40 (Core Rules 103.2): it counts toward size and copies.
  // As in the Pokémon and One Piece rules, a mis-typed card in the main deck gets its own "zone" error and is
  // otherwise treated as part of the deck: it still counts toward the 40, its name's copies, and the domain check.
  const deck = [...main, ...champions];
  const total = count(deck);
  if (total !== MAIN_SIZE) errors.push({ code: "size", message: `The main deck must have exactly ${MAIN_SIZE} cards including the Chosen Champion (this one has ${total})` });
  for (const c of main) if (!isMainType(c)) errors.push({ code: "zone", message: `${label(c)} (${types(c).join("/") || "unknown type"}) can't be in the main deck`, cardId: c.cardId });

  const byName = new Map<string, { n: number; cardId: number; name: string }>();
  for (const c of deck) {
    const k = label(c).toLowerCase();
    const e = byName.get(k) ?? { n: 0, cardId: c.cardId, name: label(c) };
    e.n += c.quantity;
    byName.set(k, e);
  }
  for (const e of byName.values()) if (e.n > MAX_COPIES) errors.push({ code: "copies", message: `${e.name}: ${e.n} copies (max ${MAX_COPIES})`, cardId: e.cardId });

  const signatures = deck.filter(isSignature);
  const sigCount = count(signatures);
  if (sigCount > MAX_SIGNATURE) errors.push({ code: "signature", message: `${sigCount} Signature cards (max ${MAX_SIGNATURE})` });
  if (legend) for (const c of signatures) if (!isForLegend(c)) errors.push({ code: "signature", message: `${label(c)} is a Signature card for another champion`, cardId: c.cardId });

  if (legend) {
    for (const c of [...deck, ...runes, ...battlefields]) {
      const off = domains(c).filter((d) => !identity.has(d));
      if (off.length > 0) errors.push({ code: "domain", message: `${label(c)} is ${off.join("/")} — outside ${label(legend)}'s domains`, cardId: c.cardId });
    }
  }

  for (const c of runes) if (!hasType(c, "Rune")) errors.push({ code: "rune", message: `${label(c)} is not a Rune`, cardId: c.cardId });
  const runeCount = count(runes);
  if (runeCount !== RUNES) errors.push({ code: "rune", message: `The rune deck must be exactly ${RUNES} runes (this one has ${runeCount})` });

  for (const c of battlefields) if (!hasType(c, "Battlefield")) errors.push({ code: "battlefield", message: `${label(c)} is not a Battlefield`, cardId: c.cardId });
  const bfNames = battlefields.flatMap((c) => Array<string>(c.quantity).fill(label(c).toLowerCase()));
  const distinct = new Set(bfNames).size;
  if (bfNames.length !== BATTLEFIELDS || distinct !== bfNames.length) {
    errors.push({ code: "battlefield", message: `Exactly ${BATTLEFIELDS} different Battlefields (found ${bfNames.length}${distinct !== bfNames.length ? ", with a duplicate" : ""})` });
  }

  return { valid: errors.length === 0, errors };
}
