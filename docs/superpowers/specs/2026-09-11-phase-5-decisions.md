# Phase 5 — UX decisions

A running record of the collaborative UI/UX pass. Each entry is a decision that is **settled**, with
the reasoning that settled it, so a later plan can be written from this file rather than from chat
scrollback. Artboards live in `docs/design/`; the canvas is linked from `docs/design/README.md`.

---

## 1. Home and Collection are two screens

**Settled 2026-09-10.** Artboard: `docs/design/Dashboard.dc.html`.

The approved `Main.dc.html` drew a single screen that merged a collection's value, chart and a collection
switcher with that collection's cards. We shipped it as two (`/collections`, `/collections/[id]`). Rather
than collapse them back, Home becomes a genuine collection-level screen — the one that answers "what
is my whole collection worth", which nothing answered before.

- **Home is what you read.** Total across collections, its chart, winners and losers, deck progress,
  alerts that fired. Nothing on it edits anything.
- **Collection is what you change.** Add and remove cards, purchase price, rename, delete.
- **Collection switching** moves into a dropdown in the Collection header. `/collections` keeps its role as
  the management surface (create, rename, delete) and does not auto-jump to the last collection used.
- The by-collection rows on Home are therefore a *breakdown*, not a switcher, and are drawn as plain
  rows — never the selected dark chip, which means "selected" everywhere else in the system.

**Home has no nav item.** The wordmark links to it, on desktop and in the phone header alike. The
primary nav stays at four (Collection · Sets · Decks · Alerts), so no existing artboard's top bar
changes, and on Home no tab is lit.

### 1a. One measure, app-wide: vs paid

**Settled 2026-09-10 for Home; promoted app-wide 2026-09-11.**

**The rule: wherever a figure describes something you own, it reads against what you paid.** Never
"change over the last N days". That covers the Home headline, the per-collection rows, the winners and
losers, the collection rail, the collection grid tiles and `HoldingsTable`'s per-row deltas.

The range pills stay, but they only pick the chart's **window**. The chart plots market value
against the cost-basis step line, so the gap between the two lines is the gain at any window. The
headline gain is a *level*, not a window figure, so it does not move when the range changes.

Anything that cannot be expressed against cost basis stays off Home: the tier-1 deck rows show a
build cost with no trend, and alert thresholds (absolute prices by definition) stay in the Alerts
panel.

**Two exceptions, both principled rather than convenient.**

*Catalog figures have no cost basis.* A card's market price and its history on `/cards/[id]`, a
set's completion, a meta deck's build cost — these describe things you may not own, so there is
nothing to compare against and a period change is the correct measure. On the card page only the
"Your copies" block reads vs paid.

*The public share view must never show cost.* `/s/[token]` shows market value and a period change
and no cost basis at all — what you paid is nobody else's business. This is a deliberate omission,
not an oversight to be tidied up later.

### What app-wide costs, found 2026-09-11

- **`/collections/[id]` renders two deltas stacked** — `PriceDelta caption="vs. paid"` immediately
  followed by `PriceDelta caption={RANGE_CAPTION[range]}`. The period one goes.
- **The collection's Gain tile duplicates its own headline**, exactly as Home's did. Same fix: replace
  it with **In profit — N of M**, which is a vs-paid fact the headline does not already state.
- **The collection chart** becomes value against the cost-basis step line, matching Home.
- **Copy:** the code says `"vs. paid"`, the artboards say `"vs paid"`. Standardise on **vs paid**.

---

## 2. Search navigates; the card page acts

**Settled 2026-09-11.** Artboards: `docs/design/Palette.dc.html`, `docs/design/Card.dc.html`.

**The finding that made this a decision:** the search pill every artboard draws in the top bar does
not exist in the app. `TopNav` accepts a `search` prop and `app/(app)/layout.tsx` never passes one;
the only place it has ever rendered is `/dev/ui`. Search lives in four local dialogs only (add to
collection, new alert, deck builder, admin curation), all sharing `useCardSearch` and `/api/search`.

**Decision:** a command palette (⌘K, and the pill as its visible affordance) that **only navigates**.
An earlier draft gave each result an action menu — add to collection, add to deck, create alert. That was
rejected: every item needs a different form (adding to a collection needs printing, condition, quantity
and what you paid), so a menu of forms is just a worse router.

Instead the palette opens `/cards/[id]`, which is already the richest screen in the app — printings
table with per-printing "You own", price history with range pills and a printing selector, "in your
collections" links, an inline add form, and a set-alert shortcut.

