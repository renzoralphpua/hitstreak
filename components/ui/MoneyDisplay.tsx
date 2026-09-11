import { splitMoney } from "@/lib/format";
import { cn } from "./cn";

/** The Collection money style: serif whole dollars, dim cents. */
export default function MoneyDisplay({ amount, size = "md", className }: { amount: number | null | undefined; size?: "md" | "lg"; className?: string }) {
  const sizeClass = size === "lg" ? "text-hero" : "text-price";
  if (amount == null || !Number.isFinite(amount)) return <span className={cn("font-display leading-none text-dim", sizeClass, className)}>—</span>;
  const { whole, cents } = splitMoney(amount);
  return (
    <span className={cn("num font-display leading-none tracking-tight text-ink", sizeClass, className)}>
      {whole}<span className="text-dim">{cents}</span>
    </span>
  );
}
