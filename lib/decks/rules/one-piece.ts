// lib/decks/rules/one-piece.ts — exactly 1 Leader + exactly 50; ≤4 per card number (alt arts share it);
// every main-deck card shares ≥1 colour with the Leader. DON!! cards are not deck cards.
//
// Catalog shapes (verified 2026-09-08): CardType ∈ Leader / Character / Event / Stage / DON!! (sealed product has
// no attrs at all); Color is Title-case `;`-joined ("Green;Purple") with no spaces — compared trimmed and
// case-insensitively anyway; five promo Luffy Leaders list all six colours. 17 real cards carry a CardType but no
// Color (10 Characters, 4 Events, 3 alt-art Leaders): colourless cards are never colour-checked, and a colourless
// Leader checks nothing rather than flagging the whole deck. Number is uppercase "OP08-118" / "P-084"; five promo
// Leaders and all DON!! cards have none, so a missing Number falls back to the base name.
import type { DeckInput, DeckCardInput, ValidationError, ValidationResult } from "../types";
import { baseName, splitList } from "../identity";

const MAIN_SIZE = 50, MAX_COPIES = 4;
const cardType = (c: DeckCardInput) => (c.attrs.CardType ?? "").trim().toLowerCase();
const isLeader = (c: DeckCardInput) => cardType(c) === "leader";
const isDon = (c: DeckCardInput) => cardType(c) === "don!!";
const numberOf = (c: DeckCardInput) => (c.attrs.Number ?? "").trim().toUpperCase() || `name:${baseName(c.name).toLowerCase()}`;
const colorsOf = (c: DeckCardInput) => splitList(c.attrs.Color).map((s) => s.toLowerCase());

export function validateOnePiece({ cards }: DeckInput): ValidationResult {
  const errors: ValidationError[] = [];
  const leaders = cards.filter((c) => c.zone === "leader");
  // As in the Pokémon rules, a mis-zoned card gets its own "zone" error and is otherwise treated as part of the deck:
  // a card in a zone One Piece doesn't use, a Leader in the main deck, or a DON!! anywhere still counts toward the 50,
  // toward its number's copies, and against the Leader's colours.
  const main = cards.filter((c) => c.zone !== "leader");
  for (const c of main) {
    if (c.zone !== "main") errors.push({ code: "zone", message: `${baseName(c.name)} is in a zone One Piece decks don't use (${c.zone})`, cardId: c.cardId });
    else if (isLeader(c)) errors.push({ code: "zone", message: `${baseName(c.name)} is a Leader and belongs in the Leader slot`, cardId: c.cardId });
  }
  for (const c of cards) if (isDon(c)) errors.push({ code: "zone", message: `${baseName(c.name)} is a DON!! card, not a deck card`, cardId: c.cardId });

  const leaderCount = leaders.reduce((n, c) => n + c.quantity, 0);
  if (leaderCount !== 1 || !leaders.every(isLeader)) {
    errors.push({ code: "leader", message: leaderCount === 0 ? "Pick a Leader" : leaderCount === 1 ? `${baseName(leaders[0].name)} is not a Leader card` : `Exactly one Leader card in the Leader slot (found ${leaderCount})` });
  }

  const total = main.reduce((n, c) => n + c.quantity, 0);
  if (total !== MAIN_SIZE) errors.push({ code: "size", message: `The main deck must have exactly ${MAIN_SIZE} cards (this one has ${total})` });

  const byNumber = new Map<string, { n: number; cardId: number }>();
  for (const c of main) {
    const k = numberOf(c);
    const e = byNumber.get(k) ?? { n: 0, cardId: c.cardId };
    e.n += c.quantity;
    byNumber.set(k, e);
  }
  for (const [k, e] of byNumber) if (e.n > MAX_COPIES) errors.push({ code: "copies", message: `${k.replace(/^name:/, "")}: ${e.n} copies (max ${MAX_COPIES})`, cardId: e.cardId });

  const leader = leaders.length === 1 && isLeader(leaders[0]) ? leaders[0] : null;
  const leaderColors = leader ? new Set(colorsOf(leader)) : null;
  if (leaderColors && leaderColors.size > 0) {
    for (const c of main) {
      const own = colorsOf(c);
      if (own.length > 0 && !own.some((col) => leaderColors.has(col))) errors.push({ code: "color", message: `${baseName(c.name)} (${own.join("/")}) doesn't match the Leader's colours`, cardId: c.cardId });
    }
  }
  return { valid: errors.length === 0, errors };
}
