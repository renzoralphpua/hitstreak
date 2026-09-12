"use client";
// components/ui/LineChart.tsx
import { useRef, useState } from "react";
import type { Point } from "@/lib/ranges";
import { formatMoney } from "@/lib/format";
import { useDisplay } from "@/components/currency/CurrencyProvider";
import { cn } from "./cn";

type Props = {
  points: Point[];
  from: string;
  to: string;
  height?: number;
  label: string;
  className?: string;
  /** A second, muted line under the first — the cost basis beneath the value, so the GAP between
   *  them is the gain at every point in the window. Both series share one y-scale, or the gap would
   *  be a drawing rather than a fact. Drawn without an end dot: it is the reference the main line is
   *  read against, not a value in its own right. */
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

const isValued = (p: Point): p is { date: string; value: number } => p.value != null && Number.isFinite(p.value);

/**
 * One series, drawn as straight segments between points.
 *
 * This was a STEP path, on the argument that prices are stored write-on-change so a value literally
 * holds until the next one. True, but with six months of daily history that renders as a staircase
 * of hundreds of tiny risers — and since TCGplayer's market price moves most days, the horizontal
 * runs it drew were mostly one day wide anyway. The diagonal says the same thing and can be read.
 *
 * The last value still carries FLAT to the right edge, which is not cosmetic: there is no data after
 * it, and sloping into the future would invent a trend.
 */
function linePath(points: Point[], X: (d: string) => number, Y: (v: number) => number, w: number): string {
  let d = "";
  let pen = false;
  let lastY: string | null = null;
  for (const p of points) {
    if (!isValued(p)) { pen = false; continue; } // a gap in the data breaks the line rather than bridging it
    const x = X(p.date).toFixed(1);
    const y = Y(p.value).toFixed(1);
    d += pen ? ` L${x} ${y}` : `${d ? " " : ""}M${x} ${y}`;
    pen = true;
    lastY = y;
  }
  return pen && lastY != null ? `${d} L${w} ${lastY}` : d;
}

export default function LineChart({ points, from, to, height = 150, label, className, baseline, seriesLabel, baselineLabel }: Props) {
  const display = useDisplay();
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; ratio: number } | null>(null);

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

  const d = linePath(points, X, Y, W);
  const baseD = baseline?.length ? linePath(baseline, X, Y, W) : "";
  const last = valued[valued.length - 1];
  const fmt = x1 - x0 > 180 ? long : short;

  /** The valued point nearest the pointer. Nearest, not "the one to the left": at six months per
   *  800 units a single pixel spans several days, and snapping backwards feels like a lag. */
  function track(clientX: number) {
    const box = wrap.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const ratio = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
    const target = x0 + ratio * (x1 - x0);
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < valued.length; i++) {
      const gap = Math.abs(dayIndex(valued[i].date) - target);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    setHover({ i: best, ratio });
  }

  const at = hover ? valued[hover.i] : null;
  const atX = at ? X(at.date) : 0;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        ref={wrap}
        className="relative"
        onPointerMove={(e) => track(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          // INK, not accent. Accent is this system's LOSS colour (see PriceDelta), and painting the
          // value series in it told every reader their collection was down — including one up 92%.
          // A line that rises and falls within the window has no single verdict to colour it with.
          className="block w-full text-ink"
          style={{ height }}
        >
          <line x1="0" y1={height - 1} x2={W} y2={height - 1} stroke="var(--hairline)" strokeWidth="1" />
          {baseD && (
            <path d={baseD} fill="none" stroke="var(--dim)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          )}
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {at && (
            <line x1={atX} y1="0" x2={atX} y2={height} stroke="var(--hairline-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {/* Both dots are HTML, not svg circles: the svg is stretched horizontally by
            preserveAspectRatio="none", which would squash a circle into an ellipse. */}
        <span
          aria-hidden
          className="absolute right-0 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full bg-ink"
          style={{ top: Y(last.value) }}
        />
        {at && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink"
              style={{ left: `${(atX / W) * 100}%`, top: Y(at.value) }}
            />
            <div
              // aria-hidden: the chart already carries a text label, and a tooltip that follows a
              // pointer is not reachable without one.
              aria-hidden
              className="pointer-events-none absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-tile border border-hairline bg-surface px-2 py-1 text-caption shadow-tile"
              style={{
                left: `${(atX / W) * 100}%`,
                // Clamped at the edges so the readout never hangs off the chart: it sits centred in
                // the middle, and tucks against whichever side it has reached.
                transform: `translateX(${atX / W < 0.12 ? "0" : atX / W > 0.88 ? "-100%" : "-50%"})`,
              }}
            >
              <span className="num font-semibold text-ink">{formatMoney(at.value, { display })}</span>
              <span className="text-dim"> · {long.format(new Date(`${at.date}T00:00:00Z`))}</span>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between text-caption text-dim">
        {baseD ? (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3 rounded-full bg-ink" />
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
