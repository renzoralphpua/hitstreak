import { formatDelta, formatPercent } from "@/lib/format";
import { cn } from "./cn";

type Props = { amount: number | null | undefined; ratio?: number | null; caption?: string; className?: string };

/**
 * Signed money change: ▲ gain green, ▼ loss terracotta, and **no glyph at all** when the value has
 * not moved — dim text carries that on its own.
 *
 * The em dash is reserved for UNKNOWN and nothing else. It used to prefix the zero case too, which
 * made one mark mean both "we have no price for this" and "this is worth exactly what you paid" —
 * two facts that are never interchangeable, and the second of which is common once every figure
 * reads against cost basis (a quiet week, or anything bought at today’s price).
 */
export default function PriceDelta({ amount, ratio, caption, className }: Props) {
  if (amount == null || !Number.isFinite(amount)) return <span className={cn("text-dim", className)}>—</span>;
  if (amount === 0) {
    return (
      <span className={cn("num text-sm text-dim", className)}>
        $0.00
        {ratio != null && <> ({formatPercent(ratio)})</>}
        {caption && <span className="ml-1 font-normal text-dim">{caption}</span>}
      </span>
    );
  }
  const up = amount >= 0;
  return (
    <span className={cn("num text-sm font-medium", up ? "text-gain" : "text-accent", className)}>
      {up ? "▲" : "▼"} {formatDelta(amount)}
      {ratio != null && <> ({formatPercent(ratio)})</>}
      {caption && <span className="ml-1 font-normal text-dim">{caption}</span>}
    </span>
  );
}
