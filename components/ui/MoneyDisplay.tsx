"use client";
import { splitMoney } from "@/lib/format";
import { useDisplay } from "@/components/currency/CurrencyProvider";
import { cn } from "./cn";

/** The Collection money style: serif whole dollars, dim cents. */
export default function MoneyDisplay({ amount, size = "md", className }: { amount: number | null | undefined; size?: "md" | "lg"; className?: string }) {
  // Reads the display itself: this is rendered from ~20 places and threading a currency through
  // every one of them would put the same prop in every money-adjacent component signature.
  const display = useDisplay();
  const sizeClass = size === "lg" ? "text-hero" : "text-price";
  if (amount == null || !Number.isFinite(amount)) return <span className={cn("font-display leading-none text-dim", sizeClass, className)}>—</span>;
  const { whole, cents, rest } = splitMoney(amount, display);
  return (
    <span className={cn("num font-display leading-none tracking-tight text-ink", sizeClass, className)}>
      {/* `rest` is the trailing symbol in locales that put it after the number (de-DE: 1.262,86 €).
          It must not be dimmed along with the cents. */}
      {whole}{cents && <span className="text-dim">{cents}</span>}{rest}
    </span>
  );
}
