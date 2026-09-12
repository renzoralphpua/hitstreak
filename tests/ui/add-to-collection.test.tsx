// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Collection } from "@/lib/collections";
import type { DialogCard } from "@/app/(app)/collections/[slug]/AddItemDialog";

// The dialog itself is covered by tests/ui/add-item-dialog.test.tsx; here we only care which
// collection the wrapper hands it.
vi.mock("@/app/(app)/collections/[slug]/AddItemDialog", () => ({
  default: ({ collectionId }: { collectionId: number }) => <div>Dialog:{collectionId}</div>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import AddToCollection from "@/app/(app)/cards/[id]/AddToCollection";

const collections: Collection[] = [
  { id: 2, name: "Main Collection", slug: "main-collection", createdAt: "2026-09-01" },
  { id: 5, name: "Trades", slug: "trades", createdAt: "2026-09-02" },
];

const card: DialogCard = {
  name: "Umbreon ex",
  subtitle: "Prismatic Evolutions · 161",
  imageUrl: null,
  printings: [{ printingId: 10, subtype: "Special Illustration Rare", market: 1465, priceDate: "2026-09-07" }],
};

describe("AddToCollection", () => {
  it("defaults the target to the first collection", () => {
    render(<AddToCollection collections={collections} card={card} />);
    expect(screen.getByRole("button", { name: "Main Collection" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Dialog:2/)).toBeInTheDocument();
  });

  it("choosing another collection pill changes the collection handed to the dialog", () => {
    render(<AddToCollection collections={collections} card={card} />);

    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    expect(screen.getByRole("button", { name: "Trades" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Dialog:5/)).toBeInTheDocument();
    expect(screen.queryByText(/Dialog:2/)).not.toBeInTheDocument();
  });

  it("without a collection it links to /collections and renders no dialog", () => {
    render(<AddToCollection collections={[]} card={card} />);
    expect(screen.getByRole("link", { name: "Create a collection first" })).toHaveAttribute("href", "/collections");
    expect(screen.queryByText(/^Dialog:/)).not.toBeInTheDocument();
  });
});
