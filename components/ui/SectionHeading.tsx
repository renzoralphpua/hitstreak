import type { ReactNode } from "react";
import { cn } from "./cn";

type Props = { title: string; caption?: string; trailing?: ReactNode; className?: string; as?: "h1" | "h2" | "h3" };

export default function SectionHeading({ title, caption, trailing, className, as: Tag = "h2" }: Props) {
  return (
    <div className={cn("flex items-baseline gap-3", className)}>
      <Tag className="font-display text-[26px] leading-none text-ink">{title}</Tag>
      {caption && <span className="text-[13px] text-dim">{caption}</span>}
      {trailing && <div className="ml-auto flex items-center gap-3 text-[13px]">{trailing}</div>}
    </div>
  );
}
