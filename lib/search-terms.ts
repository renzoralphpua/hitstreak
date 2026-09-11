// Turning what someone types into what the catalog actually stores.
//
// Two problems. First, people search the way they talk — "SIR", "alt art", "rev holo" — while the
// catalog stores "Special Illustration Rare", "Alternate Art" and "Reverse Holofoil". Second, the
// two games disagree: Pokémon spells rarities out, One Piece uses codes ("SR", "SEC", "L"), so a
// single query has to be able to hit either.
//
// The answer is per-TOKEN expansion, not a smarter single LIKE: "charizard sir" means a Charizard
// that is a Special Illustration Rare, so each token must match something and all of them must
// match — one fuzzy string across the whole query would return every Charizard.

/** Cap the work one query can ask of the database; nobody usefully searches seven words. */
export const MAX_TOKENS = 6;

/**
 * What people type on the left, what the catalog might store on the right.
 *
 * Every alias is checked as a prefix-or-whole-word match on the typed token, and each expansion is
 * matched as a substring — so "sir" finds "Special Illustration Rare" without "sir" having to
 * appear in it. Short codes stay in the list too, because One Piece really does store "SR".
 */
const ALIASES: Record<string, string[]> = {
  sir: ["Special Illustration Rare"],
  ir: ["Illustration Rare"],
  ur: ["Ultra Rare"],
  sr: ["Secret Rare", "SR"],
  hr: ["Holo Rare"],
  dr: ["Double Rare"],
  sec: ["Secret Rare", "SEC"],
  alt: ["Alternate Art", "Alt Art"],
  altart: ["Alternate Art", "Alt Art"],
  holo: ["Holofoil"],
  rev: ["Reverse Holofoil"],
  revholo: ["Reverse Holofoil"],
  reverse: ["Reverse Holofoil"],
  foil: ["Foil"],
  promo: ["Promo", "PR"],
  full: ["Full Art"],
  fullart: ["Full Art"],
  rainbow: ["Rainbow Rare"],
  gold: ["Gold"],
  shiny: ["Shiny"],
  ex: ["ex"],
  vmax: ["VMAX"],
  vstar: ["VSTAR"],
};

export interface SearchToken {
  /** The token as typed — always tried as-is, so a literal "holofoil" still works. */
  raw: string;
  /** Everything worth matching for this token, the raw term included. */
  terms: string[];
}

/**
 * Splits a query into tokens and expands each one.
 *
 * A multi-word phrase is also kept whole as its own token when it is short, so "alt art" and
 * "illustration rare" survive being split — otherwise "art" alone would match half the catalog.
 */
export function tokenize(query: string): SearchToken[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
  if (words.length === 0) return [];

  // "alt art" → also try "altart", which the alias table knows.
  const joined = words.join("");
  const whole = words.length > 1 && joined.length <= 16 ? ALIASES[joined] : undefined;
  if (whole) return [{ raw: query.trim(), terms: [...new Set([query.trim(), ...whole])] }];

  return words.map((w) => ({
    raw: w,
    terms: [...new Set([w, ...(ALIASES[w] ?? [])])],
  }));
}

/** Escapes a term for a LIKE with `ESCAPE '\'`, then wraps it for a substring match. */
export const likeTerm = (t: string) => `%${t.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
