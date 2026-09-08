// lib/action-utils.ts
// Helpers shared by every server-action module (portfolios, alerts). Not a "use server" file: it
// exports a type and a synchronous function, which that directive forbids, so the action files
// import from here instead.
import { getSession } from "@/lib/session";
import { QTY_MAX } from "@/lib/decks/types";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Row ids arrive from the client, so they are only trustworthy as far as this check: anything
 *  that isn't a positive integer (NaN, a string, a float, null) is rejected before it reaches SQL. */
export function assertId(n: unknown): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) throw new Error("Invalid id");
  return n;
}

/** Same rule as `checkLines` in lib/decks/data.ts, applied before anything reads the number: the
 *  validators allocate per copy, so an unbounded quantity is a cheap way to burn the server. Shared
 *  by the builder's save and the curation screen so both bound the input the same way. */
export function assertQuantity(n: unknown): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > QTY_MAX) throw new Error(`Quantity must be a whole number from 1 to ${QTY_MAX}`);
  return n;
}

/** An optional free-text column (archetype, format, a source note). Null/undefined pass through as
 *  null; anything else must be a string, and it is trimmed, with an empty result folded back to null
 *  so " " never becomes a stored blank. The cap is the point: without it a direct action call can put
 *  a megabyte — or a non-string — into a column no form would ever fill past a few dozen characters. */
export function assertOptionalText(v: unknown, max: number): string | null {
  if (v == null) return null;
  if (typeof v !== "string") throw new Error("That value must be text");
  const t = v.trim();
  if (t.length === 0) return null;
  if (t.length > max) throw new Error(`That value must be at most ${max} characters`);
  return t;
}

/** Re-checks the session (a client can call an action directly) and turns any thrown validation or
 *  ownership error into `{ ok: false, error }` so nothing is thrown to the client. */
export async function withUser<T>(fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  try {
    return { ok: true, data: await fn(session.user.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
