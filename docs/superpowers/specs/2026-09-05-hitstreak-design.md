# Hitstreak — Design Spec

**Date:** 2026-09-05
**Status:** Approved design, pending implementation plan
**Name:** Hitstreak (domains `hitstreak.gg` / `hitstreak.app` verified likely-available on 2026-09-05; registration pending)

## 1. Product summary

A Collectr-style TCG collection and market-value tracker for **Pokémon, One Piece Card Game, and Riftbound**, with a deck-building and meta-deck layer no competitor combines across these three games.

Core loop: add cards you own to portfolios → the app tracks each card's market value daily → see portfolio value, history charts, and gain/loss → browse curated meta decks and see what you're missing and what it costs → build your own legality-validated decks.

**Audience:** single user (Renzo) first, but architected to become a public app — real auth, user-scoped data, and horizontally scalable services from the first migration.

## 2. Scope

### In v1

- Flexible, user-named **portfolios**; a collection item lives in exactly one portfolio
- **Search & add** (type-ahead by name/number/set, pick printing, quantity, condition)
- **Set browsing** — visual card grid per set with owned-overlay (doubles as set-completion tracking)
- **Daily market values** per printing + **value history charts** (portfolio and per-card), backfilled from Feb 2024
- **Gain/loss** vs. recorded acquisition price (per item, per portfolio)
- **Email price alerts** (threshold crossing per printing)
- **Read-only share links** per portfolio (unguessable token, toggleable, no login to view)
- **Purchase date + since-purchase tracking** (cards and sealed) — *added 2026-09-08, Phase 5 (§11 step 13)*
- **Sealed products** tracked and browsable alongside singles — *added 2026-09-08, Phase 5 (§11 step 14)*
- **Meta deck browser** — curated decks per game with tier/archetype, plus **gap analysis**: owned vs. missing cards and market cost to complete
- **Personal deck builder** with per-game **legality validation** (Pokémon, One Piece, Riftbound rulesets)
- **Admin curation screen** for entering meta decks (admin role on owner account)
- Responsive **web app** (usable on phone browsers)

### Deferred (explicitly out of v1)

- Camera card scanning (ML identification)
- CSV import/export
- Graded card (PSA/BGS/CGC) values — requires paid data sources
- Social features (profiles, following, comments), movers/shakers dashboard
- Native mobile app, push notifications
- Automated meta-deck scraping (LimitlessTCG API for Pokémon is the natural first automation)
- Condition-specific pricing (tcgcsv does not expose TCGplayer SKUs)
- Wishlists

## 3. Data sources

