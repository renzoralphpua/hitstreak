# Hitstreak

TCG collection, market-value, and deck tracker for Pokémon, One Piece, and Riftbound.

## Status

Phase 1 complete: data pipeline — catalog + daily write-on-change price ingestion from tcgcsv,
raw archives to R2, historical backfill from 2024-02-08.

Phase 2a complete: design tokens + `components/ui/` primitives (`BottomTabBar`, `Button`, `CardRow`,
`CardTile`, `EmptyState`, `Input`, `MoneyDisplay`, `Panel`, `Pill`, `PriceDelta`, `ProgressBar`,
`SearchField`, `SectionHeading`, `StatTile`, `TierBadge`, `TopNav`, `UserMenu`, `ValidationList`); a
`/dev/ui` primitives gallery (dev only); Better Auth (email + password) with sign-in/sign-up and a
protected app shell.

Phase 2b complete: binders with live valuation from `latest_prices`; the add-card flow with type-ahead
search; the set browser with completion tracking and tap-to-own; card detail with printings and 30-day
change; `/decks` and `/alerts` placeholders so the nav does not 404.

Phase 3 complete: price-history charts on the card page (range + printing pills) and the binder page
(value chart with a 7D · 30D · 90D · 1Y · All row); `ingest/nightly.ts` as a second step of the daily
ingest job (materializes `portfolio_history`, evaluates price alerts, emails crossings via Resend);
read-only binder share links (`/s/[token]`, on/off/regenerate); the alerts page (Triggered / Watching,
create, delete); and a sign-up gate (`SIGNUP_ALLOWLIST`). `npm test`: 287 tests in 46 files.

