// components/ui/LineChart.tsx
import type { Point } from "@/lib/ranges";
import { cn } from "./cn";

type Props = { points: Point[]; from: string; to: string; height?: number; label: string; className?: string };

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
export default function LineChart({ points, from, to, height = 150, label, className }: Props) {
  const valued = points.filter((p): p is { date: string; value: number } => p.value != null && Number.isFinite(p.value));
  if (valued.length === 0) {
    return (
      <div className={cn("flex items-center justify-center text-caption text-dim", className)} style={{ height }}>
        Not enough history yet.
      </div>
    );
  }
  const x0 = dayIndex(from);
  const x1 = Math.max(dayIndex(to), x0 + 1);
  let lo = Math.min(...valued.map((p) => p.value));
  let hi = Math.max(...valued.map((p) => p.value));
  if (hi === lo) { lo -= 1; hi += 1; } // a flat line sits mid-height instead of dividing by zero
  const X = (date: string) => ((Math.min(Math.max(dayIndex(date), x0), x1) - x0) / (x1 - x0)) * W;
  const Y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (height - 2 * PAD_Y);

  let d = "";
  let pen = false;
  for (const p of points) {
    if (p.value == null || !Number.isFinite(p.value)) { pen = false; continue; }
    const x = X(p.date).toFixed(1), y = Y(p.value).toFixed(1);
    d += pen ? ` H${x} V${y}` : `${d ? " " : ""}M${x} ${y}`;
    pen = true;
  }
  if (pen) d += ` H${W}`;
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
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span
          aria-hidden
          className="absolute right-0 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full bg-accent"
          style={{ top: Y(last.value) }}
        />
      </div>
      <div className="flex justify-between text-caption text-dim">
        <span>{fmt.format(new Date(`${from}T00:00:00Z`))}</span>
        <span>{fmt.format(new Date(`${to}T00:00:00Z`))}</span>
      </div>
    </div>
  );
}
