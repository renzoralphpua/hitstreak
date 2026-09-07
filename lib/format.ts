// Money is REAL dollars, rounded at display (spec §5). Uses a true minus sign (U+2212).
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatMoney(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return opts.compact ? usdWhole.format(v) : usd.format(v);
}

export function splitMoney(v: number): { whole: string; cents: string } {
  const s = usd.format(v);
  const dot = s.lastIndexOf(".");
  return { whole: s.slice(0, dot), cents: s.slice(dot) };
}

export function formatPercent(ratio: number): string {
  const pct = (Math.abs(ratio) * 100).toFixed(1);
  if (pct === "0.0") return "0.0%";
  if (ratio > 0) return `+${pct}%`;
  if (ratio < 0) return `−${pct}%`;
  return `${pct}%`;
}

export function formatDelta(v: number): string {
  const abs = usd.format(Math.abs(v));
  return v < 0 ? `−${abs}` : `+${abs}`;
}
