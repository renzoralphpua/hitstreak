// lib/route-id.ts
// Strict numeric-id parser for dynamic route segments (`[id]`). Next hands these to us as raw
// strings; `Number(...)` is too permissive (accepts "1e3", "+5", "2.0", "", leading/trailing
// whitespace) so a malformed segment can slip through as a valid-looking id. Route pages should
// treat anything that doesn't match as not-found rather than let it reach the database.
const ROUTE_ID = /^[1-9]\d{0,9}$/;

/** A positive integer, no leading zero, up to 10 digits — or `null` if `raw` isn't one. */
export function parseRouteId(raw: string): number | null {
  return ROUTE_ID.test(raw) ? Number(raw) : null;
}
