// components/ui/RangePills.tsx
import { RANGES, RANGE_LABEL, type Range } from "@/lib/ranges"; // db-free on purpose: this reaches client bundles via components/ui
import { cn } from "./cn";
import Pill from "./Pill";

/** The 7D · 30D · 90D · 1Y · All row under a chart. Plain links (`?range=`), so the chart
 *  re-renders on the server and there is no client state to keep in sync. */
export default function RangePills({ current, hrefFor, className }: { current: Range; hrefFor: (r: Range) => string; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="group" aria-label="Chart range">
      {RANGES.map((r) => (
        <Pill key={r} href={hrefFor(r)} selected={r === current} scroll={false}>
          {RANGE_LABEL[r]}
        </Pill>
      ))}
    </div>
  );
}
