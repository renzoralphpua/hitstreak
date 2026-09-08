"use server";
// Meta-deck curation. Every action re-checks the session AND admin-ness: `withUser` only proves someone
// is signed in, so each body calls isAdminUser before touching a curated row. Failures come back as
// { ok: false, error } like every other action module.
import { revalidatePath } from "next/cache";
import { withUser, assertId, assertQuantity } from "@/lib/action-utils";
import { isGameSlug, ZONES, type GameSlug, type Zone } from "@/lib/decks/types";
import { parseDecklist, resolveDecklist, type Resolution } from "@/lib/decks/resolve";
import * as D from "@/lib/decks/data";

const TEXT_MAX = 20_000; // a decklist is a few hundred bytes; this is the "someone pasted a book" guard

async function assertAdmin(userId: string) {
  if (!(await D.isAdminUser(userId))) throw new Error("Admins only");
}

/** Paste → parsed lines resolved against the catalog. A read, but admin-gated like the rest of the screen. */
export async function resolveDecklistAction(gameSlug: string, text: string) {
  return withUser<Resolution[]>(async (u) => {
    await assertAdmin(u);
    if (!isGameSlug(gameSlug)) throw new Error("Unknown game");
    if (typeof text !== "string" || text.length > TEXT_MAX) throw new Error("That list is too long");
    return resolveDecklist(gameSlug, parseDecklist(text, gameSlug));
  });
}

export interface SaveMetaDeckInput {
  id?: number; gameSlug: string; name: string; archetype?: string | null; tier?: number | null;
  format?: string | null; sourceNote?: string | null; lines: D.DeckLineInput[];
}

/** Every line is re-checked here — ids, zones and quantities all arrive from the client. */
function assertLines(gameSlug: GameSlug, lines: D.DeckLineInput[]): D.DeckLineInput[] {
  const zones = ZONES[gameSlug] as readonly string[];
  return lines.map((l) => {
    if (!zones.includes(l.zone)) throw new Error(`Zone "${l.zone}" is not used by this game`);
    return { cardId: assertId(l.cardId), zone: l.zone as Zone, quantity: assertQuantity(l.quantity) };
  });
}

export async function saveMetaDeckAction(input: SaveMetaDeckInput) {
  const r = await withUser(async (u) => {
    await assertAdmin(u);
    if (!isGameSlug(input.gameSlug)) throw new Error("Unknown game");
    const gameSlug: GameSlug = input.gameSlug;
    return D.upsertMetaDeck(u, {
      ...input,
      id: input.id == null ? undefined : assertId(input.id),
      gameSlug,
      lines: assertLines(gameSlug, input.lines ?? []),
    });
  });
  if (r.ok) { revalidatePath("/admin/decks"); revalidatePath("/decks"); }
  return r;
}

export async function deleteMetaDeckAction(id: number) {
  const r = await withUser(async (u) => {
    await assertAdmin(u);
    if (!(await D.deleteMetaDeck(u, assertId(id)))) throw new Error("Deck not found");
  });
  if (r.ok) { revalidatePath("/admin/decks"); revalidatePath("/decks"); }
  return r;
}
