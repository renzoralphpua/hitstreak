// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Portfolio } from "@/lib/portfolios";
import type { DialogCard } from "@/app/(app)/portfolios/[id]/AddItemDialog";

// The dialog itself is covered by tests/ui/add-item-dialog.test.tsx; here we only care which
// portfolio the wrapper hands it.
vi.mock("@/app/(app)/portfolios/[id]/AddItemDialog", () => ({
  default: ({ portfolioId }: { portfolioId: number }) => <div>Dialog:{portfolioId}</div>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import AddToBinder from "@/app/(app)/cards/[id]/AddToBinder";

const binders: Portfolio[] = [
  { id: 2, name: "Main Binder", createdAt: "2026-09-01" },
  { id: 5, name: "Trades", createdAt: "2026-09-02" },
];

const card: DialogCard = {
  name: "Umbreon ex",
  subtitle: "Prismatic Evolutions · 161",
  imageUrl: null,
  printings: [{ printingId: 10, subtype: "Special Illustration Rare", market: 1465, priceDate: "2026-09-07" }],
};

describe("AddToBinder", () => {
  it("defaults the target to the first binder", () => {
    render(<AddToBinder portfolios={binders} card={card} />);
    expect(screen.getByRole("button", { name: "Main Binder" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Dialog:2/)).toBeInTheDocument();
  });

  it("choosing another binder pill changes the portfolio handed to the dialog", () => {
    render(<AddToBinder portfolios={binders} card={card} />);

    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    expect(screen.getByRole("button", { name: "Trades" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Dialog:5/)).toBeInTheDocument();
    expect(screen.queryByText(/Dialog:2/)).not.toBeInTheDocument();
  });

  it("without a binder it links to /portfolios and renders no dialog", () => {
    render(<AddToBinder portfolios={[]} card={card} />);
    expect(screen.getByRole("link", { name: "Create a binder first" })).toHaveAttribute("href", "/portfolios");
    expect(screen.queryByText(/^Dialog:/)).not.toBeInTheDocument();
  });
});
