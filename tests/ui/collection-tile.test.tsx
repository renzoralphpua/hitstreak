// @vitest-environment jsdom
// The collection as a tile: value against cost, cards and sealed counted separately, and the three
// actions behind the overflow menu rather than as buttons along the bottom.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { refresh, remove } = vi.hoisted(() => ({ refresh: vi.fn(), remove: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/app/(app)/collections/actions", () => ({
  deleteCollectionAction: remove,
  createCollectionAction: vi.fn(),
  renameCollectionAction: vi.fn(),
  enableShareAction: vi.fn(),
  regenerateShareAction: vi.fn(),
  disableShareAction: vi.fn(),
}));

import CollectionTile from "@/app/(app)/collections/CollectionTile";
import type { CollectionSummary } from "@/lib/collections";

const collection = { id: 7, name: "Main Binder", slug: "main-binder", createdAt: "2026-09-01" };
const summary = (over: Partial<CollectionSummary> = {}): CollectionSummary => ({
  cards: 312, sealed: 4, value: 1840.5, cost: 1200, gain: 640.5, unpriced: 0, ...over,
});

const tile = (over: Partial<CollectionSummary> = {}, shareLink = null) =>
  render(<CollectionTile collection={collection} summary={summary(over)} shareLink={shareLink} />);

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Actions for Main Binder" }));

beforeEach(() => {
  refresh.mockReset();
  remove.mockReset();
  remove.mockResolvedValue({ ok: true });
});

describe("CollectionTile", () => {
  it("counts cards and sealed products separately", () => {
    tile();
    // "316 items" would hide that four of them are booster boxes, which is a different thing to own.
    expect(screen.getByText("312")).toBeInTheDocument();
    expect(screen.getByText(/cards/)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/sealed/)).toBeInTheDocument();
  });

  it("says nothing about unpriced copies when there are none", () => {
    tile();
    expect(screen.queryByText(/unpriced/)).toBeNull();
  });

  it("surfaces unpriced copies when they exist, because they inflate the gain", () => {
    tile({ unpriced: 9 });
    expect(screen.getByText(/9 unpriced/)).toBeInTheDocument();
  });

  it("reads value against what was paid, like the rest of the app", () => {
    tile();
    expect(screen.getByText(/vs\. paid/)).toBeInTheDocument();
    expect(screen.getByText(/paid \$1,200/)).toBeInTheDocument();
  });

  it("links the whole tile to the collection by its slug", () => {
    tile();
    expect(screen.getByRole("link", { name: "Main Binder" })).toHaveAttribute("href", "/collections/main-binder");
  });

  it("falls back to the id for a collection that has no slug yet", () => {
    render(<CollectionTile collection={{ ...collection, slug: null }} summary={summary()} shareLink={null} />);
    expect(screen.getByRole("link", { name: "Main Binder" })).toHaveAttribute("href", "/collections/7");
  });

  it("keeps rename, share and delete out of the tile until asked", () => {
    tile();
    for (const name of ["Rename", "Share", "Delete"]) {
      expect(screen.queryByRole("menuitem", { name }), name).toBeNull();
    }
    openMenu();
    for (const name of ["Rename", "Share", "Delete"]) {
      expect(screen.getByRole("menuitem", { name }), name).toBeInTheDocument();
    }
  });

  it("swaps the tile for the rename field, and back again", async () => {
    tile();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.getByLabelText("Collection name")).toHaveValue("Main Binder");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Main Binder" })).toBeInTheDocument());
  });

  it("confirms a delete with the item count before doing it", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    tile();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    // 312 cards + 4 sealed: the confirm counts everything that would go with it.
    expect(confirm).toHaveBeenCalledWith("Delete “Main Binder” and its 316 items?");
    await waitFor(() => expect(remove).toHaveBeenCalledWith(7));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    confirm.mockRestore();
  });

  it("does nothing when the confirm is dismissed", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    tile();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(remove).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("says so when the delete fails instead of looking like it worked", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    remove.mockResolvedValueOnce({ ok: false, error: "Collection not found" });
    tile();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Collection not found"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("opens sharing in a dialog rather than sending you to the collection page", async () => {
    tile();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Share “Main Binder”");
    expect(within(dialog).getByRole("button", { name: /Share this collection/ })).toBeInTheDocument();
  });

  it("closes the share dialog on Escape", async () => {
    tile();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
