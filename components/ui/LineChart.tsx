// components/ui/LineChart.tsx
import type { Point } from "@/lib/ranges";
import { cn } from "./cn";

type Props = {
  points: Point[];
  from: string;
  to: string;
  height?: number;
  label: string;
  className?: string;
  /** A second, muted step line under the first — the cost basis beneath the value, so the GAP
   *  between them is the gain at every point in the window. Both series share one y-scale, or the
   *  gap would be a drawing rather than a fact. Drawn without an end dot: it is the reference the
   *  main line is read against, not a value in its own right. */
  baseline?: Point[];
  /** Names the two lines under the chart. Omitted with no `baseline` — one line needs no legend. */
  seriesLabel?: string;
  baselineLabel?: string;
};

const W = 800; // viewBox width; the svg stretches to its container (preserveAspectRatio="none")
const PAD_Y = 6;
const DAY_MS = 86_400_000;
const dayIndex = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const long = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Step line over a date range. Each value holds until the next point (the data is write-on-change),
 *  the last value is carried to the right edge, and a null value breaks the line. Stroke colour is
 *  `currentColor` (accent) and the baseline is the hairline token, so dark mode needs nothing extra.
 *  The end dot is an HTML element, not an svg circle: the svg is stretched horizontally, which would
 *  turn a circle into an ellipse. */
const isValued = (p: Point): p is { date: string; value: number } => p.value != null && Number.isFinite(p.value);

/** One series as a step path: each value holds until the next point, and the last carries right. */
function stepPath(points: Point[], X: (d: string) => number, Y: (v: number) => number, W: number): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!isValued(p)) { pen = false; continue; }
    const x = X(p.date).toFixed(1), y = Y(p.value).toFixed(1);
    d += pen ? ` H${x} V${y}` : `${d ? " " : ""}M${x} ${y}`;
    pen = true;
  }
  return pen ? `${d} H${W}` : d;
}

export default function LineChart({ points, from, to, height = 150, label, className, baseline, seriesLabel, baselineLabel }: Props) {
  const valued = points.filter(isValued);
  if (valued.length === 0) {
    return (
      <div className={cn("flex items-center justify-center text-caption text-dim", className)} style={{ height }}>
        Not enough history yet.
      </div>
    );
  }
  const x0 = dayIndex(from);
  const x1 = Math.max(dayIndex(to), x0 + 1);
  // Both series are scaled together so the distance between them reads as money, not as layout.
  const scaleOver = [...valued, ...(baseline ?? []).filter(isValued)];
  let lo = Math.min(...scaleOver.map((p) => p.value));
  let hi = Math.max(...scaleOver.map((p) => p.value));
  if (hi === lo) { lo -= 1; hi += 1; } // a flat line sits mid-height instead of dividing by zero
  const X = (date: string) => ((Math.min(Math.max(dayIndex(date), x0), x1) - x0) / (x1 - x0)) * W;
  const Y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (height - 2 * PAD_Y);

  const d = stepPath(points, X, Y, W);
  const baseD = baseline?.length ? stepPath(baseline, X, Y, W) : "";
  const last = valued[valued.length - 1];
  const fmt = x1 - x0 > 180 ? long : short;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative">
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="block w-full text-accent"
          style={{ height }}
        >
          <line x1="0" y1={height - 1} x2={W} y2={height - 1} stroke="var(--hairline)" strokeWidth="1" />
          {baseD && (
            <path d={baseD} fill="none" stroke="var(--dim)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          )}
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span
          aria-hidden
          className="absolute right-0 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full bg-accent"
          style={{ top: Y(last.value) }}
        />
      </div>
      <div className="flex items-center justify-between text-caption text-dim">
        {baseD ? (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3 rounded-full bg-accent" />
              {seriesLabel ?? "Value"}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-px w-3 rounded-full bg-dim" />
              {baselineLabel ?? "Paid"}
            </span>
          </div>
        ) : (
          <span>{fmt.format(new Date(`${from}T00:00:00Z`))}</span>
        )}
        <span>
          {baseD && `${fmt.format(new Date(`${from}T00:00:00Z`))} · `}
          {fmt.format(new Date(`${to}T00:00:00Z`))}
        </span>
      </div>
    </div>
  );
}
