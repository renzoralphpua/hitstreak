// The one thing MetaDeckRow and CurationForm agree on. They are sibling client islands under a Server
// Component page, so "Edit" travels as a window CustomEvent rather than a callback prop: the page stays
// a Server Component (no state above it) and neither island imports the other.
export const EDIT_EVENT = "hitstreak:edit-deck";

/** What "Edit" puts on the wire — everything CurationForm needs to reload the deck into its fields. */
export interface EditDeckDetail {
  id: number; gameSlug: string; name: string; archetype: string | null; tier: number | null;
  format: string | null; sourceNote: string | null; decklist: string;
}
