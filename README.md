# Hitstreak

TCG collection, market-value, and deck tracker for Pokémon, One Piece, and Riftbound.

## Status

Phase 1 complete: data pipeline — catalog + daily write-on-change price ingestion from tcgcsv,
raw archives to R2, historical backfill from 2024-02-08.

Phase 2a complete: design tokens + `components/ui/` primitives (`BottomTabBar`, `Button`, `CardRow`,
`CardTile`, `Panel`, `Pill`, `PriceDelta`, `ProgressBar`, `SearchField`, `SectionHeading`, `StatTile`,
`TierBadge`, `TopNav`, `UserMenu`, `ValidationList`); a `/dev/ui` primitives gallery (dev only); Better
Auth (email + password) with sign-in/sign-up and a protected app shell.

Phase 2b next: portfolios, search, sets, card detail (see `docs/superpowers/plans/`).

## Stack

Next.js (App Router) on Vercel · Turso (libSQL) · Cloudflare R2 · GitHub Actions ingestion · vitest

## Development

```bash
npm install
npm test            # vitest against throwaway file: DBs
npm run typecheck   # tsc --noEmit (vitest does not type-check)
npm run lint
npm run dev         # Next.js dev server
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
- Raw tcgcsv responses are archived to R2 under `raw/tcgplayer/<date>/<category>/` BEFORE processing; an archive failure aborts the affected group for the day (or the whole game if the groups listing itself fails to archive); the run exits non-zero either way.

Env vars: see `.env.example`. CI secrets: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## UI development

Design tokens live in `app/globals.css` (`@theme inline`; light values on `:root`, dark overrides on
`[data-theme="dark"]`). Primitives live in `components/ui/` — when a screen needs a visual tweak, change
a primitive or a token, not the page. The gallery at `/dev/ui` shows every primitive and its variants
(requires sign-in in dev, like the rest of the app shell). Component tests are `tests/ui/*.test.tsx`,
each starting with `// @vitest-environment jsdom`.

## Auth

Better Auth (email + password) runs on the same Turso DB as the rest of the app. Its tables are defined
in `lib/schema.ts` (`AUTH_SCHEMA_SQL`); if `lib/auth.ts` changes in a way that affects the schema,
regenerate with `npx auth@<version> generate` (matching the Better Auth version in `package.json`) and
re-apply any hand edits noted in `lib/schema.ts`.

Required env vars: `BETTER_AUTH_SECRET` (generate with `openssl rand -base64 32`) and `BETTER_AUTH_URL`.
For local dev, `.env.local` needs `TURSO_DATABASE_URL=file:hitstreak.local.db` plus those two — see
`.env.example`. `.env.local` and `hitstreak.local.db*` are gitignored; never commit them.

On Vercel, set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` for
BOTH the Build step and Runtime, on BOTH the Production and Preview environments. `lib/auth.ts` throws at
import time if `TURSO_DATABASE_URL` is unset (the auth route is imported during Next's page-data
collection at build time, not just at runtime), and Better Auth itself throws in production if
`BETTER_AUTH_SECRET` isn't a real secret — preview deployments run with `NODE_ENV=production`, so this
applies to previews too, not just the production environment.

### Dependency overrides

`package.json` pins two transitive versions via `overrides`:

- `better-auth`'s `vitest` peer dependency accepts an optional range that predates vitest 5; the override
  points it at our root `vitest` (`^5.0.0`) so npm doesn't try to install a second, older vitest.
- `@libsql/kysely-libsql` normally pulls its own `@libsql/client@^0.8`; the override dedupes that to the
  root `@libsql/client@^0.18.0` since we construct and pass in our own client (see `lib/auth.ts`) rather
  than letting the dialect create one.

## Design docs

- Spec: `docs/superpowers/specs/2026-09-05-hitstreak-design.md`
- Plans: `docs/superpowers/plans/`
- Design system (Binder): `docs/design/README.md`
