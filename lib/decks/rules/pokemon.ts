// lib/decks/rules/pokemon.ts — exactly 60; ≥1 Basic Pokémon; ≤4 per base name (Basic Energy exempt);
// ≤1 ACE SPEC; ≤1 Radiant. Standard-format (regulation mark) legality is NOT checked: tcgcsv carries no marks.
//
// The tcgcsv attrs are messy, so the predicates lean on the data rather than on a clean type list:
// - "Card Type" on a Pokémon is usually its energy type ("Fire"), but also "Dark" (46 cards), "Normal", "Electric",
//   typos ("Lighnting"), dual types written "Fire Water" / "Fighting/Darkness" (~150), and NULL on ~270 cards that still
//   carry HP + Stage. A Pokémon is therefore "has HP > 0 and is not typed as a Trainer/Energy": fossils are
//   "Trainer - Item" with HP "60", Supporters/Items/Energies often carry HP "0" — both excluded.
// - Stage is "Basic" (once "bASIC"); compared case-insensitively.
// - Basic Energy is typed "Basic Energy", "Basic <Type> Energy" (361 cards, incl. "Basic FIre Energy"), legacy "Energy",
//   or nothing at all (21 cards, e.g. "Basic Grass Energy - MEE 001"); the last two fall back to the name. Legacy
//   "Darkness Energy (Special)" / "Metal Energy (Special)" are Special Energy and must not pass the name fallback.
import type { DeckInput, DeckCardInput, ValidationError, ValidationResult } from "../types";
import { baseName } from "../identity";

const NOT_A_POKEMON = /trainer|item|supporter|stadium|tool|energy|machine/i;
const BASIC_ENERGY_TYPE = /^Basic \w+ Energy$/i;
const BASIC_ENERGY_NAME = /^(Basic )?(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/i;
const DECK_SIZE = 60, MAX_COPIES = 4;

const cardType = (c: DeckCardInput) => (c.attrs["Card Type"] ?? "").trim();
export const isPokemon = (c: DeckCardInput) => {
  const hp = c.attrs.HP?.trim();
  return hp !== undefined && hp !== "" && Number(hp) > 0 && !NOT_A_POKEMON.test(cardType(c));
};
export const isBasicPokemon = (c: DeckCardInput) => isPokemon(c) && (c.attrs.Stage ?? "").trim().toLowerCase() === "basic";
export const isBasicEnergy = (c: DeckCardInput) => {
  const t = cardType(c);
  if (t === "Basic Energy" || BASIC_ENERGY_TYPE.test(t)) return true;
  if (t !== "Energy" && t !== "") return false;
  if (/\(Special\)/i.test(c.name)) return false;
  // baseName() does not know " - MEE 001" (set code, space, number) as a printing suffix, so test the head segment too.
  return BASIC_ENERGY_NAME.test(baseName(c.name)) || BASIC_ENERGY_NAME.test(baseName(c.name.split(/\s+-\s+/)[0]));
};
const isAceSpec = (c: DeckCardInput) => /ace spec|rare ace/i.test(c.rarity ?? "");
const isRadiant = (c: DeckCardInput) => /radiant/i.test(c.rarity ?? "");

export function validatePokemon({ cards }: DeckInput): ValidationResult {
  const errors: ValidationError[] = [];
  // A mis-zoned card gets its own "zone" error and is otherwise treated as part of the deck: it counts toward the 60,
  // toward its name's copies and the ACE SPEC / Radiant limits, and a Basic Pokémon in the wrong zone still satisfies no-basic.
  for (const c of cards) if (c.zone !== "main") errors.push({ code: "zone", message: `${baseName(c.name)} is in a zone Pokémon decks don't use (${c.zone})`, cardId: c.cardId });

  const total = cards.reduce((n, c) => n + c.quantity, 0);
  if (total !== DECK_SIZE) errors.push({ code: "size", message: `A deck must have exactly ${DECK_SIZE} cards (this one has ${total})` });
  if (!cards.some(isBasicPokemon)) errors.push({ code: "no-basic", message: "A deck needs at least one Basic Pokémon" });

  const byName = new Map<string, { n: number; cardId: number; name: string }>();
  for (const c of cards) {
    if (isBasicEnergy(c)) continue;
    const key = baseName(c.name).toLowerCase();
    const e = byName.get(key) ?? { n: 0, cardId: c.cardId, name: baseName(c.name) };
    e.n += c.quantity;
    byName.set(key, e);
  }
  for (const e of byName.values()) if (e.n > MAX_COPIES) errors.push({ code: "copies", message: `${e.name}: ${e.n} copies (max ${MAX_COPIES})`, cardId: e.cardId });

  const aces = cards.filter(isAceSpec).reduce((n, c) => n + c.quantity, 0);
  if (aces > 1) errors.push({ code: "ace-spec", message: `${aces} ACE SPEC cards (max 1)` });
  const radiants = cards.filter(isRadiant).reduce((n, c) => n + c.quantity, 0);
  if (radiants > 1) errors.push({ code: "radiant", message: `${radiants} Radiant Pokémon (max 1)` });

  return { valid: errors.length === 0, errors };
}
