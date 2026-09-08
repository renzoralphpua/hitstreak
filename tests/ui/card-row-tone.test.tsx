// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardRow } from "@/components/ui";

describe("CardRow tone", () => {
  it("is a surface row by default", () => {
    const { container } = render(<CardRow name="Umbreon ex" subtitle="Prismatic Evolutions · 161/131" imageUrl={null} right={<span>$1,465.00</span>} />);
    const row = container.firstElementChild!;
    expect(row).toHaveClass("bg-surface");
    expect(row).not.toHaveClass("bg-chip");
    expect(screen.getByText("Umbreon ex")).toHaveClass("text-ink");
  });

  it("inverts to the ink chip for a triggered alert row, and the right slot inherits the colour", () => {
    const { container } = render(
      <CardRow tone="inverted" name="Umbreon ex" subtitle="Prismatic Evolutions · 161/131" imageUrl={null} right={<span>$1,465.00</span>} />
    );
    const row = container.firstElementChild!;
    expect(row).toHaveClass("bg-chip", "text-chip-ink", "border-chip");
    expect(row).not.toHaveClass("bg-surface");
    expect(screen.getByText("Umbreon ex")).toHaveClass("text-chip-ink");
    expect(screen.getByText("Prismatic Evolutions · 161/131")).toHaveClass("text-chip-ink/70");
    // The right slot carries no colour class of its own: it takes the row's chip ink.
    expect(screen.getByText("$1,465.00").parentElement).not.toHaveClass("text-ink");
  });

  it("stays inverted when it is a clickable button too", () => {
    render(<CardRow tone="inverted" name="Shanks" subtitle="Two Legends · OP08-118" imageUrl={null} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: /Shanks/ })).toHaveClass("bg-chip");
  });
});
