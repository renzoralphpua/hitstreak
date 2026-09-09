// lib/decks/types.ts — the validator contract (spec §8) and the deck vocabulary shared by data, gap, UI.
export const GAME_SLUGS = ["pokemon", "one-piece", "riftbound"] as const;
export type GameSlug = (typeof GAME_SLUGS)[number];
export const isGameSlug = (s: unknown): s is GameSlug => typeof s === "string" && (GAME_SLUGS as readonly string[]).includes(s);

/** Copies allowed on one deck line. Lives here, not in data.ts, so the client bundle can have it too:
 *  it bounds the builder's steppers, the action layer's input check and `checkLines`' final word. */
export const QTY_MAX = 99;

/** Distinct (card, zone) lines a deck may hold. Same reason QTY_MAX lives here rather than in data.ts:
 *  `checkLines` has the final word, but the curation action must bound a paste BEFORE resolving it —
 *  every unresolved line costs up to two sequential catalog queries. */
export const MAX_LINES = 200;

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
