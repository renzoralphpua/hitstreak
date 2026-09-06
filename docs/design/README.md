# Hitstreak design — "Binder" system

Approved 2026-09-05. Live canvas (view/export, editable where enabled):
https://claude.ai/code/artifact/824b346b-d706-447f-b137-a5a83df3ee2c

Each `*.dc.html` file here is one artboard (static mockup) from that canvas; `canvas.json` is the layout.
`Main.dc.html` is the portfolio home. `Ticker` and `Playmat` are the directions that were **not** chosen — kept for reference only.

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
| Radii | 10–12px panels · 999px pills · 8–10px card tiles | |
| Shadows | `0 8px 18px rgba(60,40,10,.12)` on card art tiles | Cards should read as physical objects |

### Dark mode (theme toggle; light is default)

| Token | Value |
|---|---|
| Ground | `#15120e` (warm charcoal — never neutral black) |
| Surface | `#1d1913` |
| Hairline | `#2b251d` |
| Ink | `#f1ebe0` |
| Muted / Dim | `#9a8f7f` / `#8a7f6f` |
| Accent | `#e07a55` |
| Gain | `#7fcf98` |
| Card tile shadow | `0 10px 22px rgba(0,0,0,.45)` |

## Conventions

- **Owned vs missing:** owned cards are solid tiles with a `×N` count chip (ink fill, cream text); missing cards are dashed-border, tinted, dimmed. Same rule in Sets, Decks, Builder.
- **Selected state** = inverted dark chip (ink background, cream text). Filters are pills.
- **Navigation:** Binder · Sets · Decks · Alerts, search always present in the top bar (the Builder swaps search for the draft-status + Save action).
- **Icons:** inline stroke SVG only — no emoji, no icon fonts.
- **Numbers:** `font-variant-numeric: tabular-nums` everywhere a column of figures appears.
- **Phone:** 390px layout with a 4-tab bottom bar (Binder, Sets, Decks, Alerts); leave the system status bar area alone.
- Sample data in the mockups is illustrative only.
