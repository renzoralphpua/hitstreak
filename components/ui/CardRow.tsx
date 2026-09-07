"use client";
import type { ReactNode, ElementType } from "react";
import { cn } from "./cn";

type Props = { name: string; subtitle: string; imageUrl: string | null; right?: ReactNode; onClick?: () => void; className?: string };

export default function CardRow({ name, subtitle, imageUrl, right, onClick, className }: Props) {
  const Wrapper: ElementType = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn("flex w-full items-center gap-3 rounded-panel border border-hairline bg-surface px-2.5 py-2 text-left", className)}
    >
      <div
        className="h-14 w-10 shrink-0 rounded-md border border-hairline bg-hairline-soft"
        style={imageUrl ? { backgroundImage: `url(${imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        aria-hidden
      />
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate font-semibold text-ink">{name}</span>
        <span className="truncate text-xs text-dim">{subtitle}</span>
      </div>
      {right && <div className="num flex shrink-0 flex-col items-end">{right}</div>}
    </Wrapper>
  );
}
