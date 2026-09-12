// API TCG (https://api.apitcg.com) behind a DISK CACHE.
//
// The account has a hard monthly request quota, and the API has two properties that make it very easy
// to burn: /api/{tcg}/sets IGNORES `page` and returns the whole list on every call (so a
// "paginate until short page" loop never terminates and re-fetches the same rows forever), and
// /api/history-prices is per PRODUCT (55k printings = 55k requests). Both mistakes have been made.
//
// So: every call goes through `apitcgFetch`, which serves from .cache/apitcg/ when it can and only
// reaches the network for a path it has never seen. Re-running a script costs zero requests. Pass
// `refresh` when you actually want new data — that is the only way to spend quota on a known path.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const API_BASE = "https://api.apitcg.com";
export const CACHE_DIR = join(process.cwd(), ".cache", "apitcg");

/** Games we carry, mapped to API TCG's slug. Their full list is 16; these are ours. */
export const APITCG_SLUG: Record<string, string> = {
  pokemon: "pokemon",
  "one-piece": "one-piece",
  riftbound: "riftbound",
};

export interface FetchOptions {
  /** Spend a request even though the path is cached. The ONLY way to re-fetch. */
  refresh?: boolean;
  /** Count the request without making it, so a script can report its cost before running. */
  dryRun?: boolean;
}

let spent = 0;
/** Requests this process actually sent. Cache hits do not count. */
export const requestsSpent = (): number => spent;

const keyFor = (path: string): string => {
  // The path is the identity, so the name has to be stable and filesystem-safe. A readable prefix
  // makes the cache directory browsable; the hash is what guarantees uniqueness.
  const safe = path.replace(/^\/+/, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
  return `${safe}.${createHash("sha1").update(path).digest("hex").slice(0, 10)}.json`;
};

function apiKey(): string {
  const k = process.env.APITCG_API_KEY;
  if (!k) throw new Error("APITCG_API_KEY is not set (it lives in .env.local)");
  return k;
}

/**
 * GET an API TCG path, from cache when possible.
 *
 * `path` includes the query string, e.g. `/api/pokemon/sets` or
 * `/api/products?tcg=pokemon&name=umbreon&limit=25`. Two paths that differ only in parameter ORDER
 * are two cache entries — keep the order stable in callers.
 */
export async function apitcgFetch<T = unknown>(path: string, opts: FetchOptions = {}): Promise<T> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, keyFor(path));

  if (!opts.refresh && existsSync(file)) {
    return JSON.parse(readFileSync(file, "utf8")).body as T;
  }
  if (opts.dryRun) throw new Error(`would spend a request on ${path}`);

  spent++;
  const res = await fetch(API_BASE + path, { headers: { "x-api-key": apiKey() } });
  const body = await res.json();
  if (!res.ok) {
    // Cache nothing on failure: a 429 must not become a permanent empty answer.
    throw new Error(`apitcg ${path}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  // fetchedAt is advisory — nothing expires on its own, because expiry means spending quota.
  writeFileSync(file, JSON.stringify({ path, fetchedAt: new Date().toISOString(), body }));
  return body as T;
}

/**
 * Every set for a game, in ONE request.
 *
 * Deliberately not paginated. `/api/{tcg}/sets` ignores `page` and `limit` and returns the complete
 * list, so a pagination loop costs one request per iteration and returns the same rows each time.
 */
export async function listSets<T = unknown>(game: string, opts: FetchOptions = {}): Promise<T[]> {
  const slug = APITCG_SLUG[game] ?? game;
  const body = await apitcgFetch<{ data?: T[] }>(`/api/${slug}/sets`, opts);
  return body.data ?? [];
}

/** What the cache already holds, so a script can report its cost before spending anything. */
export function cachedPaths(): string[] {
  if (!existsSync(CACHE_DIR)) return [];
  return readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CACHE_DIR, f), "utf8")).path as string)
    .sort();
}

/** True when this path can be served without spending a request. */
export const isCached = (path: string): boolean => existsSync(join(CACHE_DIR, keyFor(path)));
