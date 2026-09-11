/**
 * THE ICON STANDARD. Every UI glyph in this app comes from here — if you are reaching for an inline
 * `<svg>` in a component, you are in the wrong place. Grep `Icon.tsx` before drawing anything.
 *
 * ## Why a local map rather than a package
 *
 * The paths below are traced from Lucide (ISC licensed, so copying is permitted) and normalised to
 * this app's geometry. We keep them here rather than depending on `lucide-react` because the runtime
 * dependency list is deliberately short — ten packages — and an icon is fifty bytes of path data.
 * Adding one is a copy-paste; there is no build step and no upstream to track.
 *
 * ## The geometry — all three are non-negotiable
 *
 * - **`viewBox="0 0 24 24"`.** One grid. Paths authored against any other box will look wrong at
 *   every size, and mixing boxes is what the pre-Phase-5 icons did (three of nine used a 16 grid).
 * - **`stroke-width: 1.8`, no fill.** Line icons only. 1.8 is the majority of what shipped and it
 *   reads correctly against DM Sans at every size in {@link SIZES}. A filled glyph in this map is a
 *   bug; see "Game marks" below for the one category that is allowed to be filled, and why it does
 *   not live here.
 * - **`stroke="currentColor"`.** Never a literal colour, never a token. The icon inherits from its
 *   parent so it works unchanged in light, dark, and on the inverted ink chip.
 *
 * ## Sizes
 *
 * {@link SIZES} is the whole set: 16 inline with text, 20 in controls, 24 in navigation. The
 * artboards drew icons at seven sizes (12, 13, 14, 15, 16, 18, 22); those fold into these three.
 * Do not pass an arbitrary pixel size — add a size here if a real case needs one.
 *
 * ## Accessibility
 *
 * Decorative by default: `aria-hidden` is set unless you pass a `title`. An icon that is the only
 * content of a control MUST get a `title`, or the control MUST carry its own `aria-label`.
 *
 * ## Game marks are NOT icons — do not add them to this map
 *
 * Pokémon, One Piece and Riftbound marks are a different category and need their own component
 * (`GameMark`, when it exists). Three reasons they cannot live here:
 *
 * 1. **Geometry.** They are filled, often multi-colour, and have their own aspect ratios. Every rule
 *    above — 24 grid, 1.8 stroke, no fill, `currentColor` — is wrong for them.
 * 2. **Identity, not iconography.** A game mark says "this is a One Piece card". It is data about
 *    the row, not decoration, so it usually needs a real accessible name rather than `aria-hidden`.
 * 3. **Licensing.** These are third-party trademarks. They are not ours to normalise, recolour, or
 *    trace, and they must not be mixed into a map whose whole premise is "we redraw these freely".
 *
 * If you need to distinguish games in a line-icon context, use a neutral glyph plus a text label,
 * or the per-game art tint the design system already defines (see `docs/design/README.md`).
 */
import type { SVGProps } from "react";
import { cn } from "./cn";

/** 16 inline with text · 20 in controls · 24 in navigation. Nothing else. */
export const SIZES = { sm: 16, md: 20, lg: 24 } as const;
export type IconSize = keyof typeof SIZES;

/**
 * Path data only — every glyph is stroked with the geometry in the file header, so a path here must
 * assume a 24×24 box and must not carry its own `fill`, `stroke`, or `stroke-width`.
 *
 * `round` opts a glyph into `stroke-linejoin="round"`; the default is `miter`, which keeps the
 * chevrons and the grid crisp. Every glyph gets `stroke-linecap="round"`.
 */
const ICONS = {
  // — navigation ————————————————————————————————————————————————
  /** Binder: a ring-bound album, spine on the left. */
  binder: { d: "M4 3 h16 a2 2 0 0 1 2 2 v14 a2 2 0 0 1 -2 2 H4 Z M8 3 V21", round: true },
  /** Sets: four cards laid out as a page. */
  grid: { d: "M3 3 h8 v8 h-8 Z M13 3 h8 v8 h-8 Z M3 13 h8 v8 h-8 Z M13 13 h8 v8 h-8 Z", round: true },
  /** Decks: two stacked cards, the back one fanned. */
  decks: { d: "M7.5 3.2 l9.3 1.3 a2 2 0 0 1 1.7 2.3 l-1.8 12.9 M4 5 h13 a2 2 0 0 1 2 2 v14 a2 2 0 0 1 -2 2 H4 a2 2 0 0 1 -2 -2 V7 a2 2 0 0 1 2 -2 Z", round: true },
  /** Alerts: a bell. */
  bell: { d: "M18 8 A6 6 0 0 0 6 8 C6 15 3 17 3 17 H21 C21 17 18 15 18 8 Z M10 21 A2 2 0 0 0 14 21", round: true },

  // — controls ——————————————————————————————————————————————————
  /** Search: magnifier, handle to the lower right. */
  search: { d: "M11 4 a7 7 0 1 0 0 14 a7 7 0 0 0 0 -14 Z M16 16 L21 21" },
  /** List: the counterpart to `grid` in the binder view toggle. */
  list: { d: "M4 6 H20 M4 12 H20 M4 18 H20" },
  /** Plus: add a card, add a binder, add a lot. */
  plus: { d: "M12 5 V19 M5 12 H19" },
  /** Minus: the quantity stepper's other half. */
  minus: { d: "M5 12 H19" },
  /** Close: dismiss a dialog or clear a field. */
  close: { d: "M6 6 L18 18 M18 6 L6 18" },
  /** Chevron down: a dropdown that opens downward — the binder switcher. */
  "chevron-down": { d: "M6 9 L12 15 L18 9" },
  /** Chevron right: a disclosure that expands in place — a holding into its lots. */
  "chevron-right": { d: "M9 6 L15 12 L9 18" },
  /** Back: the return link at the top of a detail screen. */
  "arrow-left": { d: "M19 12 H5 M11 6 L5 12 L11 18" },

  // — status ————————————————————————————————————————————————————
  /** Legal / owned / satisfied. */
  check: { d: "M4 12.5 L9.5 18 L20 6", round: true },
  /** A rule the deck breaks, or a value that needs attention. */
  warning: { d: "M12 3 L22 20 H2 Z M12 10 V14.5 M12 17.6 v0.2", round: true },

  // — theme ——————————————————————————————————————————————————————
  /** Light mode. */
  sun: { d: "M12 8 a4 4 0 1 0 0 8 a4 4 0 0 0 0 -8 Z M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" },
  /** Dark mode. */
  moon: { d: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z", round: true },
} as const;

export type IconName = keyof typeof ICONS;

/** Widens one entry out of the const map so `round` reads as optional rather than absent. */
const glyph = (name: IconName): { d: string; round?: boolean } => ICONS[name];

type Props = Omit<SVGProps<SVGSVGElement>, "name" | "width" | "height"> & {
  name: IconName;
  /** Defaults to `sm` (16px) — the size that sits inline with text. */
  size?: IconSize;
  /** Give the glyph an accessible name. Omit it and the icon is hidden from assistive tech, which
   *  is correct whenever a visible label or an `aria-label` on the control already says the same. */
  title?: string;
};

export default function Icon({ name, size = "sm", title, className, ...rest }: Props) {
  const { d, round } = glyph(name);
  const px = SIZES[size];
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin={round ? "round" : "miter"}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
