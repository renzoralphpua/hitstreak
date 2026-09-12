import type { ReactNode } from "react";
import BackLink, { type Back } from "./BackLink";
import { cn } from "./cn";

type Props = {
  title: string;
  caption?: string;
  trailing?: ReactNode;
  /** Renders the way back as an arrow on the title's line instead of a row above it. */
  back?: Back;
  className?: string;
  as?: "h1" | "h2" | "h3";
};

export default function SectionHeading({ title, caption, trailing, back, className, as: Tag = "h2" }: Props) {
  return (
    // flex-wrap, not a per-page override: a 26px title plus a caption plus two `trailing` buttons
    // (/decks) does not fit 390px, and every caller wants the same answer.
    <div className={cn("flex flex-wrap items-baseline gap-3", className)}>
      {/* self-center, not baseline: the arrow is a 32px box, and its baseline is its bottom edge. */}
      {back && <BackLink {...back} className="self-center" />}
      <Tag className="font-display text-section leading-none text-ink">{title}</Tag>
      {caption && <span className="text-caption text-dim">{caption}</span>}
      {trailing && <div className="ml-auto flex items-center gap-3 text-caption">{trailing}</div>}
    </div>
  );
}
