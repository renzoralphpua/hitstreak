# Phase 5 — UX decisions

A running record of the collaborative UI/UX pass. Each entry is a decision that is **settled**, with
the reasoning that settled it, so a later plan can be written from this file rather than from chat
scrollback. Artboards live in `docs/design/`; the canvas is linked from `docs/design/README.md`.

---

## 1. Home and Binder are two screens

**Settled 2026-09-10.** Artboard: `docs/design/Dashboard.dc.html`.

The approved `Main.dc.html` drew a single screen that merged a binder's value, chart and a binder
switcher with that binder's cards. We shipped it as two (`/portfolios`, `/portfolios/[id]`). Rather
than collapse them back, Home becomes a genuine portfolio-level screen — the one that answers "what
is my whole collection worth", which nothing answered before.

- **Home is what you read.** Total across binders, its chart, winners and losers, deck progress,
  alerts that fired. Nothing on it edits anything.
- **Binder is what you change.** Add and remove cards, purchase price, rename, delete.
- **Binder switching** moves into a dropdown in the Binder header. `/portfolios` keeps its role as
  the management surface (create, rename, delete) and does not auto-jump to the last binder used.
- The by-binder rows on Home are therefore a *breakdown*, not a switcher, and are drawn as plain
  rows — never the selected dark chip, which means "selected" everywhere else in the system.

**Home has no nav item.** The wordmark links to it, on desktop and in the phone header alike. The
primary nav stays at four (Binder · Sets · Decks · Alerts), so no existing artboard's top bar
changes, and on Home no tab is lit.

### 1a. One measure, app-wide: vs paid

**Settled 2026-09-10 for Home; promoted app-wide 2026-09-11.**

**The rule: wherever a figure describes something you own, it reads against what you paid.** Never
"change over the last N days". That covers the Home headline, the per-binder rows, the winners and
losers, the binder rail, the binder grid tiles and `HoldingsTable`'s per-row deltas.

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

- **`/portfolios/[id]` renders two deltas stacked** — `PriceDelta caption="vs. paid"` immediately
  followed by `PriceDelta caption={RANGE_CAPTION[range]}`. The period one goes.
- **The binder's Gain tile duplicates its own headline**, exactly as Home's did. Same fix: replace
  it with **In profit — N of M**, which is a vs-paid fact the headline does not already state.
- **The binder chart** becomes value against the cost-basis step line, matching Home.
- **Copy:** the code says `"vs. paid"`, the artboards say `"vs paid"`. Standardise on **vs paid**.

---

## 2. Search navigates; the card page acts

**Settled 2026-09-11.** Artboards: `docs/design/Palette.dc.html`, `docs/design/Card.dc.html`.

**The finding that made this a decision:** the search pill every artboard draws in the top bar does
not exist in the app. `TopNav` accepts a `search` prop and `app/(app)/layout.tsx` never passes one;
the only place it has ever rendered is `/dev/ui`. Search lives in four local dialogs only (add to
binder, new alert, deck builder, admin curation), all sharing `useCardSearch` and `/api/search`.

**Decision:** a command palette (⌘K, and the pill as its visible affordance) that **only navigates**.
An earlier draft gave each result an action menu — add to binder, add to deck, create alert. That was
rejected: every item needs a different form (adding to a binder needs printing, condition, quantity
and what you paid), so a menu of forms is just a worse router.

Instead the palette opens `/cards/[id]`, which is already the richest screen in the app — printings
table with per-printing "You own", price history with range pills and a printing selector, "in your
binders" links, an inline add form, and a set-alert shortcut.

Results are grouped: **In your collection** (rows read vs paid) → **In the catalog** (market price
only; there is nothing to compare against yet) → **Go to** (sets and decks).

**Card page gaps to close**, both small and both drawn in `Card.dc.html`:
- `getCardHolders` returns quantity but not cost — needs `SUM(quantity * acquired_price)` so the page
  can show what you paid.
- There is no query for "my decks containing this card" — a join on `deck_cards` where the deck is
  the caller's. The page currently knows only about *meta* decks.

---

## 3. Acquisitions are lots — one row per purchase

**Settled 2026-09-11.** Data model, not layout. Blocks the vs-paid work above.

**The bug this fixes.** `collection_items` has `UNIQUE (portfolio_id, printing_id, condition)` — one
row per printing and condition, with a single scalar `acquired_price` ("dollars, per copy"). Adding
a card you already own hits the upsert in `lib/portfolios.ts`:

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

- **Schema:** drop `UNIQUE (portfolio_id, printing_id, condition)`. Existing rows become the first
  lot, so the migration is additive for data — but SQLite cannot drop a constraint in place, so it
  needs the table-rebuild dance (create new, copy, drop, rename) inside one transaction.
- **`addItem`:** plain `INSERT`, no `ON CONFLICT`.
- **`updateItem` / `removeItem`:** already keyed by `collection_items.id`, so they become per-lot
  operations for free — but the UI calling them must now say *which* lot.
- **`getPortfolioHoldings`:** returns lots; the binder screen must group them per printing+condition
  for display while keeping the lots reachable. `cost` per lot is `quantity * acquired_price`, and a
  grouped row's cost is the sum — so `getPortfolioSummary` gets *more* accurate with no change to its
  own arithmetic.
- **`getCardHolders`:** same grouping question, plus the cost sum noted in decision 2.
- **Card page "Your copies":** becomes a list of lots rather than a single row.
- **Tests:** `addItem` currently has coverage asserting the merge behaviour — those assertions invert.

---

## Still open

- Whether alerts belong on Home at all (drawn as "triggered since you were last here", capped, with
  a link out — but there is a whole Alerts tab).
- Palette as an overlay vs a dropdown under the pill. With actions removed the two are nearly
  equivalent; the overlay keeps ⌘K and can list sets and decks alongside cards.
- Decisions 3–8 of the original eight: holdings grid vs list, type scale, icons, builder Save
  placement, max content width, zero-delta glyph.
