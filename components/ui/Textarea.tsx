import type { ComponentProps } from "react";
import { cn } from "./cn";
import { field } from "./Input";

type Props = ComponentProps<"textarea"> & { label?: string };

/** `Input`'s field, several lines tall: the same shared skin plus vertical padding and a floor on the
 *  height. `className` merges last so a screen can size it. With `label` it wraps itself in the
 *  standard stacked label, exactly as `Input` does. */
export default function Textarea({ label, className, rows = 8, ...rest }: Props) {
  const box = <textarea rows={rows} className={cn(field, "min-h-32 resize-y py-2.5 leading-6", className)} {...rest} />;
  if (label === undefined) return box;
  return (
    <label className="flex flex-col gap-1 text-caption text-muted">
      {label}
      {box}
    </label>
  );
}
