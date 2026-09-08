"use server";
// Mutations for personal decks. Same contract as the portfolio and alert actions: the session is
// re-checked, ids are validated before SQL, failures come back as { ok: false, error }. The deck is
// validated HERE, from the catalog's own attrs — the client's copy is never trusted.
import { revalidatePath } from "next/cache";
import { withUser, assertId } from "@/lib/action-utils";
import { validateDeck } from "@/lib/decks/validate";
import { isGameSlug, QTY_MAX, type GameSlug, type ValidationError, type Zone, ZONES } from "@/lib/decks/types";
import * as D from "@/lib/decks/data";

/** Same rule as `checkLines` in lib/decks/data.ts, applied before anything reads the number: the
 *  validators allocate per copy, so an unbounded quantity is a cheap way to burn the server. */
function assertQuantity(n: unknown): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > QTY_MAX) throw new Error(`Quantity must be a whole number from 1 to ${QTY_MAX}`);
  return n;
}

function assertLines(gameSlug: GameSlug, lines: D.DeckLineInput[]): D.DeckLineInput[] {
  const zones = ZONES[gameSlug] as readonly string[];
  return lines.map((l) => {
    if (!zones.includes(l.zone)) throw new Error(`Zone "${l.zone}" is not used by this game`);
    return { cardId: assertId(l.cardId), zone: l.zone as Zone, quantity: assertQuantity(l.quantity) };
  });
}

export async function createDeckAction(gameSlug: string, name: string) {
  const r = await withUser(async (u) => {
    if (!isGameSlug(gameSlug)) throw new Error("Unknown game");
    return D.createDeck(u, { gameSlug, name });
  });
  if (r.ok) revalidatePath("/decks/mine");
  return r;
}

export async function renameDeckAction(id: number, name: string) {
  const r = await withUser(async (u) => {
    if (!(await D.renameDeck(u, assertId(id), name))) throw new Error("Deck not found");
  });
  if (r.ok) { revalidatePath("/decks/mine"); revalidatePath(`/decks/mine/${id}`); }
  return r;
}

export async function deleteDeckAction(id: number) {
  const r = await withUser(async (u) => {
    if (!(await D.deleteDeck(u, assertId(id)))) throw new Error("Deck not found");
  });
  if (r.ok) revalidatePath("/decks/mine");
  return r;
}

/** Replaces the deck's lines and records whether it is legal. Returns the authoritative verdict. */
export async function saveDeckAction(id: number, lines: D.DeckLineInput[]) {
  const r = await withUser<{ valid: boolean; errors: ValidationError[] }>(async (u) => {
    const deckId = assertId(id);
    const deck = await D.getDeck(deckId, u);
    // getDeck also returns curated decks: they are read-only here, so they read as "not found".
    if (!deck || deck.isMeta) throw new Error("Deck not found");
    const checked = assertLines(deck.gameSlug, lines);
    const cards = await D.loadDeckCardInputs(checked);
    // loadDeckCardInputs drops lines whose card is gone, so this verdict can be optimistic — but
    // saveDeckCards' checkLines rejects those same lines, so an optimistic verdict is never persisted.
    const { valid, errors } = validateDeck({ gameSlug: deck.gameSlug, cards });
    await D.saveDeckCards(u, deckId, checked, !valid);
    return { valid, errors };
  });
  if (r.ok) { revalidatePath(`/decks/mine/${id}`); revalidatePath("/decks/mine"); }
  return r;
}

/** Copies a meta deck (or one of your own) into a new personal deck; returns the new deck's id. */
export async function copyDeckAction(sourceId: number) {
  const r = await withUser(async (u) => {
    const source = await D.getDeck(assertId(sourceId), u);
    if (!source) throw new Error("Deck not found");
    const newId = await D.createDeck(u, { gameSlug: source.gameSlug, name: `${source.name} (copy)`.slice(0, 80) });
    const lines = source.cards.map((l) => ({ cardId: l.cardId, zone: l.zone, quantity: l.quantity }));
    const cards = await D.loadDeckCardInputs(lines);
    const { valid } = validateDeck({ gameSlug: source.gameSlug, cards });
    await D.saveDeckCards(u, newId, lines, !valid);
    return newId;
  });
  if (r.ok) revalidatePath("/decks/mine");
  return r;
}
