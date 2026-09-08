// lib/decks/identity.ts
// "Same card" per game. tcgcsv names carry printing noise ("Rare Candy - 191/198", "Pikachu (Cosmos Holo)",
// "Loki (OP17-119) (Alternate Art)"); baseName strips it. Pokémon and Riftbound reprints/alt arts are the
// same card by name; One Piece alt arts share attrs.Number, so number is the identity there.
import type { GameSlug } from "./types";

/** Strips " - 123/456…" suffixes and trailing parentheticals, collapses whitespace. */
export function baseName(name: string): string {
  return name
    .replace(/\s+-\s+[A-Za-z]*\d+[A-Za-z]?\/\d+.*$/, "")   // " - 266/182", " - 191/193 (Cosmos Holo)"
    .replace(/(\s*\([^)]*\))+\s*$/, "")                    // "(Alternate Art)", "(Secret)", "(OP17-119) (Alt)"
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
