import { formatDelta, formatPercent } from "@/lib/format";
import { cn } from "./cn";

type Props = { amount: number | null | undefined; ratio?: number | null; caption?: string; className?: string };

/** Signed money change with ▲/▼, gain green or terracotta for losses; em dash when unknown. */
export default function PriceDelta({ amount, ratio, caption, className }: Props) {
  if (amount == null || !Number.isFinite(amount)) return <span className={cn("text-dim", className)}>—</span>;
  const up = amount >= 0;
  return (
    <span className={cn("num text-sm font-medium", up ? "text-gain" : "text-accent", className)}>
      {up ? "▲" : "▼"} {formatDelta(amount)}
      {ratio != null && <> ({formatPercent(ratio)})</>}
      {caption && <span className="ml-1 font-normal text-dim">{caption}</span>}
    </span>
  );
}