Results are grouped: **In your collection** (rows read vs paid) → **In the catalog** (market price
only; there is nothing to compare against yet) → **Go to** (sets and decks).

**Built 2026-09-11.** `CommandPalette` is mounted in the app shell through `TopNav`'s `search` slot
— which had existed since phase 2a and never been filled. ⌘K anywhere, or the pill. Results come
back in three groups: **In your collection** (with the copy count, the fastest way to tell "I have
this" from "I could have this"), **In the catalog**, and **Go to** for sets and decks. Enter opens
the card page with `?from=` set to wherever you were, so its back arrow returns there.

Openness is derived rather than stored — the palette is open while the path it opened on is still
the path you are on — so navigating closes it with no effect and no cascading render. Results carry
the query they answer, the way `useCardSearch` does, so a stale page is never shown and no
synchronous `setState` sits in an effect body.

**Card page gaps to close**, both small and both drawn in `Card.dc.html`:
- `getCardHolders` returns quantity but not cost — needs `SUM(quantity * acquired_price)` so the page
  can show what you paid.
- There is no query for "my decks containing this card" — a join on `deck_cards` where the deck is
  the caller's. The page currently knows only about *meta* decks.

---

## 3. Acquisitions are lots — one row per purchase

**Settled 2026-09-11.** Data model, not layout. Blocks the vs-paid work above.

**The bug this fixes.** `collection_items` has `UNIQUE (collection_id, printing_id, condition)` — one
row per printing and condition, with a single scalar `acquired_price` ("dollars, per copy"). Adding
a card you already own hits the upsert in `lib/collections.ts`:

```sql
quantity       = MIN(quantity + excluded.quantity, 9999),
acquired_price = COALESCE(collection_items.acquired_price, excluded.acquired_price),
acquired_date  = COALESCE(collection_items.acquired_date,  excluded.acquired_date)
```

`COALESCE(existing, new)` means the existing value always wins, so the price and date you just typed
are **discarded silently**. Cost is then computed as `quantity * acquired_price`, valuing every later
copy at the first copy's price.

Buy at $1,101.50, buy again at $1,400: cost basis reads 2 × $1,101.50 = $2,203.00 rather than
$2,501.50 — understated by $298.50, gain overstated by the same. Every vs-paid figure on Home is
wrong for any card bought more than once at a different price, and `acquired_date` is only ever the
first purchase's date.

**Decision: one row per acquisition.** Drop the unique constraint; each add is its own lot with its
own price, date, quantity and condition. This is the honest model — you did buy them at different
times for different amounts — and it is the only one where per-purchase gain, a purchase history on
the card page, and partial disposals later can mean anything. A weighted average is then simply
something computed *from* lots, not a replacement for them.

**Applies to sealed products too**, which will share this table.

### What this touches

- **Schema:** drop `UNIQUE (collection_id, printing_id, condition)`. Existing rows become the first
  lot, so the migration is additive for data — but SQLite cannot drop a constraint in place, so it
  needs the table-rebuild dance (create new, copy, drop, rename) inside one transaction.
- **`addItem`:** plain `INSERT`, no `ON CONFLICT`.
- **`updateItem` / `removeItem`:** already keyed by `collection_items.id`, so they become per-lot
  operations for free — but the UI calling them must now say *which* lot.
- **`getCollectionHoldings`:** returns lots; the collection screen must group them per printing+condition
  for display while keeping the lots reachable. `cost` per lot is `quantity * acquired_price`, and a
  grouped row's cost is the sum — so `getCollectionSummary` gets *more* accurate with no change to its
  own arithmetic.
- **`getCardHolders`:** same grouping question, plus the cost sum noted in decision 2.
- **Card page "Your copies":** becomes a list of lots rather than a single row.
- **Tests:** `addItem` currently has coverage asserting the merge behaviour — those assertions invert.

---

## 4. The collection gets grid and list, grid by default

**Settled 2026-09-11.** Artboard: `docs/design/CollectionGrid.dc.html`.

`HoldingsTable` shipped as a vertical list of `CardRow`s with a quantity stepper and Remove inline
on every row; `Main.dc.html` drew a four-column card-art grid with a Grid | List toggle. Neither the
grid nor the toggle exists. `SetGrid.tsx` already renders card art at `grid-cols-3 sm:4 md:6 lg:8`,
so the grid is mostly that component with different tile contents.

**Grid is for recognising cards, list is where you work.** The quantity stepper and Remove stay in
list view only. That also settles where lots (decision 3) live: expanding a holding into its
purchases is a disclosure row, which a grid tile cannot carry without becoming a popover.

**The tile:** art, name, set and number, then value with the vs-paid percent.

- **Quantity is a dark pill on the art**, not text appended to the name — the ×N convention
  `SetGrid` already uses, and the only version that scans across a wall of cards.
- **Value is the line total**, not the unit price: Shanks ×3 reads $204.30.
- **Percent only, no dollar delta.** At 183px a tile cannot hold both; the dollar figure is in list
  view, which is where you go to act anyway.
- **No recorded cost** shows an accent *Add cost* rather than a misleading 0% — that holding is
  silently distorting the collection's gain, so the prompt is the useful thing.
- **No market price** dims the art and reads *no price*, matching `HoldingsTable`.

**View persists in the URL** (`?view=grid`), matching the existing `?range=` and `?p=` idiom —
server-renderable and shareable, unlike localStorage.

**Open:** whether `/s/[token]` gets the grid, and whether it gets *only* the grid, since there is
nothing to edit on a shared collection.

---

## 5. Type scale: fourteen sizes become nine

**Settled 2026-09-11.** Specimen: `docs/design/Type.dc.html`.

The app ran two parallel type systems — 81 arbitrary `text-[Npx]` against 66 Tailwind named sizes,
14 distinct sizes in all. The core drift: **12px and 13px were both doing "secondary text"**, 107
uses split with no rule, while the design distinguishes dim from muted by *colour*
(`#8a8072` / `#6f665a`), not size. The three tokens added in `d89f5e9` (`--text-caption`,
`--text-micro`, `--tracking-label`) had **zero uses** — defined, never adopted.

The artboards settle which size wins: **218 uses of 12px against 90 of 13px.** The design already
prefers 12; the code drifted to 13.

**Body ramp (DM Sans):** `text-micro` 11 · `text-caption` 12 · `text-base` 14 · `text-stat` 18.
**Display ramp (DM Serif):** `text-title` 22 · `text-wordmark` 24 · `text-section` 26 · `text-price` 32
· `text-hero` 56, plus 44 for the phone hero.

`text-base` is redefined to **14px**; Tailwind's own default is 16, which never matched the 14px body
font-size this app has always set. The wordmark earns a token of its own rather than sitting outside
the ramp: it is 24 in a bar, and the standalone lockup on auth and landing uses `text-section`, which
keeps the page heading larger than the branding above it.

**Implemented 2026-09-11.** The split landed 37 of the 64 thirteens on caption and promoted 27 to
base — every `role="alert"`, every empty state, every notice. `tests/ui/type-scale.test.ts` fails on
any arbitrary `text-[Npx]` or any Tailwind generic size in `app/` or `components/`, and the artboards
were folded in the same pass: 89 more thirteens, plus 15→14 (21), 20→18, 30→26, 17→18, 36→32, 16→14,
and the live set now uses only the nine sizes plus the phone hero's 44. `Ticker` and `Playmat` were
left alone — they are archived directions, explicitly not chosen.

**Splitting the 64 thirteens:** *supporting another element* → 12 (back links, archetype and game
labels, field labels, "sorted by value"); *read as content* → 14 (error messages, empty states, "No
cards match"). Errors and empty states therefore get **bigger**, not smaller — they are the ones you
must act on, and 12px for "Could not reach the server" would be a regression.

**Retired:** 10→11, 13→12 or 14, 15→14, 16→14, 17→18, 20→22, 30→32, 36→32, 40→44, 52→56.

### Consequences

- **`--text-caption` is redefined from 13px to 12px.** It has no uses, so nothing breaks — but
  `tests/ui/foundations.test.tsx` asserts `13px` and that assertion inverts, which is the signal the
  change landed.
- `text-[13px]` and `text-xs` both become forbidden in the body range, guarded by a source-level
  test in the manner of the re-export trap in `tests/ranges.test.ts`.
- **The artboards use 13px 90 times.** They must get the same caption-or-content pass, or the design
  spec stops matching the app — the exact drift this decision exists to kill. Do it *with* the code
  migration so the two land together and can be checked against each other.

---

## 6. One icon standard, documented in `Icon.tsx`

**Settled and implemented 2026-09-11** (`cfe428f`).

Nine icons shipped, hand-written inline across five files, and nine was already enough to drift:
six used a 24 viewBox at stroke 1.8, three used a 16 viewBox, two of those at stroke 2. Phase 5
roughly triples the count, so hand-drawing stops scaling here.

Paths are traced from **Lucide (ISC)** into a local map rather than depending on `lucide-react` —
the runtime dependency list is ten packages and an icon is fifty bytes of path data.

The rules live in a JSDoc block at the top of `components/ui/Icon.tsx` so a grep lands on them: one
viewBox (24), one stroke (1.8), no fill, `currentColor` always, sizes closed to **16 inline / 20
controls / 24 nav** (folding the artboards' seven). `aria-hidden` unless given a `title`.

**Game marks are not icons.** Recorded in the same block at Renzo's request, ahead of per-game marks
being introduced: they are filled, often multi-colour, carry their own aspect ratios, name the row
rather than decorate it, and are third-party trademarks. Every rule above is wrong for them. They
get their own `GameMark` component.

`tests/ui/icon-standard.test.ts` fails on any inline `<svg>` outside `Icon.tsx` and `LineChart.tsx`,
pins the geometry, keeps the size set closed, and fails if the game-marks note is deleted.

---

## 7. The header is sticky

**Settled and implemented 2026-09-11.** Save in the deck builder sits in `SectionHeading`'s
`trailing` slot beside the draft status — and scrolled away, on the one screen whose whole job is
repeated edits down a long card list.

**Sticky on desktop, docked on mobile**, and the header is sticky on *every* screen rather than just
the builder: `TopNav` is now `sticky top-0 z-40 bg-ground`. The background matters — a transparent
sticky header lets content slide visibly underneath it.

The mobile docked bar works without fighting `BottomTabBar`: the tab bar is a sibling *after*
`main` in a `min-h-dvh flex-col` layout, so a `sticky bottom-0` element inside `main` settles
directly above it rather than under it.

**Logged, not decided:** there is no unsaved-changes guard. `saved === "dirty"` is tracked and
nothing warns on navigate-away.

---

## 8. Two content ceilings

**Settled and implemented 2026-09-11.** There was no `max-w` anywhere; `main` filled the window, and
no screen had ever been seen above the artboards' 1280.

Two tokens, because the two kinds of screen want opposite things on a wide monitor:
`--container-read: 1200px` for screens you read left-to-right (card detail, alerts — 2000px lines
are unreadable) and `--container-scan: 1800px` for screens you scan (collection grid, set grid — an
ultrawide should buy more columns). `main` carries `max-w-scan` as the outer bound so nothing is
ever truly unbounded, and reading screens tighten it themselves with `max-w-read`.

---

## 9. Zero is not unknown

**Settled and implemented 2026-09-11.** `PriceDelta` already had a zero branch — and it rendered
`— $0.00`, so the em dash meant both *"we have no price for this"* and *"this has not moved"*. Those
are never interchangeable, and the second became common the moment every figure started reading
against cost basis: a quiet week, or anything bought at today's price.

Zero now renders **dim text with no glyph at all** — `$0.00` — and the em dash is reserved for
unknown. Gains keep ▲ in `text-gain`, losses keep ▼ in `text-accent` (terracotta is this system's
loss colour; see `docs/design/README.md`). No word is added; the colour carries it.

Pinned in `tests/ui/foundations.test.tsx`.

---

## 10. What is pinned, and what scrolls

**Settled and implemented 2026-09-12.** Decision 7 pinned `TopNav`. This extends the same offset to
everything else that stays: `StickyBar` sits at `top-16` — TopNav's exact height — so a page with a
pinned toolbar and a pinned sidebar lines them up without anyone doing arithmetic.

The rule is *controls stay, content scrolls*. On `/sets` the heading, the search and the pills are
pinned; only the era sections move. On a collection the same applies to the card toolbar, and the
whole summary column is pinned too — it is the answer to "what is this worth", and scrolling past it
to look at a card should not make you scroll back.

Two details are load-bearing and easy to get wrong:

- `bleed` (default) uses negative margins to cancel `main`'s padding. A bar confined to the content
  column lets rows scroll past in the gutters beside it. `bleed={false}` is for a bar inside one
  column of a grid, where bleeding would paint over its neighbour.
- The pinned sidebar is `md:` only. Below that the page is one column and a pinned 380px block
  would *be* the screen.

Game pills and completion pills moved onto one row on `/sets`: two axes, but stacking them cost a
third of the pinned bar's height and the pill shapes already tell them apart.

---

## 11. The way back is an arrow

**Settled and implemented 2026-09-12.** Every detail screen opened with a full-width `← Collections`
line above its heading. That is a whole row of vertical space — expensive now that the row below it
is pinned — to say what an arrow says.

`BackLink` renders it as a 32px arrow, and `SectionHeading` takes it as `back={{ href, label }}` so
it lands on the title's line. The label does not disappear: it becomes the accessible name
(`Back to Collections`) and the tooltip. Applied to the set and collection screens; the card and
deck screens have a different column shape and still carry the old row.

---

## 12. Collections get slugs too

**Settled and implemented 2026-09-12.** `/collections/my-binder`, not `/collections/7`, matching
what decision 8's follow-up did for sets.

Two things differ from set slugs, both because a collection is **private**:

- Uniqueness is scoped **per user**, not globally. Two people may each have a "Main Binder"; neither
  has to apologise, because neither can see the other's.
- The slug **is regenerated on rename**. A set slug is frozen because it is a URL other people hold;
  the only link to a collection is the owner's own, so a binder renamed "Slabs" should stop living
  at `/collections/raw-singles`. Public sharing goes through `share_links.token`, which is
  untouched by any of this.

Bare ids still resolve and redirect to the slug — every link in the app used one until now, and
`?from=` parameters of that shape are already in the wild. `collectionIdFromPath` became
`collectionRefFromPath` and returns the raw segment; resolving it is what proves the reader owns it,
so "no such collection" and "not yours" stay indistinguishable.

---

## 13. API TCG is not the single source (and its quota is not free)

**Settled 2026-09-12.** Evaluated and rejected as a replacement for pokemontcg.io + tcgcsv. The
account has a **1,000-request cap**, so this was settled once and the evidence is written down here
rather than re-fetched.

What it has: all 220 of our Pokemon sets, 87 One Piece, 13 Riftbound — every one carrying
`markets.tcgplayer.id`, which joins to `sets.tcgplayer_group_id` at a **100% rate**. Product
`attributes` are rich (rarity, HP, attacks, artist) and every product carries a TCGplayer price
block.

What it does not have, and why that decides it:

- **`serie` is null on every set of every game.** The field is in their schema; nothing populates it.
  Their own docs mark the product-level one "(not in use)". The 16 era headings on `/sets` are built
  from that concept, so this alone rules out consolidation.
- **No set art.** `logo` is absent on all 320.
- **`code` is what we already store.** 214 of 220 are byte-identical to our tcgcsv codes, and 5 of
  the 6 differences are API TCG having *no* code where we have one. And the code does not encode the
  era: prefixes abbreviate the set NAME (`PRC` = Primal Clash, an XY set), `SV` is Supreme Victors
  (Platinum) while `SVE` is Scarlet & Violet, and Mega Evolution sets carry MEG/PFL/CRI/ASC/ME.
- **Price history is per product**, starting 2026-03-25. 55k printings would be 55k requests to cover
  what 180 daily tcgcsv archives cover, over a shallower window.

The era data *does* exist one layer out — `apitcg/pokemon-tcg-data/sets/en.json` on GitHub has
`series` on all 171 of its sets. But that file **is pokemontcg.io's data** (`id: "base1"`, art hosted
on `images.pokemontcg.io`), and joining it against our 73 era-less sets adds **zero** coverage: those
73 are TCGplayer product groups — Battle Academy, Blister Exclusives, Kids WB Promos — that are not
sets in the game's own sense and have no era to be given. That is what `UNGROUPED` is for.

**Two traps, both sprung during the evaluation and both now guarded by `ingest/apitcg.ts`:**

1. `/api/{tcg}/sets` **ignores `page` and `limit`** and returns the whole list every time. A
   "paginate until a short page" loop therefore never terminates and re-fetches the same 220 rows —
   it also inflated an early count to "2,640 Pokemon sets", which was 220 counted twelve times.
2. Fan-out. Seven agents probing endpoints in parallel cost ~160 requests in a few minutes.

Every call now goes through `apitcgFetch`, which serves from `.cache/apitcg/` and only reaches the
network for a path it has never seen. Re-running a script costs nothing; `refresh: true` is the only
way to spend quota on a known path. Pinned in `tests/apitcg.test.ts`.

**Where it still earns its keep:** One Piece and Riftbound card attributes and images, which we have
no other source for. That is a deliberate, bounded fetch — not a migration.

---

## Still open

The original eight are closed. What remains:

- Whether alerts belong on Home at all (drawn as "triggered since you were last here", capped, with
  a link out — but there is a whole Alerts tab).
- Palette as an overlay vs a dropdown under the pill. With actions removed the two are nearly
  equivalent; the overlay keeps ⌘K and can list sets and decks alongside cards.
