"use client";
import type { ReactNode, ElementType } from "react";
import { cn } from "./cn";

/** `inverted` is the ink chip (docs/design/README.md "Selected state") — a triggered alert row.
 *  The `right` slot carries no colour of its own so it takes the row's, whichever tone. */
type Tone = "default" | "inverted";

type Props = {
  name: string;
  subtitle: string;
  imageUrl: string | null;
  right?: ReactNode;
  onClick?: () => void;
  className?: string;
  tone?: Tone;
};

export default function CardRow({ name, subtitle, imageUrl, right, onClick, className, tone = "default" }: Props) {
  const Wrapper: ElementType = onClick ? "button" : "div";
  const inverted = tone === "inverted";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-panel border px-2.5 py-2 text-left",
        inverted ? "border-chip bg-chip text-chip-ink" : "border-hairline bg-surface",
        className
      )}
    >
      <div
        className="h-14 w-10 shrink-0 rounded-md border border-hairline bg-hairline-soft"
        style={imageUrl ? { backgroundImage: `url(${imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        aria-hidden
      />
      <div className="flex min-w-0 grow flex-col">
        <span className={cn("truncate font-semibold", inverted ? "text-chip-ink" : "text-ink")}>{name}</span>
        <span className={cn("truncate text-caption", inverted ? "text-chip-ink/70" : "text-dim")}>{subtitle}</span>
      </div>
      {/* Same reason as CardTile's price: a row inside a Link would inherit the accent colour for
          anything the caller did not colour itself. Callers that DO set one still win. */}
      {right && <div className={cn("num flex shrink-0 flex-col items-end", inverted ? "text-chip-ink" : "text-ink")}>{right}</div>}
    </Wrapper>
  );
}
