import type { ComponentProps } from "react";
import { cn } from "./cn";

// The one place the text-field skin is defined: auth, binder names, quantity and price all use it.
// Height is not part of it — `Input` is a 44px row, `Textarea` (which imports this) is a box — so the
// two share one skin rather than keeping two copies of it.
export const field =
  "w-full rounded-tile border border-hairline bg-surface px-3.5 text-ink focus:border-ink placeholder:text-dim";

type Props = ComponentProps<"input"> & { label?: string };

/** A plain `<input>` carrying the shared field classes; `className` is merged last so a screen can
 *  still constrain the width. With `label` it wraps itself in the standard stacked label. */
export default function Input({ label, className, ...rest }: Props) {
  const input = <input className={cn(field, "h-11", className)} {...rest} />;
  if (label === undefined) return input;
  return (
    <label className="flex flex-col gap-1 text-caption text-muted">
      {label}
      {input}
    </label>
  );
}
