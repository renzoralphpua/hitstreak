import { cn } from "./cn";

type Props = { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean };

export default function SearchField({ value, onChange, placeholder = "Search", className, autoFocus }: Props) {
  return (
    <label className={cn("flex h-10 items-center gap-2.5 rounded-full bg-hairline-soft px-3.5 text-dim", className)}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5 L14 14" />
      </svg>
      <span className="sr-only">Search</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-transparent text-ink placeholder:text-dim outline-none"
      />
    </label>
  );
}
