import { cn } from "./cn";

export default function TierBadge({ tier, className }: { tier: number; className?: string }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide",
        tier === 1 ? "bg-gain text-chip-ink" : "bg-hairline text-ink",
        className
      )}
    >
      Tier {tier}
    </span>
  );
}
