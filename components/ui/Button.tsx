import type { ComponentProps } from "react";
import Link from "next/link";
import { cn } from "./cn";

type Variant = "primary" | "secondary";

/** Discriminated on `href`: with it you get a `next/link` wearing the button skin, without it a
 *  real `<button>`. Never both, so a link can't be handed `type`/`form` and vice versa. */
type Props =
  | (ComponentProps<"button"> & { variant?: Variant; href?: never })
  | (Omit<ComponentProps<"a">, "href"> & {
      variant?: Variant;
      href: string;
      /** Links can't be disabled, so this only sets `aria-disabled` (plus the dimmed skin). */
      disabled?: boolean;
    });

const base =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold min-h-11 transition-opacity disabled:opacity-50";
const skin = (variant: Variant) =>
  variant === "primary"
    ? "bg-chip text-chip-ink hover:opacity-90"
    : "border border-hairline bg-surface text-ink hover:bg-hairline-soft";

// `variant` is ours, not an HTML attribute, and `className` is folded into the computed classes:
// neither may reach the DOM node. `drop` removes the ones a given element can't take either.
const domProps = (props: Props, drop: readonly string[] = []) =>
  Object.fromEntries(
    Object.entries(props).filter(([k]) => k !== "variant" && k !== "className" && !drop.includes(k))
  );

export default function Button(props: Props) {
  const classes = cn(base, skin(props.variant ?? "primary"), props.className);

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
