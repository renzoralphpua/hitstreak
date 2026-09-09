# Hitstreak design — "Binder" system

Approved 2026-09-05. Live canvas (view/export, editable where enabled):
https://claude.ai/code/artifact/824b346b-d706-447f-b137-a5a83df3ee2c

Each `*.dc.html` file here is one artboard (static mockup) from that canvas; `canvas.json` is the layout.
`Ticker` and `Playmat` are the directions that were **not** chosen — kept for reference only.

`Dashboard.dc.html` (added 2026-09-10) is the Home screen, and it splits the job `Main.dc.html` used to do
alone. **Home is what you read** — the total across every binder, its chart, the biggest movers, deck
progress, alerts that fired; nothing on it edits anything. **Binder (`Main.dc.html`) is what you change** —
add and remove cards, purchase price, rename, delete — and binder switching moves into a dropdown in its
header, so the by-binder rows on Home are a breakdown, drawn as plain rows rather than the selected dark chip.
Home gets **no nav item** — the wordmark is the link to it, on desktop and on the phone header alike — so the
primary nav stays at four and no existing artboard's top bar changes.

**Every comparison on Home is against cost basis.** One measure, everywhere: the headline delta, the per-binder
rows and the winners/losers list all read *vs paid*, never "change over the last N days". The range pills stay,
but they only pick the chart's **window** — the chart plots market value against the cost-basis step line, so the
gap between the two lines is the gain, whatever window you choose. The headline gain is a level, not a window
figure, so it does not change when you switch range. Anything that cannot be expressed against cost basis does
not belong on Home: that is why the tier-1 rows show a build cost with no trend, and why alert thresholds
(absolute prices, by definition) stay confined to the Alerts panel.

## Tokens

| Token | Value | Use |
|---|---|---|
| Display type | DM Serif Display (Georgia fallback) | Money values, page headings, logo |
| Body type | DM Sans (Segoe UI / system-ui fallback) | Everything else; 14px base, 12–13px secondary |
| Ground | `#f6f1e8` | Page background (warm paper) |
| Surface | `#fbf8f2` | Cards, panels, inputs |
| Hairline | `#e3dccf` | Borders, dividers; `#ece5d8` for inner dividers and pill fills |
| Ink | `#1f1b16` | Primary text; also the fill of the selected/primary chip |
| Muted | `#6f665a` | Secondary text |
| Dim | `#8a8072` | Tertiary text, captions |
| Accent | `#b5573a` (terracotta) | Chart lines, links, "missing" progress, losses |
| Gain | `#2f7a4f` | Positive deltas, owned confirmations |
| Hairline (strong) | `#cfc5b4` | A hairline that must stay VISIBLE on `--hairline-soft` — the muted progress track, the dashed missing-tile border |
| Chip ink (muted) | `#cfc5b4` | Secondary text ON an ink chip (the artboards use it 21×) |
| Accent (hover) | `#8f4128` | Link hover, as every artboard specifies |
| Focus | `#b5573a` | The one focus-visible ring (accent; clears 3:1 on every surface in both themes) |
| Radii | 10–12px panels · 999px pills · 8–10px card tiles · 16px card art (`rounded-art`) | |
| Shadows | `0 8px 18px rgba(60,40,10,.12)` on card art tiles; `0 18px 40px rgba(60,40,10,.18)` on the card-detail hero (`shadow-art`) | Cards should read as physical objects |
| Small type ramp | `--text-caption` 13px · `--text-micro` 11px · `--tracking-label` 0.06em | Captions, micro labels, the uppercase group label. Added 2026-09-09 — `text-[13px]` had reached 64 hand-written uses |

### Dark mode (theme toggle; light is default)

| Token | Value |
|---|---|
| Ground | `#15120e` (warm charcoal — never neutral black) |
| Surface | `#1d1913` |
| Hairline | `#2b251d` |
| Hairline (soft) | `#241f18` |
| Ink | `#f1ebe0` |
| Muted / Dim | `#9a8f7f` / `#8a7f6f` |
| Accent | `#e07a55` |
| Gain | `#7fcf98` |
| Chip / chip ink | `#f1ebe0` / `#15120e` |
| Chip ink (muted) | `#5c5347` |
| Hairline (strong) | `#3a3128` |
| Accent (hover) | `#f09a78` |
| Focus | `#e07a55` |
| Card tile shadow | `0 10px 22px rgba(0,0,0,.45)`; hero art `0 18px 40px rgba(0,0,0,.55)` |

## Conventions

