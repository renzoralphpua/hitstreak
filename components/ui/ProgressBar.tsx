import { cn } from "./cn";

type Props = { value: number; label: string; tone?: "accent" | "gain" | "muted"; className?: string };

export default function ProgressBar({ value, label, tone = "accent", className }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-hairline-soft", className)}
    >
      <div
        className={cn("h-full", tone === "accent" && "bg-accent", tone === "gain" && "bg-gain", tone === "muted" && "bg-hairline")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
