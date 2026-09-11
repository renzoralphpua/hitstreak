// Where a detail screen goes "back" to.
//
// The card page used to hard-code its back link to the card's SET, which is wrong from every other
// entry point: arriving from a collection, from Home's winners, or from a triggered alert and being
// offered "← Obsidian Flames" sends you somewhere you have never been. Callers pass `?from=` and
// the page resolves it to a path and a label; the set remains the fallback, because a card really
// does belong to one.
import { safeNext } from "@/app/(auth)/safe-next";

export interface BackTarget {
  href: string;
  label: string;
}

/** `/collections/12?view=grid` → 12. Null for any other shape, so only a real collection is looked up. */
export function collectionIdFromPath(path: string): number | null {
  const m = /^\/collections\/(\d+)(?:[/?#]|$)/.exec(path);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Resolves `?from=` to a back target, falling back to the set.
 *
 * `from` is untrusted: it arrives in the URL and anyone can type one. It goes through the same
 * `safeNext` guard the auth flow uses, so an off-origin or control-character path can never become
 * a link. The LABEL never comes from the URL either — it is derived from the path's shape, so a
 * crafted `?from=` can change where the arrow points within this app but can never put words in it.
 */
export function resolveBack(
  from: unknown,
  fallback: BackTarget,
  lookup: { collectionName?: string | null } = {}
): BackTarget {
  if (typeof from !== "string" || from === "") return fallback;
  const path = safeNext(from, "");
  if (path === "") return fallback;

  if (collectionIdFromPath(path) != null) {
    // Unnamed means the caller could not find that collection for this user — treat the whole
    // parameter as untrustworthy rather than linking to a collection they may not own.
    return lookup.collectionName ? { href: path, label: lookup.collectionName } : fallback;
  }
  if (/^\/home(?:[/?#]|$)/.test(path)) return { href: path, label: "Home" };
  if (/^\/alerts(?:[/?#]|$)/.test(path)) return { href: path, label: "Alerts" };
  if (/^\/decks(?:[/?#]|$)/.test(path)) return { href: path, label: "Decks" };
  if (/^\/sets(?:[/?#]|$)/.test(path)) return { href: path, label: fallback.label };
  return fallback;
}
