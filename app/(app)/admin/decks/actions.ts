"use server";
// Meta-deck curation. Every action re-checks the session AND admin-ness: `withUser` only proves someone
// is signed in, so each body calls isAdminUser before touching a curated row. Failures come back as
// { ok: false, error } like every other action module.
import { revalidatePath } from "next/cache";
import { withUser, assertId, assertOptionalText, assertQuantity } from "@/lib/action-utils";
import { isGameSlug, MAX_LINES, ZONES, type GameSlug, type Zone } from "@/lib/decks/types";
import { parseDecklist, resolveDecklist, type Resolution } from "@/lib/decks/resolve";
import * as D from "@/lib/decks/data";

const TEXT_MAX = 20_000; // a decklist is a few hundred bytes; this is the "someone pasted a book" guard
const META_TEXT_MAX = 200; // archetype / format / source note; the form's fields are far shorter

async function assertAdmin(userId: string) {
  if (!(await D.isAdminUser(userId))) throw new Error("Admins only");
}

/** Paste → parsed lines resolved against the catalog. A read, but admin-gated like the rest of the screen. */
export async function resolveDecklistAction(gameSlug: string, text: string) {
  return withUser<Resolution[]>(async (u) => {
    await assertAdmin(u);
    if (!isGameSlug(gameSlug)) throw new Error("Unknown game");
    if (typeof text !== "string" || text.length > TEXT_MAX) throw new Error("That list is too long");
    // TEXT_MAX bounds characters, not lines, and resolveDecklist runs up to two sequential queries per
    // line: 20 KB of "1 x\n" is ~5,000 lines, i.e. ~10,000 round trips held open in one server action.
    // The line count is the bound that matters, and it is the one checkLines would reject anyway.
    const lines = parseDecklist(text, gameSlug);
    if (lines.length > MAX_LINES) throw new Error(`A deck can have at most ${MAX_LINES} lines`);
    return resolveDecklist(gameSlug, lines);
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
      // `name` is capped by cleanName and `tier` by its range check; these three would otherwise reach
      // SQL exactly as the client sent them, string or not.
      archetype: assertOptionalText(input.archetype, META_TEXT_MAX),
      format: assertOptionalText(input.format, META_TEXT_MAX),
      sourceNote: assertOptionalText(input.sourceNote, META_TEXT_MAX),
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
