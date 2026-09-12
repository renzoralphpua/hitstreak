"use client";
import { formatDelta, formatMoney, formatPercent } from "@/lib/format";
import { useDisplay } from "@/components/currency/CurrencyProvider";
import { cn } from "./cn";

type Props = {
  amount: number | null | undefined;
  ratio?: number | null;
  caption?: string;
  className?: string;
  /** "percent" drops the arrow and the dollar figure and shows the ratio alone — for a grid tile,
   *  which has no room for both. The sign and the colour already say the direction, so the arrow
   *  would be the third copy of the same fact. Needs `ratio`; without one there is nothing to show. */
  format?: "full" | "percent";
};

/**
 * Signed money change: ▲ gain green, ▼ loss terracotta, and **no glyph at all** when the value has
 * not moved — dim text carries that on its own.
 *
 * The em dash is reserved for UNKNOWN and nothing else. It used to prefix the zero case too, which
 * made one mark mean both "we have no price for this" and "this is worth exactly what you paid" —
 * two facts that are never interchangeable, and the second of which is common once every figure
 * reads against cost basis (a quiet week, or anything bought at today’s price).
 */
export default function PriceDelta({ amount, ratio, caption, className, format = "full" }: Props) {
  const display = useDisplay();
  if (amount == null || !Number.isFinite(amount)) return <span className={cn("text-dim", className)}>—</span>;
  if (amount === 0) {
    return (
      <span className={cn("num text-base text-dim", className)}>
        {/* formatDelta, not a literal "$0.00": the zero branch was the one place that ignored the
            display currency and printed dollars at a reader looking at pesos. */}
        {formatMoney(0, { display })}
        {ratio != null && <> ({formatPercent(ratio)})</>}
        {caption && <span className="ml-1 font-normal text-dim">{caption}</span>}
      </span>
    );
  }
  const up = amount >= 0;
  if (format === "percent") {
    return ratio == null ? null : (
      <span className={cn("num text-caption font-medium", up ? "text-gain" : "text-accent", className)}>
        {formatPercent(ratio)}
      </span>
    );
  }
  return (
    <span className={cn("num text-base font-medium", up ? "text-gain" : "text-accent", className)}>
      {up ? "▲" : "▼"} {formatDelta(amount, display)}
      {ratio != null && <> ({formatPercent(ratio)})</>}
      {caption && <span className="ml-1 font-normal text-dim">{caption}</span>}
    </span>
  );
}
