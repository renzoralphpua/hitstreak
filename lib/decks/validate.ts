// lib/decks/validate.ts — spec §8: one contract, one module per game, pure functions over attrs.
import type { DeckInput, ValidationResult, GameSlug } from "./types";
import { validatePokemon } from "./rules/pokemon";
import { validateOnePiece } from "./rules/one-piece";
import { validateRiftbound } from "./rules/riftbound";

const RULES: Record<GameSlug, (input: DeckInput) => ValidationResult> = { pokemon: validatePokemon, "one-piece": validateOnePiece, riftbound: validateRiftbound };

export function validateDeck(input: DeckInput): ValidationResult {
  const r = RULES[input.gameSlug](input);
  return { valid: r.errors.length === 0, errors: r.errors };
}

/** Human-readable rule list per game, for ValidationList: each rule is ok unless an error with its code exists. */
export const RULE_TEXT: Record<GameSlug, Array<{ code: string; text: string }>> = {
  pokemon: [
    { code: "size", text: "Exactly 60 cards" }, { code: "no-basic", text: "At least one Basic Pokémon" },
    { code: "copies", text: "No more than 4 of a card (Basic Energy excepted)" }, { code: "ace-spec", text: "At most one ACE SPEC" },
    { code: "radiant", text: "At most one Radiant Pokémon" }, { code: "zone", text: "Only main-deck cards" },
  ],
  "one-piece": [
    { code: "leader", text: "Exactly one Leader" }, { code: "size", text: "Exactly 50 cards in the main deck" },
    { code: "copies", text: "No more than 4 of a card number" }, { code: "color", text: "Every card shares a colour with the Leader" },
    { code: "zone", text: "Leaders only in the Leader slot" },
  ],
  riftbound: [
    { code: "legend", text: "Exactly one Legend" }, { code: "champion", text: "One Chosen Champion matching the Legend" },
    { code: "size", text: "Exactly 40 main-deck cards including the Chosen Champion" }, { code: "copies", text: "No more than 3 of a card" },
    { code: "signature", text: "At most 3 Signature cards, all for your Legend" }, { code: "domain", text: "Every card within the Legend's domains" },
    { code: "rune", text: "Exactly 12 runes in your domains" }, { code: "battlefield", text: "Exactly 3 different Battlefields" }, { code: "zone", text: "Only units, spells and gear in the main deck" },
  ],
};
export function describeRules(input: DeckInput): Array<{ ok: boolean; text: string }> {
  const failed = new Set(validateDeck(input).errors.map((e) => e.code));
  return RULE_TEXT[input.gameSlug].map((r) => ({ ok: !failed.has(r.code), text: r.text }));
}
