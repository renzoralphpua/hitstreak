import { cn } from "./cn";

export type ValidationItem = { ok: boolean; text: string };

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8.5 L6.5 12 L13 4.5" />
    </svg>
  );
}
function Warn() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 1.5 L14.5 13.5 H1.5 Z" />
      <path d="M8 6 V9.5" />
      <circle cx="8" cy="11.8" r="0.5" fill="currentColor" />
    </svg>
  );
}

export default function ValidationList({ items, className }: { items: ValidationItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-2 text-[13px]", className)}>
      {items.map((it, i) => (
        <li key={i} data-ok={String(it.ok)} className={cn("flex items-start gap-2", it.ok ? "text-muted" : "text-ink")}>
          <span className={cn("mt-px shrink-0", it.ok ? "text-gain" : "text-accent")}>{it.ok ? <Check /> : <Warn />}</span>
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}
