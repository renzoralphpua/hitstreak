// lib/action-utils.ts
// Helpers shared by every server-action module (portfolios, alerts). Not a "use server" file: it
// exports a type and a synchronous function, which that directive forbids, so the action files
// import from here instead.
import { getSession } from "@/lib/session";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Row ids arrive from the client, so they are only trustworthy as far as this check: anything
 *  that isn't a positive integer (NaN, a string, a float, null) is rejected before it reaches SQL. */
export function assertId(n: unknown): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) throw new Error("Invalid id");
  return n;
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
