// lib/decks/zone.ts
// Where a card lands when you add it in the builder, and which zones hold exactly one card.
// Pure (no db): the builder runs this on every search hit.
import { splitList } from "./identity";
import type { GameSlug, Zone } from "./types";

/** Zones that hold a single card: adding a second replaces the first. */
export const SINGLE_CARD_ZONES: readonly Zone[] = ["leader", "legend", "champion"];
export const isSingleCardZone = (z: Zone) => SINGLE_CARD_ZONES.includes(z);

/** The zone a card belongs in, read from its type. Anything unrecognised goes to the main deck, where
 *  the validator will flag it — better a visible wrong row than a silently dropped card. */
export function defaultZone(game: GameSlug, card: { attrs: Record<string, string> }): Zone {
  if (game === "one-piece") return (card.attrs.CardType ?? "").trim() === "Leader" ? "leader" : "main";
  if (game === "riftbound") {
    const types = splitList(card.attrs["Card Type"]);
    if (types.includes("Legend")) return "legend";
    if (types.includes("Rune")) return "rune";
    if (types.includes("Battlefield")) return "battlefield";
    if (types.includes("Champion Unit")) return "champion";
  }
  return "main";
}
