import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "./cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; href?: string; scroll?: boolean };

// 44px minimum on phones (thumb target), back to the compact 32px chip from md up.
// inline-flex + centring is load-bearing, not decoration: min-h-11 makes the box 44px for a thumb,
// and without it the label sits at the TOP of that box with the slack below, which reads as a
// lopsided chip — and on the selected (ink) pill, as a dark band under the text. Button already
// does this; Pill did not.
const shape =
  "inline-flex items-center justify-center rounded-full px-3 py-1.5 text-caption leading-none min-h-11 md:min-h-8 transition-colors";
const skin = (selected: boolean) =>
  selected ? "bg-chip text-chip-ink font-medium" : "border border-hairline text-muted hover:text-ink";

// Attributes only a <button> can take; the Link variant drops them and keeps everything else
// (aria-*, data-*, handlers, title…).
const BUTTON_ONLY = new Set([
  "type",
  "disabled",
  "value",
  "name",
  "form",
  "formAction",
  "formEncType",
  "formMethod",
  "formNoValidate",
  "formTarget",
  "popoverTarget",
  "popoverTargetAction",
]);

/** Filter / tab chip. Selected = inverted ink chip (docs/design/README.md "Selected state").
 *  With `href` it is a `Link` instead of a button (navigational pills, e.g. the game row on /sets)
 *  and the selected one carries `aria-current="page"`. `scroll={false}` keeps the page where it
 *  is — chart range pills sit mid-page. */
export default function Pill({ selected = false, className, href, scroll, children, ...rest }: Props) {
  const classes = cn(shape, skin(selected), className);
  if (href !== undefined) {
    const anchorProps = Object.fromEntries(
      Object.entries(rest).filter(([k]) => !BUTTON_ONLY.has(k))
    ) as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <Link {...anchorProps} href={href} scroll={scroll} aria-current={selected ? "page" : undefined} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" aria-pressed={selected} className={classes} {...rest}>
      {children}
    </button>
  );
}
