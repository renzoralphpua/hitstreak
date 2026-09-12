"use client";
import type { ReactNode, ElementType } from "react";
import { cn } from "./cn";

type Props = {
  name: string;
  subtitle: string;
  price: string; // already formatted
  quantity: number; // 0 = missing
  imageUrl: string | null; // null → placeholder tint
  delta?: ReactNode; // e.g. <PriceDelta … />
  onClick?: () => void;
  className?: string;
  /** "multiple" hides the chip at a single copy. The set grid wants "always" — there the count is
   *  the point — but a collection is all-owned, so ×1 on every tile says nothing. */
  quantityDisplay?: "always" | "multiple";
};

/** Owned vs missing convention (docs/design/README.md): owned = solid tile + ×N chip; missing = dashed, dimmed. */
export default function CardTile({ name, subtitle, price, quantity, imageUrl, delta, onClick, className, quantityDisplay = "always" }: Props) {
  const owned = quantity > 0;
  const showQuantity = owned && (quantityDisplay === "always" || quantity > 1);
  const Wrapper: ElementType = onClick ? "button" : "div";
  return (
    <Wrapper type={onClick ? "button" : undefined} onClick={onClick} className={cn("flex flex-col gap-2.5 text-left", className)}>
      <div
        {...(onClick ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
        className={cn(
          "relative aspect-[5/7] w-full overflow-hidden rounded-tile border",
          owned ? "border-hairline bg-hairline-soft shadow-tile" : "border-dashed border-hairline bg-ground opacity-70"
        )}
        style={imageUrl ? { backgroundImage: `url(${imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {showQuantity && (
          <span className="num absolute right-1.5 top-1.5 rounded-full bg-chip px-1.5 py-0.5 text-micro font-semibold text-chip-ink">
            ×{quantity}
          </span>
        )}
      </div>
      <div className={cn("flex flex-col gap-0.5", !owned && "text-dim")}>
        <span className="font-semibold text-ink">{name}</span>
        <span className="text-caption text-dim">{subtitle}</span>
        <div className="flex items-baseline justify-between">
          {/* text-ink explicitly, never inherited: this tile is usually wrapped in a Link, and the
              base rule `a { color: var(--accent) }` would otherwise paint the price in the ACCENT —
              which is this system's loss colour. Every price in a collection read as a loss. */}
          <span className={cn("num font-semibold text-ink", !owned && "font-normal text-dim")}>{price}</span>
          {delta}
        </div>
      </div>
    </Wrapper>
  );
}
