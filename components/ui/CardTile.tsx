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
};

/** Owned vs missing convention (docs/design/README.md): owned = solid tile + ×N chip; missing = dashed, dimmed. */
export default function CardTile({ name, subtitle, price, quantity, imageUrl, delta, onClick, className }: Props) {
  const owned = quantity > 0;
  const Wrapper: ElementType = onClick ? "button" : "div";
  return (
    <Wrapper type={onClick ? "button" : undefined} onClick={onClick} className={cn("flex flex-col gap-2.5 text-left", className)}>
      <div
        role="img"
        aria-label={name}
        className={cn(
          "relative aspect-[5/7] w-full overflow-hidden rounded-tile border",
          owned ? "border-hairline bg-hairline-soft shadow-tile" : "border-dashed border-hairline bg-ground opacity-70"
        )}
        style={imageUrl ? { backgroundImage: `url(${imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {owned && (
          <span className="num absolute right-1.5 top-1.5 rounded-full bg-chip px-1.5 py-0.5 text-[11px] font-semibold text-chip-ink">
            ×{quantity}
          </span>
        )}
      </div>
      <div className={cn("flex flex-col gap-0.5", !owned && "text-dim")}>
        <span className="font-semibold text-ink">{name}</span>
        <span className="text-xs text-dim">{subtitle}</span>
        <div className="flex items-baseline justify-between">
          <span className={cn("num font-semibold", !owned && "font-normal text-dim")}>{price}</span>
          {delta}
        </div>
      </div>
    </Wrapper>
  );
}
