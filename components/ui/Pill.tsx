import type { ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "./cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; href?: string };

const shape = "rounded-full px-3 py-1.5 text-[13px] leading-none min-h-8 transition-colors";
const skin = (selected: boolean) =>
  selected ? "bg-chip text-chip-ink font-medium" : "border border-hairline text-muted hover:text-ink";

/** Filter / tab chip. Selected = inverted ink chip (docs/design/README.md "Selected state").
 *  With `href` it is a `Link` instead of a button (navigational pills, e.g. the game row on /sets)
 *  and the selected one carries `aria-current="page"`. */
export default function Pill({ selected = false, className, href, children, ...rest }: Props) {
  const classes = cn(shape, skin(selected), className);
  if (href !== undefined) {
    return (
      <Link
        href={href}
        aria-current={selected ? "page" : undefined}
        aria-label={rest["aria-label"]}
        className={classes}
      >
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
