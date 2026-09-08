import type { ComponentProps } from "react";
import Link from "next/link";
import { cn } from "./cn";

type Variant = "primary" | "secondary";
/** `md` is the 44px default everywhere; `sm` keeps 44px on phones and drops to the mockups'
 *  compact 32px control from `md` up (docs/design/README.md "Tap targets"). Use it instead of
 *  overriding `min-h-11` in `className` — `twMerge` would honour that at every breakpoint. */
type Size = "md" | "sm";

/** Discriminated on `href`: with it you get a `next/link` wearing the button skin, without it a
 *  real `<button>`. Never both, so a link can't be handed `type`/`form` and vice versa. */
type Props =
  | (ComponentProps<"button"> & { variant?: Variant; size?: Size; href?: never })
  | (Omit<ComponentProps<"a">, "href"> & {
      variant?: Variant;
      size?: Size;
      href: string;
      /** Links can't be disabled, so this only sets `aria-disabled` (plus the dimmed skin). */
      disabled?: boolean;
    });

const base =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold min-h-11 transition-opacity disabled:opacity-50";
// The `md:` variant carries a different modifier, so it survives beside `min-h-11` (like Pill's shape).
const small = "min-h-11 px-3 py-1 text-[13px] md:min-h-8";
const skin = (variant: Variant) =>
  variant === "primary"
    ? "bg-chip text-chip-ink hover:opacity-90"
    : "border border-hairline bg-surface text-ink hover:bg-hairline-soft";

// `variant` and `size` are ours, not HTML attributes, and `className` is folded into the computed
// classes: none may reach the DOM node. `drop` removes the ones a given element can't take either.
const domProps = (props: Props, drop: readonly string[] = []) =>
  Object.fromEntries(
    Object.entries(props).filter(
      ([k]) => k !== "variant" && k !== "size" && k !== "className" && !drop.includes(k)
    )
  );

export default function Button(props: Props) {
  const classes = cn(base, props.size === "sm" && small, skin(props.variant ?? "primary"), props.className);

  if (props.href !== undefined) {
    return (
      <Link
        {...(domProps(props, ["disabled"]) as ComponentProps<"a">)}
        href={props.href}
        aria-disabled={props.disabled || undefined}
        className={cn(classes, props.disabled && "opacity-50")}
      />
    );
  }

  return (
    <button
      {...(domProps(props) as ComponentProps<"button">)}
      type={props.type ?? "button"}
      className={classes}
    />
  );
}
