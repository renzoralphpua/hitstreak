// lib/decks/rules/pokemon.ts — exactly 60; ≥1 Basic Pokémon; ≤4 per base name (Basic Energy exempt);
// ≤1 ACE SPEC; ≤1 Radiant. Standard-format (regulation mark) legality is NOT checked: tcgcsv carries no marks.
import type { DeckInput, DeckCardInput, ValidationError, ValidationResult } from "../types";
import { baseName } from "../identity";

const POKEMON_TYPES = new Set(["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Fairy", "Dragon", "Colorless"]);
const BASIC_ENERGY_NAME = /^(Basic )?(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/i;
const DECK_SIZE = 60, MAX_COPIES = 4;

export const isPokemon = (c: DeckCardInput) => POKEMON_TYPES.has(c.attrs["Card Type"] ?? "");
export const isBasicPokemon = (c: DeckCardInput) => isPokemon(c) && (c.attrs.Stage ?? "") === "Basic";
export const isBasicEnergy = (c: DeckCardInput) => {
  const t = c.attrs["Card Type"] ?? "";
  return t === "Basic Energy" || (t === "Energy" && BASIC_ENERGY_NAME.test(baseName(c.name)));
};
const isAceSpec = (c: DeckCardInput) => /ace spec|rare ace/i.test(c.rarity ?? "");
const isRadiant = (c: DeckCardInput) => /radiant/i.test(c.rarity ?? "");

export function validatePokemon({ cards }: DeckInput): ValidationResult {
  const errors: ValidationError[] = [];
  const main = cards.filter((c) => c.zone === "main");
  for (const c of cards) if (c.zone !== "main") errors.push({ code: "zone", message: `${baseName(c.name)} is in a zone Pokémon decks don't use (${c.zone})`, cardId: c.cardId });

  // Size counts every card, whatever zone it was put in: a mis-zoned card is still one of the 60, and gets its own "zone" error.
  const total = cards.reduce((n, c) => n + c.quantity, 0);
  if (total !== DECK_SIZE) errors.push({ code: "size", message: `A deck must have exactly ${DECK_SIZE} cards (this one has ${total})` });
  if (!main.some(isBasicPokemon)) errors.push({ code: "no-basic", message: "A deck needs at least one Basic Pokémon" });

  const byName = new Map<string, { n: number; cardId: number; name: string }>();
  for (const c of main) {
    if (isBasicEnergy(c)) continue;
    const key = baseName(c.name).toLowerCase();
    const e = byName.get(key) ?? { n: 0, cardId: c.cardId, name: baseName(c.name) };
    e.n += c.quantity;
    byName.set(key, e);
  }
  for (const e of byName.values()) if (e.n > MAX_COPIES) errors.push({ code: "copies", message: `${e.name}: ${e.n} copies (max ${MAX_COPIES})`, cardId: e.cardId });

  const aces = main.filter(isAceSpec).reduce((n, c) => n + c.quantity, 0);
  if (aces > 1) errors.push({ code: "ace-spec", message: `${aces} ACE SPEC cards (max 1)` });
  const radiants = main.filter(isRadiant).reduce((n, c) => n + c.quantity, 0);
  if (radiants > 1) errors.push({ code: "radiant", message: `${radiants} Radiant Pokémon (max 1)` });

  return { valid: errors.length === 0, errors };
}