- **Owned vs missing:** owned cards are solid tiles with a `×N` count chip (ink fill, cream text); missing cards are dashed-border, tinted, dimmed. Same rule in Sets, Decks, Builder.
- **Selected state** = inverted dark chip (ink background, cream text). Filters are pills.
- **Focus:** one ring for the whole app — `:focus-visible { outline: 2px solid var(--focus) }` in `@layer base`. A primitive may thicken it or move it (`SearchField` puts it on the pill via `focus-within`) but must never remove it. `outline-none` is only allowed where an ancestor carries the ring.
- **Motion:** everything is suppressed under `prefers-reduced-motion: reduce`.
- **Navigation:** Binder · Sets · Decks · Alerts, search always present in the top bar (the Builder swaps search for the draft-status + Save action). The wordmark links to Home; on Home itself no nav item is lit.
- **Icons:** inline stroke SVG only — no emoji, no icon fonts.
- **Numbers:** `font-variant-numeric: tabular-nums` everywhere a column of figures appears.
- **Phone:** 390px layout with a 4-tab bottom bar (Binder, Sets, Decks, Alerts); leave the system status bar area alone.
- Sample data in the mockups is illustrative only.

## Implemented as

Tokens (`app/globals.css`) → Tailwind utility:

| Token | Utility |
|---|---|
| `--ground` | `bg-ground` |
| `--surface` | `bg-surface` |
| `--hairline` | `border-hairline` |
| `--hairline-soft` | `bg-hairline-soft` |
| `--ink` | `text-ink` |
| `--muted` | `text-muted` |
| `--dim` | `text-dim` |
| `--accent` | `text-accent` / `bg-accent` |
| `--gain` | `text-gain` / `bg-gain` |
| `--chip` / `--chip-ink` | `bg-chip text-chip-ink` |
| Display font | `font-display` |
| Radii | `rounded-panel` / `rounded-tile` |
| Card tile shadow | `shadow-tile` |
| Tabular numerals | `.num` |

Mockup element → primitive (`components/ui/`):

| Mockup element | Primitive |
|---|---|
| Filter chips | `Pill` |
| Primary/secondary actions | `Button` (pass `href` for a navigational one — same skin, renders a link) |
| Text fields | `Input` (optional `label`) |
| Multi-line text fields | `Textarea` (same field skin as `Input`, optional `label`) |
| Panels | `Panel` |
| Serif section titles | `SectionHeading` |
| Paid/Gain tiles | `StatTile` |
| ▲/▼ changes | `PriceDelta` |
| Completion bars | `ProgressBar` |
| Tier 1/2 badges | `TierBadge` |
| Legality panel | `ValidationList` |
| Search pill | `SearchField` |
| Binder-grid cards | `CardTile` |
| List rows | `CardRow` |
| Triggered alert row | `CardRow tone="inverted"` (the ink chip; the `right` slot inherits its colour) |
| Top bar | `TopNav` |
| Phone tab bar | `BottomTabBar` |
| Theme toggle | `ThemeToggle` |
| Nothing-here panels | `EmptyState` |
| Serif money values | `MoneyDisplay` |
| Value / price chart | `LineChart` |
| 7D · 30D · 90D · 1Y · All row | `RangePills` |
| Meta deck row (name, tier, You own x / N, $ to complete, bar) | `DeckSummaryPanel` (`app/(app)/decks/`; a `Link` around `Panel` + `TierBadge` + `ProgressBar`, like `SetPanel` on /sets) |

**Group labels:** the uppercase tier labels on /decks, the Triggered / Watching labels on /alerts, the
deck builder's zone headings (`Main deck`, `Runes`, … each with the zone's card subtotal) and the
per-game headings on /admin/decks are the same ad-hoc
`text-xs font-semibold uppercase tracking-[0.06em] text-muted` span — a `GroupLabel` primitive
candidate (spec §13, four sites now), not promoted yet.

**Zero-change convention:** a 0 delta renders neutral (no arrow, dim text — neither gain nor accent);
percentages that round to 0.0% are shown unsigned (no leading `+`/`-`).

**Tap targets:** anything tappable is at least 44px high on a phone. `Button` and `Input` are 44px
everywhere (`min-h-11`); `Button size="sm"` and `Pill` are `min-h-11 md:min-h-8` — a thumb target
on phones, the compact 32px control of the mockups from `md` up. Width counts too: an icon-width
override such as the `−` / `+` steppers' `px-2.5` wins over `size="sm"`'s `px-3` in `twMerge`, so those
buttons carry `min-w-11 md:min-w-0` beside it (same modifier trick as the heights).
