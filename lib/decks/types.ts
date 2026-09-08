// lib/decks/types.ts — the validator contract (spec §8) and the deck vocabulary shared by data, gap, UI.
export const GAME_SLUGS = ["pokemon", "one-piece", "riftbound"] as const;
export type GameSlug = (typeof GAME_SLUGS)[number];
export const isGameSlug = (s: unknown): s is GameSlug => typeof s === "string" && (GAME_SLUGS as readonly string[]).includes(s);

export type Zone = "main" | "leader" | "legend" | "champion" | "rune" | "battlefield";
/** Zones each game's decks use, in display order. */
export const ZONES: Record<GameSlug, readonly Zone[]> = {
  pokemon: ["main"],
  "one-piece": ["leader", "main"],
  riftbound: ["legend", "champion", "main", "rune", "battlefield"],
};
export const ZONE_LABEL: Record<Zone, string> = { main: "Main deck", leader: "Leader", legend: "Legend", champion: "Chosen champion", rune: "Runes", battlefield: "Battlefields" };

export interface DeckCardInput { cardId: number; name: string; zone: Zone; quantity: number; attrs: Record<string, string>; rarity: string | null }
export interface DeckInput { gameSlug: GameSlug; cards: DeckCardInput[] }
export interface ValidationError { code: string; message: string; cardId?: number }
export interface ValidationResult { valid: boolean; errors: ValidationError[] }
