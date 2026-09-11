// scripts/backfill-set-meta.mts — fills sets.series, sets.logo_url and sets.symbol_url.
//
// Usage (bash; PowerShell: set $env:TURSO_DATABASE_URL first):
//   TURSO_DATABASE_URL=file:hitstreak.local.db npx tsx scripts/backfill-set-meta.mts [--game pokemon] [--dry]
//
// Separate from the price ingest on purpose. TCGCSV, which the ingest reads, carries neither an era
// nor set art, and this data changes about as often as a new set ships — running it nightly would be
// noise. It is idempotent: re-running only overwrites with what the source currently says.
//
// SOURCE. pokemontcg.io publishes a `series` per set — the era, in the game's own vocabulary
// ("Scarlet & Violet", "Mega Evolution") — alongside symbol and logo PNGs. Our sets come from
// TCGplayer, so the two have to be joined by name and then by ptcgoCode; roughly a third do not
// match, and they are the TCGplayer PRODUCT groups (Battle Academy, Blister Exclusives, Kids WB
// Promos) rather than sets in the game's sense. Those keep series NULL, which /sets renders as
// "Promos & products" — the right home for them anyway.
//
// IMAGES. Mirrored into R2 when a bucket AND R2_PUBLIC_BASE_URL are configured; otherwise the
// upstream URL is stored, which is how card art already works. The column means the same either
// way — where to render this set's art from — so configuring R2 later is a re-run, not a rewrite.
import { db, closeDb } from "@/lib/db";
import { rawArchiverFromEnv } from "@/ingest/r2";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? undefined : process.argv[i + 1]; };
const has = (k: string) => process.argv.includes(`--${k}`);

interface ApiSet {
  id: string;
  name: string;
  series: string;
  releaseDate: string;   // the SOURCE's date — reliable where ours is not
  ptcgoCode?: string;
  images?: { symbol?: string; logo?: string };
}

/**
 * Orders eras oldest to newest by when each one STARTED, using the source's dates.
 *
 * Ours cannot do this job: 19 Pokemon sets carry the ingest date rather than a real release, and
 * every POP Series is among them — so ranking by our own MIN or MAX puts Base Set and XY above
 * Mega Evolution. Returns a map of series name to rank, higher being newer.
 */
function rankSeries(api: ApiSet[]): Map<string, number> {
  const earliest = new Map<string, string>();
  for (const s of api) {
    const seen = earliest.get(s.series);
    if (!seen || s.releaseDate < seen) earliest.set(s.series, s.releaseDate);
  }
  const ordered = [...earliest.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return new Map(ordered.map(([series], i) => [series, i]));
}

/** Names differ in punctuation and casing between the two sources far more than in substance. */
const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** pokemontcg.io 500s intermittently, so a single attempt fails a run that is otherwise fine. */
async function fetchPokemonSets(attempts = 4): Promise<ApiSet[]> {
  let last = "";
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1500 * i));
    try {
      const res = await fetch("https://api.pokemontcg.io/v2/sets?pageSize=250");
      if (res.ok) return ((await res.json()) as { data: ApiSet[] }).data;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    console.error(`  pokemontcg.io attempt ${i + 1}/${attempts} failed (${last})`);
  }
  throw new Error(`pokemontcg.io unreachable after ${attempts} attempts: ${last}`);
}

async function mirror(
  r2: ReturnType<typeof rawArchiverFromEnv>, url: string | undefined, key: string
): Promise<string | null> {
  if (!url) return null;
  const mirrored = await (async () => {
    if (!r2.enabled || !process.env.R2_PUBLIC_BASE_URL) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const body = new Uint8Array(await res.arrayBuffer());
      return await r2.putImage(key, body, res.headers.get("content-type") ?? "image/png");
    } catch {
      return null; // art is decoration; never fail the run that also carries the era
    }
  })();
  return mirrored ?? url; // fall back to the upstream URL, exactly as card art does
}

async function main(): Promise<number> {
  const game = arg("game") ?? "pokemon";
  const dry = has("dry");
  if (game !== "pokemon") {
    console.error(`only pokemon has a source wired up yet (one-piece and riftbound need an API TCG key)`);
    return 2;
  }
  const c = await db();
  const r2 = rawArchiverFromEnv();
  const mirroring = r2.enabled && Boolean(process.env.R2_PUBLIC_BASE_URL);
  console.log(mirroring ? "R2 configured — art will be mirrored" : "no R2 public bucket — art will be hot-linked upstream");

  const api = await fetchPokemonSets();
  const rank = rankSeries(api);
  const byName = new Map(api.map((s) => [norm(s.name), s]));
  const byCode = new Map(api.filter((s) => s.ptcgoCode).map((s) => [s.ptcgoCode!.toUpperCase(), s]));

  const mine = (await c.execute({
    sql: `SELECT se.id, se.name, se.code FROM sets se JOIN games g ON g.id = se.game_id WHERE g.slug = ? ORDER BY se.name`,
    args: [game],
  })).rows;

  let matched = 0, mirroredCount = 0;
  const unmatched: string[] = [];
  for (const row of mine) {
    const name = String(row.name);
    const code = row.code == null ? null : String(row.code).toUpperCase();
    const hit = byName.get(norm(name)) ?? (code ? byCode.get(code) : undefined);
    if (!hit) { unmatched.push(name); continue; }
    matched++;
    const setId = Number(row.id);
    const logo = dry ? hit.images?.logo ?? null : await mirror(r2, hit.images?.logo, `sets/${game}/${hit.id}/logo.png`);
    const symbol = dry ? hit.images?.symbol ?? null : await mirror(r2, hit.images?.symbol, `sets/${game}/${hit.id}/symbol.png`);
    if (mirroring && logo?.startsWith(process.env.R2_PUBLIC_BASE_URL!)) mirroredCount++;
    if (dry) continue;
    await c.execute({
      sql: `UPDATE sets SET series = ?, series_rank = ?, logo_url = ?, symbol_url = ? WHERE id = ?`,
      args: [hit.series, rank.get(hit.series) ?? null, logo, symbol, setId],
    });
  }

  console.log(`${game}: ${mine.length} sets · matched ${matched} · unmatched ${unmatched.length} (they become "Promos & products")`);
  if (mirroring) console.log(`mirrored ${mirroredCount} logos into R2`);
  if (unmatched.length) console.log(`  unmatched sample: ${unmatched.slice(0, 6).join(", ")}${unmatched.length > 6 ? " …" : ""}`);
  if (dry) console.log("--dry: nothing was written");
  return 0;
}

main()
  .then((code) => { closeDb(); process.exit(code); })
  .catch((e) => { console.error(e); closeDb(); process.exit(1); });