Phase 4 next: decks — meta browser, gap analysis, builder, per-game validators, admin curation (the
spec's §11 maps steps to phases; plans live in `docs/superpowers/plans/`).

### Screens

- `/` — landing (anonymous); signed-in visitors are redirected to `/portfolios`
- `/sign-in`, `/sign-up` — email + password
- `/portfolios` — binder list with value, gain, and create/rename/delete
- `/portfolios/[id]` — holdings valued from latest prices, value-history chart (`?range=`), add-card dialog, quantity edits, share-link panel
- `/sets` — game pills and each set's completion bar
- `/sets/[id]` — the set's cards as owned/missing tiles; tap a tile to add one copy
- `/cards/[id]` — art, market price, 30-day change, price-history chart (`?range=` + `?p=` printing pills), printings table, "in your binders", add to a binder, set-alert shortcut
- `/alerts` — Triggered / Watching lists, new-alert form (search → printing → direction → price; `?printing=` preselects one), delete
- `/s/[token]` — public read-only binder view (no sign-in, market value only, `noindex`); unknown or disabled tokens 404
- `/decks` — Phase 4 placeholder
- `/dev/ui` — primitives gallery (dev only)
- `/api/auth/[...all]` — Better Auth route handler (sign-in, sign-up, sign-out, session)
- `GET /api/search?q=&game=` — type-ahead card search for the add-card dialog (session-checked)

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
TURSO_DATABASE_URL=file:hitstreak.local.db APP_URL=http://localhost:3000 npx tsx ingest/nightly.ts
TURSO_DATABASE_URL=file:hitstreak.local.db npx tsx scripts/db-counts.mts
```

PowerShell: `$env:TURSO_DATABASE_URL = 'file:hitstreak.local.db'; npx tsx ingest/daily.ts`

### Curating meta decks locally

The same flow is available in the app at `/admin/decks` for a user with `"user".isAdmin = 1` — paste a
list, resolve it, pick a card for anything ambiguous, fill in the metadata, save — and that screen can
also edit and delete curated decks. Every action there re-checks admin-ness, and a non-admin gets a 404
rather than a redirect. The CLI below remains the scriptable path.

Curated (meta) decks can also be loaded from a plain decklist text file with
`scripts/import-deck.mts`: it parses the common shapes (`4 Charmander MEW 4`, `4x Charizard ex`,
`Rare Candy x4`, One Piece `1 OP01-003 Monkey.D.Luffy`, section headers such as `Trainer:` / `Leader` /
`Runes:` that set the zone — One Piece `Character` / `Event` / `Stage` sections are all the main deck),
resolves each line against the catalog (exact name → the cheapest priced printing; One Piece by card number,
and a bare One Piece name only when it maps to a single card number), merges duplicate printings of one card
into a single line (`3 Charmander MEW 4` + `1 Charmander PAF 7` → 4 Charmander), and writes the deck through
`upsertMetaDeck`. Unresolved lines are printed with candidates and nothing is written. The `--as` account must be an admin — flip your local
user once with `UPDATE "user" SET "isAdmin" = 1 WHERE email = 'dev@example.com'` — and `--id N`
replaces an existing meta deck instead of creating one:

```bash
TURSO_DATABASE_URL=file:hitstreak.local.db npx tsx scripts/import-deck.mts \
  --game pokemon --name "Charizard ex / Pidgeot" --tier 1 --format standard \
  --source "Regional top cuts, Aug 30" --as dev@example.com --file decks/zard.txt
```

## Ingestion

- `ingest/daily.ts [YYYY-MM-DD]` — daily sync (GitHub Actions "Daily price ingest", 21:00 UTC): catalog upsert + write-on-change prices. Pass a date to re-run a failed night under its own date. Exits 1 if any game or group failed; prints a final `DAILY_SUMMARY {json}` line.
- `ingest/nightly.ts [YYYY-MM-DD]` — second step of the same "Daily price ingest" job, right after `ingest/daily.ts` (and even when that step failed part-way — whatever prices landed are worth valuing). Materializes `portfolio_history` for the date (one row per binder: Σ quantity × the market price in force on that date) and evaluates every price alert against the current price (`latest_prices`, not the date's snapshot — so re-running an older night cannot re-arm a fired alert or fire one on a stale price), emailing crossings via Resend. Idempotent per date. Prints a final `NIGHTLY_SUMMARY {json}` line. Exits 2 when Resend is configured but `APP_URL` (or `BETTER_AUTH_URL`) is not — the emails need an origin for their links; without Resend the URL is unused and history still materializes. Exits 1 if an email failed, or, in CI, if a crossing is pending while Resend is unconfigured, so the gap is noticed rather than only logged.
- `ingest/backfill.ts <from> <to>` — one-time archive replay from 2024-02-08 (GitHub Actions "Historical price backfill", manual). Run oldest-first in chunks; see the Turso write-budget note in the Phase 1 plan before dispatching.
- Raw tcgcsv responses are archived to R2 under `raw/tcgplayer/<date>/<category>/` BEFORE processing; an archive failure aborts the affected group for the day (or the whole game if the groups listing itself fails to archive); the run exits non-zero either way.

Env vars: see `.env.example`. CI secrets: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `RESEND_API_KEY`,
`ALERT_FROM_EMAIL`, `APP_URL`.

`RESEND_API_KEY` / `ALERT_FROM_EMAIL` can come later — until both are set, alerts are logged instead of
emailed (a pending crossing still makes the CI job red so it does not go unnoticed) and `portfolio_history`
accumulates regardless. Set `APP_URL` together with the Resend secrets: once Resend is configured the
nightly step exits 2 without it, because the emails need an origin for their links.

## UI development

Design tokens live in `app/globals.css` (`@theme inline`; light values on `:root`, dark overrides on
`[data-theme="dark"]`). Primitives live in `components/ui/` — when a screen needs a visual tweak, change
a primitive or a token, not the page. The gallery at `/dev/ui` shows every primitive and its variants
(requires sign-in in dev, like the rest of the app shell). Component tests are `tests/ui/*.test.tsx`,
each starting with `// @vitest-environment jsdom`. `components/ui/cn.ts` resolves conflicting
Tailwind classes with `tailwind-merge` (last one wins) rather than just concatenating strings, so a
primitive's own classes and a caller's overrides can safely target the same utility group.

## Auth

Better Auth (email + password) runs on the same Turso DB as the rest of the app. Its tables are defined
in `lib/schema.ts` (`AUTH_SCHEMA_SQL`); if `lib/auth.ts` changes in a way that affects the schema,
regenerate with `npx auth@<version> generate` (matching the Better Auth version in `package.json`) and
re-apply any hand edits noted in `lib/schema.ts`.

Required env vars: `BETTER_AUTH_SECRET` (generate with `openssl rand -base64 32`) and `BETTER_AUTH_URL`.
For local dev, `.env.local` needs `TURSO_DATABASE_URL=file:hitstreak.local.db` plus those two — see
`.env.example`. `.env.local` and `hitstreak.local.db*` are gitignored; never commit them.

`SIGNUP_ALLOWLIST` gates registration. Blank or unset = anyone can sign up (local dev, the very first
deploy). Set to a comma-separated list of emails = only those addresses may register; everyone else gets
a 403 "Sign-ups are invite-only right now." from the Better Auth `hooks.before` on `/sign-up/email`
(`lib/signup-gate.ts`, `lib/auth.ts`), and the sign-up page shows an invite-only note. Matching is
trimmed and case-insensitive. The list is read once at server start, so changing it on Vercel needs a
redeploy, not just a new value.

Local test user: sign yourself up once (the convention is `dev@example.com`) and use that account for
manual checks. It lives only in your own `hitstreak.local.db` — there are no seeded accounts in the
repo, and nothing in CI or on Vercel knows about it.

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

## Before going public

- Set `SIGNUP_ALLOWLIST` on Vercel (Build + Runtime) so registration is closed before the domain is reachable.
- Verify a sending domain in Resend and set `RESEND_API_KEY` + `ALERT_FROM_EMAIL` as GitHub Actions secrets so alerts email instead of logging.
- Set `APP_URL` as a GitHub Actions secret alongside the Resend secrets — the nightly step refuses to send emails without an origin for their links (see Ingestion).
- Consider email verification (`requireEmailVerification` + the Resend sender) and a rate limit on `/s/[token]` — both are open follow-ups in spec §13.

## Design docs

- Spec: `docs/superpowers/specs/2026-09-05-hitstreak-design.md`
- Plans: `docs/superpowers/plans/`
- Design system (Binder): `docs/design/README.md`
