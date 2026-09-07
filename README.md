# Hitstreak

TCG collection, market-value, and deck tracker for Pokémon, One Piece, and Riftbound.

## Status

Phase 1 complete: data pipeline — catalog + daily write-on-change price ingestion from tcgcsv,
raw archives to R2, historical backfill from 2024-02-08. App UI lands in Phase 2 (see `docs/superpowers/plans/`).

## Stack

Next.js (App Router) on Vercel · Turso (libSQL) · Cloudflare R2 · GitHub Actions ingestion · vitest

## Development

```bash
npm install
npm test            # vitest against throwaway file: DBs
npm run typecheck   # tsc --noEmit (vitest does not type-check)
npm run lint
npm run dev         # Next.js dev server (UI arrives in Phase 2)
```

Local ingestion run against a file database (bash):

```bash
TURSO_DATABASE_URL=file:hitstreak.local.db npx tsx ingest/daily.ts
TURSO_DATABASE_URL=file:hitstreak.local.db npx tsx scripts/db-counts.mts
```

PowerShell: `$env:TURSO_DATABASE_URL = 'file:hitstreak.local.db'; npx tsx ingest/daily.ts`

## Ingestion

- `ingest/daily.ts [YYYY-MM-DD]` — daily sync (GitHub Actions "Daily price ingest", 21:00 UTC): catalog upsert + write-on-change prices. Pass a date to re-run a failed night under its own date. Exits 1 if any game or group failed; prints a final `DAILY_SUMMARY {json}` line.
- `ingest/backfill.ts <from> <to>` — one-time archive replay from 2024-02-08 (GitHub Actions "Historical price backfill", manual). Run oldest-first in chunks; see the Turso write-budget note in the Phase 1 plan before dispatching.
- Raw tcgcsv responses are archived to R2 under `raw/tcgplayer/<date>/<category>/` BEFORE processing; an archive failure aborts that game for the day.

Env vars: see `.env.example`. CI secrets: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## Design docs

- Spec: `docs/superpowers/specs/2026-09-05-hitstreak-design.md`
- Plans: `docs/superpowers/plans/`
- Design system (Binder): `docs/design/README.md`
