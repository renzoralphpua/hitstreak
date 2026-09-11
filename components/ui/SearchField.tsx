"use client";
import Icon from "./Icon";
import { cn } from "./cn";

type Props = { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean };

export default function SearchField({ value, onChange, placeholder = "Search", className, autoFocus }: Props) {
  return (
    <label className={cn(
        "flex min-h-11 items-center gap-2.5 rounded-full bg-hairline-soft px-3.5 text-dim md:min-h-10",
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
        className
      )}>
      <Icon name="search" />
      <span className="sr-only">Search</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        // outline-none is correct here: the label wraps the whole pill and carries the ring
        // via focus-within, so a ring on the bare input would sit inside the pill.
        className="w-full bg-transparent text-ink placeholder:text-dim outline-none"
      />
    </label>
  );
}
