// lib/decks/identity.ts
// "Same card" per game. tcgcsv names carry printing noise ("Rare Candy - 191/198", "Pikachu (Cosmos Holo)",
// "Loki (OP17-119) (Alternate Art)"); baseName strips it. Pokémon and Riftbound reprints/alt arts are the
// same card by name; One Piece alt arts share attrs.Number, so number is the identity there.
import type { GameSlug } from "./types";

// " - <number>[/<denominator>]" and whatever follows it. Number shapes seen in the catalog: "191/198",
// "TG05/TG30", "GG01/GG70", "SV040/SV122", "226/S-P", "S1/S4", and slash-less promos "054", "003 [Staff]".
// The number must lead with an (optionally letter-prefixed) digit run, and only a parenthetical, a bracket,
// or another " - …" segment ("097/162 - 2024 (Sakuya O.)") may follow it — so product names such as
// "Code Card - Scarlet & Violet Booster Box" or "Code Card - 151 Booster Pack" are left alone.
const PRINTING_SUFFIX = /\s+-\s+[A-Za-z]*\d+[A-Za-z]?(?:\/[A-Za-z0-9-]+)?(?:\s*[(\[].*|\s+-\s.*)?$/;
const TRAILING_PARENS = /(\s*\([^)]*\))+\s*$/; // "(Alternate Art)", "(Secret)", "(OP17-119) (Alt)"

/** Strips " - 123/456…" printing suffixes and trailing parentheticals, collapses whitespace. */
export function baseName(name: string): string {
  return name
    .replace(PRINTING_SUFFIX, "")
    .replace(TRAILING_PARENS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** `;`-joined attr lists (One Piece Color, Riftbound Domain/Tag) → trimmed items. */
export const splitList = (v: string | undefined | null): string[] =>
  (v ?? "").split(";").map((s) => s.trim()).filter(Boolean);

export function identityKey(game: GameSlug, card: { name: string; attrs: Record<string, string> }): string {
  if (game === "one-piece") {
    const n = card.attrs.Number?.trim();
    if (n) return `num:${n.toUpperCase()}`;
  }
  return `name:${baseName(card.name).toLowerCase()}`;
}
