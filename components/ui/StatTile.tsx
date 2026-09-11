import { cn } from "./cn";

type Props = { label: string; value: string; tone?: "default" | "gain" | "loss"; className?: string };

export default function StatTile({ label, value, tone = "default", className }: Props) {
  return (
    <div className={cn("flex flex-col gap-0.5 rounded-tile border border-hairline bg-surface px-3.5 py-3", className)}>
      <span className="text-caption text-dim">{label}</span>
      <span className={cn("num text-stat font-semibold", tone === "gain" && "text-gain", tone === "loss" && "text-accent")}>{value}</span>
    </div>
  );
}
