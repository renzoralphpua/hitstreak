import type { ReactNode } from "react";
import Icon from "./Icon";

/**
 * A foldable section heading.
 *
 * The second instance of this shape — /sets folds by era, a collection folds singles from sealed —
 * so the chevron, the hit area and the `aria-expanded` wiring live in one place rather than being
 * retyped with slightly different markup each time.
 *
 * The whole heading is the button. A chevron alone is a small target, and the title is the thing a
 * reader is already pointing at.
 */
export default function FoldSection({
  title, caption, open, onToggle, children,
}: {
  title: string;
  /** Dimmed after the title — a count, a completion figure. Stays visible when folded, which is
   *  most of the point: a closed section should still say what it is hiding. */
  caption?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-2 border-b border-hairline pb-1.5 text-left text-ink hover:text-accent"
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size="md" />
        <span className="font-display text-title">{title}</span>
        {/* An explicit space: adjacent spans concatenate with none, so the accessible name came out
            as "Singles3" — one word, read as one word. `gap` is layout and contributes no text. */}
        {caption != null && (
          <>
            {" "}
            <span className="num text-caption text-dim">{caption}</span>
          </>
        )}
      </button>
      {open && children}
    </div>
  );
}
