import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

export default function Button({ variant = "primary", className, type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold min-h-11 transition-opacity disabled:opacity-50",
        variant === "primary" ? "bg-chip text-chip-ink hover:opacity-90" : "border border-hairline bg-surface text-ink hover:bg-hairline-soft",
        className
      )}
      {...rest}
    />
  );
}
