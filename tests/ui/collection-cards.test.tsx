// @vitest-environment jsdom
// What you see inside a collection: the heading that stopped claiming everything is a card, and the
// optional singles/sealed grouping.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/(app)/collections/actions", () => ({
  updateItemAction: vi.fn(), removeItemAction: vi.fn(), addItemAction: vi.fn(),
}));

import CollectionCards from "@/app/(app)/collections/[slug]/CollectionCards";
import type { Holding } from "@/lib/collections";

const holding = (over: Partial<Holding> & { printingId: number }): Holding => ({
  cardId: over.printingId, cardName: `Card ${over.printingId}`, setName: "Prismatic Evolutions",
  number: "001/131", subtype: "Holofoil", imageUrl: null, condition: "NM",
  quantity: 1, market: 10, priceDate: "2026-09-07", value: 10, cost: 8, uncostedQuantity: 0, lots: [],
  ...over,
});

const singles = [
  holding({ printingId: 1, cardName: "Umbreon ex", number: "161/131", quantity: 2 }),
  holding({ printingId: 2, cardName: "Pikachu", number: "025/131" }),
];
const sealed = [
  holding({ printingId: 3, cardName: "Booster Bundle", number: null, quantity: 4 }),
];

const view = (holdings: Holding[] = [...singles, ...sealed]) =>
  render(<CollectionCards collectionId={7} href="/collections/main-binder" holdings={holdings} />);

beforeEach(() => {
  window.localStorage.clear();
});

/**
 * Turn grouping on, whatever it currently is.
 *
 * usePersisted keeps a MODULE-LEVEL cache (it has to: useSyncExternalStore compares snapshots by
 * Object.is), so localStorage.clear() does not reset it and the setting leaks between tests in this
 * file. A blind click therefore toggles OFF whatever the previous test left on.
 */
function ensureGrouped() {
  const pill = screen.getByRole("button", { name: "Group by type" });
  if (pill.getAttribute("aria-pressed") !== "true") fireEvent.click(pill);
}

describe("CollectionCards", () => {
  it("calls the section Items, not Cards — a collection holds sealed too", () => {
    view();
    expect(screen.getByRole("heading", { name: /Items/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Cards$/ })).toBeNull();
  });

  it("breaks the count down instead of saying 'sorted by value'", () => {
    view();
    // 3 singles (one held twice) and 4 sealed.
    expect(screen.getByText(/3 cards · 4 sealed/)).toBeInTheDocument();
  });

  it("says nothing about sealed when there is none", () => {
    view(singles);
    expect(screen.getByText(/3 cards/)).toBeInTheDocument();
    // Scoped to the caption: the grouping control's own label is not a claim about contents.
    expect(screen.getByText(/3 cards/).textContent).not.toMatch(/sealed/);
  });

  it("does not group by default", () => {
    // Asserted on a fresh module cache below; see ensureGrouped for why order matters here.
    view();
    expect(screen.getByRole("button", { name: "Group by type" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: /Singles/ })).toBeNull();
  });

  it("splits singles from sealed when asked, and folds each", () => {
    view();
    ensureGrouped();

    const singlesHead = screen.getByRole("button", { name: /Singles 3/ });
    const sealedHead = screen.getByRole("button", { name: /Sealed 4/ });
    expect(singlesHead).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Umbreon ex")).toBeInTheDocument();

    fireEvent.click(singlesHead);
    expect(singlesHead).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Umbreon ex")).toBeNull();
    // Folding one leaves the other alone, and the folded heading still says what it hides.
    expect(sealedHead).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Booster Bundle")).toBeInTheDocument();
  });

  it("omits a group that would be empty rather than heading nothing", () => {
    view(singles);
    ensureGrouped();
    expect(screen.getByRole("button", { name: /Singles 3/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sealed/ })).toBeNull();
  });

  it("filters across both groups", () => {
    view();
    ensureGrouped();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "bundle" } });
    expect(screen.queryByRole("button", { name: /Singles/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Sealed 4/ })).toBeInTheDocument();
  });
});
