// lib/decks/zone.ts
// Where a card lands when you add it in the builder, and which zones hold exactly one card.
// Pure (no db): the builder runs this on every search hit.
import { splitList } from "./identity";
import type { GameSlug, Zone } from "./types";

/** Zones that hold a single card: adding a second replaces the first. */
export const SINGLE_CARD_ZONES: readonly Zone[] = ["leader", "legend", "champion"];
export const isSingleCardZone = (z: Zone) => SINGLE_CARD_ZONES.includes(z);

/** The zone a card belongs in, read from its type and the deck it is joining (`lines`, empty by default
 *  = an empty deck). Anything unrecognised goes to the main deck, where the validator will flag it —
 *  better a visible wrong row than a silently dropped card.
 *
 *  Riftbound Champion Units are the one type that depends on `lines`: the first goes to the Chosen
 *  Champion slot, later ones to the main deck, where the rules allow them (they count toward the 40 and
 *  the 3-copy limit alongside the Chosen Champion — see lib/decks/rules/riftbound.ts). Routing them all
 *  to the single-card `champion` zone would silently replace the Chosen Champion on every extra copy. */
export function defaultZone(game: GameSlug, card: { attrs: Record<string, string> }, lines: readonly { zone: Zone }[] = []): Zone {
  if (game === "one-piece") return (card.attrs.CardType ?? "").trim() === "Leader" ? "leader" : "main";
  if (game === "riftbound") {
    const types = splitList(card.attrs["Card Type"]);
    if (types.includes("Legend")) return "legend";
    if (types.includes("Rune")) return "rune";
    if (types.includes("Battlefield")) return "battlefield";
    if (types.includes("Champion Unit")) return lines.some((l) => l.zone === "champion") ? "main" : "champion";
  }
  return "main";
}