**Primary: [tcgcsv.com](https://tcgcsv.com)** — free daily mirror of TCGplayer's catalog + prices.

| Game | TCGplayer category ID |
|---|---|
| Pokémon | 3 |
| One Piece Card Game | 68 |
| Riftbound (LoL TCG) | 89 |

- Hierarchy: category → groups (sets) → products (cards + sealed, with `extendedData`) → prices (market/low/mid/high per printing subtype)
- Updates daily ~20:00 UTC
- **Historical archive** from 2024-02-08: `https://tcgcsv.com/archive/tcgplayer/prices-YYYY-MM-DD.ppmd.7z`
- No SKU (condition-level) pricing; one price per card/printing-subtype
- Etiquette: identifiable User-Agent, ~250ms between requests (site's own guidance)

**Risks & mitigations:** tcgcsv is a single-maintainer hobby mirror in a legal gray zone (TCGplayer's public API is closed). Mitigation: archive every raw daily response to our own R2 bucket before processing, so the DB can always be re-derived and history is never lost. Archive-first: a raw response is archived before its rows are written, and an archive failure aborts the affected unit — the whole game if the groups listing fails to archive, otherwise just that group for the day (other groups continue; the run still exits non-zero). Commercial-scale use would need a licensed source (JustTCG, etc.) — a swap at the ingestion layer only.

**R2 volume note:** raw archives are uncompressed JSON, ~800+ objects/day for Pokémon alone; realistically tens of MB/day across the three games, so the 10 GB free tier lasts months, not years. Overage is ~$0.015/GB-month with free egress — under $1/month even at 50 GB over — so this is a cost footnote, not a design constraint. If it matters later, an R2 lifecycle rule expiring raw archives older than N months (once the backfill is verified) is the lever.

**Meta decks:** manually curated by admin (~monthly, after set releases). No scraping in v1.

## 4. Infrastructure

Pattern proven in license-hub (Vercel + Turso + R2), adapted:

| Concern | Choice | Notes |
|---|---|---|
| App + API | **Next.js (App Router) on Vercel Hobby** | UI and API routes in one deployable |
| Database | **Turso (libSQL)** | Free tier: 5 GB, 10M row-writes/mo (we need ~3.6M worst case, less with write-on-change). Async client, self-initializing schema, no pooling needed |
| Object storage | **Cloudflare R2** | Raw daily ingest archives + cached card images; free egress |
| Ingestion | **GitHub Actions** scheduled workflow | Daily sync is 10–20 min — beyond Vercel function limits, trivial in Actions' 2,000 free min/mo |
| Nightly compute | **GitHub Actions step after the daily ingest** (`ingest/nightly.ts`) — *amended 2026-09-08; was Vercel Cron (daily) → authenticated internal endpoint* | Portfolio materialization + alert evaluation (light work). The Actions job already holds the DB credentials and runs right after the prices land: no shared secret, no function duration cap, and no deployed app is required for history to accumulate |
| Auth | **Better Auth** (libSQL adapter) | Multi-user from day one; admin role flag for curation |
| Email | **Resend** | Free tier 3,000/mo, 100/day |
| Tests | **vitest** against local `file:` libSQL DB | Never `:memory:` (cross-connection schema loss — license-hub lesson) |

Cost: $0/mo. Scale path: Turso Developer $5/mo, Vercel Pro, licensed price API — plan changes, not re-architecture.

License-hub patterns carried forward: async `db()` with cached schema-ensure promise; `execute({sql, args})` call style; **write transactions for any read-then-write** under serverless fan-out; secure cookies in production; Node runtime (not Edge) for routes using crypto.

## 5. Data model

Conventions: integer PKs, ISO-8601 text dates, `user_id` scoping on all user data, TCGplayer IDs preserved as natural keys for idempotent upserts.

Two deliberate decisions (from Task 2's review):
- **Referential integrity is enforced by application code and tests, not the database.** SQLite/libSQL leaves `REFERENCES` unenforced unless `PRAGMA foreign_keys = ON` is issued per connection, and per-connection pragmas are not dependable over Turso's stateless HTTP transport. The `REFERENCES` clauses in the schema are documentation; ingestion code maps TCGplayer IDs to internal IDs explicitly and tests assert no orphans.
- **Money is stored as `REAL` (dollars), rounded at display time — not ledger-grade.** This mirrors tcgcsv's decimal JSON prices exactly. All later money columns (`acquired_price`, `total_value`, alert `threshold`) use the same `REAL` dollars convention so values join and subtract without unit conversion; UI formats with 2 decimals. Never introduce integer cents alongside.

**Catalog** (upserted daily from tcgcsv):
- `games` — id, tcgplayer_category_id, name, slug
- `sets` — id, game_id, tcgplayer_group_id, name, code, release_date
- `cards` — id, set_id, tcgplayer_product_id, name, number, rarity, image_url, `attrs` (JSON: per-game fields parsed from extendedData — HP/types for Pokémon; color/cost/counter for One Piece; Riftbound fields TBD during rules research)
- `printings` — id, card_id, subtype (Normal / Foil / Holofoil / Reverse Holofoil / 1st Edition …). The unit that has a price and that users own.

**Prices:**
- `price_snapshots` — printing_id, date, market, low, mid, high. Append-only; **write-on-change** (insert only when values differ from the printing's last stored row — cuts ~50–70% of rows; readers carry last value forward). Unique `(printing_id, date)`.

**Users & collections:**
- Better Auth tables (`users`, sessions, etc.) + `is_admin` flag
- `portfolios` — id, user_id, name, created_at
- `collection_items` — id, portfolio_id, printing_id, quantity, condition (recorded though not priced in v1), acquired_price, acquired_date
- `portfolio_history` — portfolio_id, date, total_value. Materialized nightly. Unique `(portfolio_id, date)`.
- `share_links` — id, portfolio_id, token (unguessable), enabled, created_at

**Alerts:**
- `price_alerts` — id, user_id, printing_id, direction (above/below), threshold, `armed` (1 = emails on the next crossing; 0 = fired, waiting to re-arm), last_fired_at, last_fired_price, created_at. Re-arms only after price crosses back over the threshold (columns as shipped 2026-09-08).

**Decks:**
- `decks` — id, game_id, owner_user_id (**NULL = curated meta deck**), name, archetype, tier (1–4, meta decks only), format, source_note, `is_draft`, created_at, updated_at. `is_draft` = a personal deck saved with validation errors; a curated deck is never a draft (columns as shipped 2026-09-09).
- `deck_cards` — deck_id, card_id, zone, quantity, **primary key `(deck_id, card_id, zone)`** — the same card may appear in two zones of one deck but never twice in the same zone; quantity carries the copies. Zones as shipped: main / leader / legend / champion / rune / battlefield (`ZONES` in `lib/decks/types.ts` says which of them each game uses). Lines reference `cards`, not `printings`: a deck says *which card*, and ownership is matched by the per-game identity key (§7).
- Gap analysis is computed at read time: `deck_cards` diffed against the user's aggregated collection (across all their portfolios), missing cards priced from latest snapshots. No denormalized tables.

## 6. Ingestion pipeline (GitHub Actions)

**Daily workflow (~21:00 UTC, after tcgcsv's 20:00 refresh):**
1. Per game (isolated try/catch so one game's failure doesn't block others): fetch groups → products → prices
2. Upload raw JSON responses to R2 (`raw/tcgplayer/YYYY-MM-DD/<category>/…`) **before** processing
3. Upsert `sets`/`cards`/`printings` keyed on TCGplayer IDs (new sets appear automatically)
4. Insert `price_snapshots` via write-on-change diff against each printing's last stored price
5. Run `ingest/nightly.ts` as a second step of the same job (it runs even when the ingest step failed part-way — whatever prices landed are worth valuing): materialize `portfolio_history` for the date, evaluate every alert against the current price (`latest_prices` — never the re-run date's snapshot: the alert state machine is not order-aware, so an older price could re-arm a fired alert or fire one on a stale price), send Resend emails. Idempotent — re-running a date overwrites its rows. An email failure, or Resend not being configured, leaves the alert armed so it is retried the next night. *(Amended 2026-09-08 — was "call the app's authenticated `/api/internal/nightly` endpoint (shared-secret header)"; see §4.)*
6. Idempotent per day — safe to re-run; a missed day self-heals (diff is against last-stored, not literally yesterday)

**Failure notification:** GitHub emails on workflow failure (free, built-in).

**One-time backfill job:** manually-triggered workflow that walks the tcgcsv archive from 2024-02-08 forward, replaying each day through the same write-on-change path. Run once after the catalog first syncs.

**Card images:** cached from TCGplayer URLs into R2 lazily on first request; served from R2 thereafter.

## 7. Application surface

Route groups (Next.js App Router):

- **Catalog:** `/search` type-ahead (name/number/set, filter by game); `/sets/[id]` visual grid with owned-count overlay (set completion)
- **Portfolios:** list + CRUD; `/portfolios/[id]` holdings table (qty, condition, cost basis, current value, gain/loss), value history chart, add-item flow (search → pick printing → qty/condition/price paid)
- **Card detail:** `/cards/[id]` printings, price history chart (printing pills on the chart switch the charted printing; `?range=` + `?p=` links, so the chart is server-rendered), which portfolios hold it ("In your binders"), alert shortcut ("Set a price alert" → `/alerts?printing=`) — *detailed 2026-09-08*
- **Sharing:** `/s/[token]` public read-only portfolio view (no auth, no other-user data reachable); market value only — cost basis and gain are excluded from the public view; one token per binder; turning sharing off keeps the token (the URL 404s while off), regenerate replaces it and kills the old URL — *detailed 2026-09-08*
- **Alerts:** create / list (Triggered vs. Watching) / delete; email contains card, threshold, current price, link. v1 has no edit — changing a threshold or direction is delete + recreate (which re-arms and drops `last_fired_at`); an alert whose line is already crossed when it is created emails on the first nightly — *amended 2026-09-08*
- **Decks:** `/decks` is the curated browser (game pills via `?game=`, grouped by tier) — *amended 2026-09-09; the route is `/decks`, not `/decks/meta`, so the nav's existing entry became the real screen*; `/decks/[id]` deck detail with decklist, gap analysis (owned n/total, missing cards priced, cost-to-complete), a rules checklist, and "Copy to my decks"; `/decks/mine` the personal deck list (create, rename, delete, Draft/Legal); `/decks/mine/[id]` the builder — search-add cards into zones, live validation and live gap, save (valid or draft). Gap analysis matches a deck line to what you own by a **per-game identity key** (`lib/decks/identity.ts`): base name for Pokémon and Riftbound (printing suffixes and alt-art parentheticals stripped, so any printing counts), `attrs.Number` for One Piece (alt arts share it). The same key is what the copy limits count.
- **Admin:** `/admin/decks` curation — paste/enter decklist, resolve card names against catalog (exact match → cheapest printing; anything else offers candidates to pick from), set game/archetype/tier/format, edit and delete curated decks. Gated by `isAdminUser`: a signed-in non-admin gets **404, not a redirect** (the route should not announce itself), and every action re-checks admin against the DB rather than trusting the page render — *detailed 2026-09-09*.

## 8. Deck validation

Shared contract, one module per game:

```ts
validateDeck(game: GameRules, deck: DeckInput): { valid: boolean; errors: ValidationError[] }
```

Pure functions over catalog data (card `attrs`), run live in the builder UI and enforced on save (drafts may save invalid, flagged).

- **Pokémon:** exactly 60 cards; at least one Basic Pokémon; max 4 per card *name* (basic energy exempt); max 1 ACE SPEC; max 1 Radiant. ~~Standard format = regulation-mark legality from card attrs~~ — **not validated, resolved 2026-09-09:** tcgcsv's `extendedData` carries no regulation mark (nor a format field), so there is nothing to check against. A deck the validator calls legal may still be Standard-illegal by rotation. Closing this needs a second source (LimitlessTCG or the Pokémon TCG API) mapped onto our cards — Phase 5+ at the earliest.
- **One Piece:** exactly 1 leader + 50 main-deck cards; max 4 per card *number* (alt arts share it); colour matching is **share-at-least-one** — a multi-colour card is legal if any one of its colours is one of the leader's, not all of them (confirmed 2026-09-09). A card with no colour, and a leader with no colour, are never colour-checked. DON!! cards are not deck cards.
- **Riftbound:** ~~**OPEN QUESTION: verify exact deck-construction rules against Riot's official rules document during implementation**~~ — **resolved 2026-09-08** against Riot's Core Rules §103 (constructed), cross-checked with `riftwatcher.com/rules/deck-construction` and the `playriftbound.com` tournament rules:
  - exactly 1 **Champion Legend**;
  - exactly 1 **Chosen Champion** — a Champion Unit sharing the Legend's champion tag — and it is counted **inside** the exactly-40 main deck, not alongside it;
  - max 3 copies per card *name* across main deck + Chosen Champion;
  - max 3 **Signature** cards, every one of them carrying the Legend's champion tag;
  - **domain identity:** every main-deck, champion, rune and battlefield card's domains must be a subset of the Legend's two-domain identity. A domain of "None" or a missing Domain attr is colourless and always legal (103.4.b keeps battlefields "subject to Domain Identity if applicable"; all 71 in today's catalog are colourless, so that check is a no-op for now);
  - exactly 12 **runes**;
  - exactly 3 **Battlefields**, with distinct names;
  - **tokens are never deck cards** in any zone — the catalog types them `"Unit;Token"`, `"Battlefield;Token"`, `"Gear;Battlefield;Token"`, so the base type alone does not qualify a card.

## 9. Error handling

- Ingestion: per-game isolation; raw-first archiving means processing bugs are replayable; workflow failure emails
- Nightly job (Actions step, see §4): idempotent (re-running a date overwrites materialized rows; alerts are re-checked against the `armed` flag and the *current* price, not the date's snapshot, so a re-run — the same date or an older one — sends no duplicate emails)
- Alert email send failure: logged, retried on next nightly run (alert stays armed)
- Share links: token lookup only — no enumeration; disabled links 404
- App: standard Next.js error boundaries; API routes return typed error JSON

## 10. Testing

- **Unit (heaviest):** deck validators per game (happy path + every rule violation); gap-analysis/cost-to-complete math; write-on-change diff logic; alert threshold/re-arm logic
- **Ingestion:** parsers against checked-in fixture files (real tcgcsv samples per game, including extendedData variants)
- **Integration:** data layer + API routes against throwaway `file:` libSQL DBs; auth boundary tests (user A cannot read user B's portfolios; share token exposes exactly one portfolio read-only)
- **CI:** vitest in GitHub Actions on push

## 11. Build order

1. Repo scaffolding: Next.js + TypeScript + Tailwind, Turso client, schema, vitest harness
2. Ingestion workflow + R2 archiving (start accumulating live data immediately)
3. Backfill from tcgcsv archive
4. Auth (Better Auth) + portfolios + collection items CRUD
5. Search & set browsing with owned-overlay
6. Price charts (per-card, per-portfolio) + gain/loss
7. Nightly materialization + share links
8. Email alerts (Resend)
9. Decks: schema + meta browser + gap analysis — **done 2026-09-09 (Phase 4)**
10. Deck builder + per-game validators (Riftbound rules research here) — **done 2026-09-09 (Phase 4)**; the Riftbound research landed as the §8 amendment, and Pokémon Standard-format legality is explicitly out (no regulation marks in the data)
11. Admin curation screen — **done 2026-09-09 (Phase 4)**; `/admin/decks` plus the `scripts/import-deck.mts` CLI
12. Polish pass: responsive layouts, empty states, seed real collection
13. Purchase tracking (raw cards AND sealed): an optional acquired date on add (defaults to today, editable later — the `acquired_date` column and data layer already exist; the add dialog never asks), a "since purchase" change on the holding row and on the card page, and the buy price/date drawn as a marker on the price-history chart — *added 2026-09-08*
14. Sealed products first-class: a "Sealed" section on set pages with tap-to-own (still excluded from completion %), a sealed/singles filter in search, and a "Sealed" badge in place of the empty number/rarity caption. Context: the local catalog has ~5,500 sealed-type products (`cards.number IS NULL`), ~3,800 of them priced; they are already searchable, addable and valued, but invisible on set pages — *added 2026-09-08*

**Phases** (mapped 2026-09-08): Phase 1 = steps 1–3 (done); Phase 2 = steps 4–5 (done); Phase 3 = steps 6–8 plus the sign-up gate from §13 (done on `phase-3/history-share-alerts`); Phase 4 = steps 9–11 (decks); Phase 5 = the step 12 polish pass plus steps 13–14. Phase 5 is explicitly collaborative: Renzo reviews screens (the running app, the `/dev/ui` gallery, screenshots) and reacts; every change lands in tokens (`app/globals.css`) or primitives (`components/ui/`) so it applies app-wide; page-level issues become new primitives (the `BackLink` / `DetailLayout` / `CardImage` candidates in §13) or documented one-offs.

## 12. Visual design

Approved 2026-09-05: the **"Binder"** direction — warm paper ground, card art as the hero, DM Serif Display for values and headings, DM Sans body, terracotta accent; light is the default theme with a dark (warm charcoal) toggle. Tokens, conventions (owned vs missing, selected state, nav, icons) and the per-screen mockups live in `docs/design/README.md` and the `docs/design/*.dc.html` artboards; the live canvas is linked from that README. Screens covered: portfolio home, set browser, card detail, meta decks + gap analysis, deck builder + validation, alerts, phone layout, dark-mode reference.

**Implementation approach (binding for Phase 2+):** the mockups are the reference, not the code. The app is built from a small reusable component library so any visual change is made once and lands on every screen:
- **Tokens** live in one place — `app/globals.css` via Tailwind v4 `@theme` (the scaffold already ships Tailwind 4). Every Binder color/font/radius is a CSS variable exposed as a Tailwind utility (`bg-ground`, `bg-surface`, `text-ink`, `text-muted`, `text-dim`, `text-accent`, `text-gain`, `border-hairline`, `font-display`, `font-body`). Dark mode is a `[data-theme="dark"]` block reassigning the same variables; light is default.
- **Primitives** in `components/ui/`, one component per file, small typed props: `TopNav`, `Pill` (tab/filter chip; selected = inverted ink), `Panel`, `StatTile`, `PriceDelta`, `ProgressBar`, `CardTile` (owned/missing states + `×N` chip), `CardRow`, `SectionHeading`, `SearchField`, `Input` (text field, optional label), `Button` (primary/secondary; `href` renders a link in the same skin), `TierBadge`, `ValidationList`, `BottomTabBar` (phone), `EmptyState` (nothing-here panels), `MoneyDisplay` (serif whole dollars, dim cents).
- **Screens compose primitives only** — no ad-hoc styling in route files. Each primitive gets a Storybook-free "gallery" route (`/dev/ui`, dev-only) so all variants can be reviewed on one page.

## 13. Open questions / follow-ups

- ~~**Gate sign-up before public launch.** Phase 2a ships open email+password registration with no email verification (fine single-user-first). Before the app is reachable at a public domain, add one of: invite codes, an allowlist, or email verification (`emailAndPassword.requireEmailVerification` + a Resend sender). Track as a Phase 3 task alongside Resend setup.~~ — **done 2026-09-08 (Phase 3):** `SIGNUP_ALLOWLIST` allowlist, enforced by a Better Auth `hooks.before` on `/sign-up/email` (`lib/signup-gate.ts`, `lib/auth.ts`); blank = open sign-up, set = only those addresses. Email verification is still open (next bullet).
- **Email verification before public launch** *(added 2026-09-08)*. Alerts email whatever address was registered; with `SIGNUP_ALLOWLIST` unset, anyone could register a third party's address and point alerts at that inbox. `emailAndPassword.requireEmailVerification` + a Resend sender closes it.
- ~~`lib/history.ts` is imported by client components (`RangePills`, via the `"use client"` `/dev/ui` gallery and any client page that imports from `components/ui`) and statically imports `lib/db` → `@libsql/client`. It builds today via the package's browser export condition; move the db-free exports (`RANGES`, `RANGE_LABEL`, `RANGE_CAPTION`, `parseRange`, `rangeStart`, `chartFrom`, `withLivePoint`, `seriesStats`, `Point`, `Range`) into a db-free module (e.g. `lib/ranges.ts`, re-exported by `lib/history.ts`) before adding `"server-only"` to `lib/db.ts` *(2026-09-08)*~~ — **done 2026-09-08 (pre-merge review):** the db-free exports live in `lib/ranges.ts` (re-exported by `lib/history.ts`); `RangePills` and `LineChart` import from `lib/ranges`, and `tests/ranges.test.ts` fails if anything under `components/ui` imports `lib/db` or `lib/history`. Adding `"server-only"` to `lib/db.ts` is still open.
- `listAlerts` issues two queries per alert for the 30-day change (~200 at the 100-alert cap) *(2026-09-08)*
- `createAlert`'s per-user cap is COUNT-then-INSERT, not atomic *(2026-09-08)*
- `materializePortfolioHistory` is one `INSERT … SELECT` over all binders — fine for hundreds of users, revisit at thousands *(2026-09-08)*
- Alert send + disarm are two non-transactional writes: a DB failure right after a successful send re-emails the next night (at-least-once by design) *(2026-09-08)*
- No per-user daily email cap beyond `MAX_ALERTS_PER_USER` (100) *(2026-09-08)*
- The share page has no rate limit — 128-bit tokens make enumeration infeasible, but add one before public *(2026-09-08)*
- `RangePills` keeps the scroll position only through `Pill scroll={false}` (Next `Link`) *(2026-09-08)*
- The alerts form's threshold hint rounds to a whole percent *(2026-09-08)*
- `Button size="sm"` replaced the ad-hoc `min-h-8` overrides — grep for new ones in review *(2026-09-08)*
- The vitest auth tests carry explicit 20s timeouts because scrypt competes with per-file worker startup; if it flakes again the levers are a `maxWorkers` cap or `isolate: false` *(2026-09-08)*
- On the binder page the range `PriceDelta` sits directly under the "vs. paid" one with no spacing element (cosmetic) *(2026-09-08)*
- **Future `/api/*` routes must call `getSession()` themselves** — `proxy.ts` excludes `/api` from the optimistic redirect so Better Auth's handler stays reachable.
- ~~Riftbound deck-construction rules — verify against official Riot rules (step 10)~~ — **resolved 2026-09-08 (Phase 4);** the verified rules are written out in §8.
- ~~Exact per-game `extendedData` field shapes~~ — **resolved 2026-09-05 against real data:** all three games expose `Number` and `Rarity` (Pokémon also HP/Stage/Attacks; One Piece: Color/CardType/Life/Power/Attribute; Riftbound: Energy Cost/Power Cost/Might/Card Type/Tag/Domain). Sealed products (~10% of rows) have neither, and correctly land with null number/rarity.
- Domain registration (`hitstreak.gg` / `hitstreak.app`) — user purchase, not build-blocking
- Whether Pokémon catalog volume (largest of the three) needs ingestion batching/chunked upserts — measure in step 2
- Release-date normalization at ingest — tcgcsv's `publishedOn` is a full timestamp, not a date; the UI currently slices to the date at render time instead of normalizing on write
- `cards.number` `ORDER BY` is a plain text sort — fine for zero-padded numbers, wrong for unpadded ones (`9` sorts after `10`)
- `listSetsWithCompletion` is unbenchmarked at scale — correlated subqueries per set/user, untested against a large catalog
- Primitive candidates surfaced by repeated page patterns: `BackLink` (the recurring `← X` link), `DetailLayout` (the shared detail-page shell), `CardImage` (wraps the `url(...)`-quoted background-image treatment), and a `--text-caption` token to replace the ~25 ad-hoc `text-[13px]` uses. Added by the Phase 3 pre-merge review *(2026-09-08)*: a `GroupLabel` for the uppercase tracked group label (`text-xs font-semibold uppercase tracking-[0.06em] text-muted`, from `Alerts.dc.html`; today inline in `AlertList`'s Triggered / Watching headers — `tracking-[0.06em]` has no primitive and no row in the design README), and a 22px panel-heading size for `SectionHeading` (the `font-display text-[22px] leading-none` `<h2>` duplicated in `NewAlertForm` and `AddItemDialog`; `SectionHeading` only has the 26px size). **Phase 4 raised `GroupLabel` to four sites** *(2026-09-09)* — `AlertList`, the `/decks` tier headings, the builder's zone headings and the `/admin/decks` per-game headings all repeat the same inline span; promote it in Phase 5.
- `ConfirmDialog` primitive to replace the raw `window.confirm` currently used for destructive actions (e.g. removing a holding)
- `getPortfolioSummary` re-reads holdings independently rather than sharing a query with `getPortfolioHoldings` — fine for now, worth collapsing if it becomes a hot path. `getSharedPortfolio` (Phase 3) inherits this and runs the holdings query twice per share-page view *(2026-09-08)*
- No automated check that every `/api/*` route actually calls `getSession()` — today it's a convention documented above, not enforced by a test or lint rule

Phase 4 (decks) follow-ups, all *2026-09-09*:

- ~~**`scripts/import-deck.mts` does not run.** Task 8 moved `parseDecklist` / `formatDecklist` / `mergeResolved` into `lib/decks/decklist.ts`, re-exported by `lib/decks/resolve.ts`; tsx's strict-ESM path for a `.mts` entry point does not see `export *` re-exports, so the CLI throws "does not provide an export named 'mergeResolved'" at import.~~ — **fixed 2026-09-09 (`92095b0`):** the CLI imports those names from `@/lib/decks/decklist`. The durable rule stands — the same re-export shape exists at `lib/decks/gap.ts` → `gap-math.ts` and `lib/history.ts` → `lib/ranges.ts`, so **`scripts/*.mts` must import from the leaf module.** Product code, the bundler and `npx tsx -e` all resolve the re-exports fine, which is why nothing caught it; the "scripts/*.mts import the pure decklist helpers from the leaf module" case in `tests/ranges.test.ts` now does.
- The resolver picks the **cheapest printing**, so World Championship replica sets surface in curated decks ("Rare Candy" resolves to `Rare Candy - 2025 (Riley McKay)` at $0.11). Consider excluding replica sets both from the cheapest-printing pick and from the `MIN(market)` that prices cost-to-complete.
- Some alt-art printings carry no `Card Type` / `Domain` / `Tag` attrs (8 Riftbound cards today), so a deck line pointing at one validates as "unknown type". The resolver should prefer an attr-bearing printing of the same card.
- Decklist shapes the parser does not handle: PTCGL energy shorthand (`4 Basic {F} Energy SVE 2`), bare-number tails (`3 Fire Energy 12`), OPTCGSim's `4xOP01-016` (no space after the `x`).
- `formatDecklist` emits names only, so editing a One Piece deck re-ambiguates every card whose name spans several card numbers; emitting `attrs.Number` for One Piece would fix it.
- N+1 reads: `/decks` runs `getDeck` per curated deck; `/admin/decks` does the same **and** ships every deck's formatted decklist to the browser; `resolveDecklist` runs up to two queries per line (bounded by `MAX_LINES`).
- `/decks` costs one extra `isAdminUser` query per page load, for every user, purely to decide whether to show the "Curate" link.
- The curation screen has no legality preview and `upsertMetaDeck` does not validate — a curated deck can be illegal by design (a partial list, a rotated format); `/decks/[id]` is where that shows.
- `withUser` returns `e.message` verbatim, so a malformed direct action call can echo a raw `TypeError` to the caller — and since Task 7 that includes non-admin surfaces (`saveDeckAction` / `copyDeckAction` / `renameDeckAction` / `deleteDeckAction` are reachable by any signed-in user). The action layer's own `assert*` helpers return sentences, so this only bites a call that bypasses the UI; a message allowlist in `withUser` would close it.
- Riftbound: 45 champions (78 Champion Unit printings — Gangplank, Illaoi, Riven, Sona, Kayle, Morgana and more) have no matching Legend in the catalog yet, so those champions cannot currently form a legal deck.
- Pokémon Standard-format legality is unvalidated (see §8) — it needs a regulation-mark source outside tcgcsv.
