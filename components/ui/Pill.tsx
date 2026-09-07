import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean };

/** Filter / tab chip. Selected = inverted ink chip (docs/design/README.md "Selected state"). */
export default function Pill({ selected = false, className, ...rest }: Props) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "rounded-full px-3 py-1.5 text-[13px] leading-none min-h-8 transition-colors",
        selected ? "bg-chip text-chip-ink font-medium" : "border border-hairline text-muted hover:text-ink",
        className
      )}
      {...rest}
    />
  );
}
