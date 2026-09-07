// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { create, rename, remove, refresh } = vi.hoisted(() => ({
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/app/(app)/portfolios/actions", () => ({
  createPortfolioAction: create,
  renamePortfolioAction: rename,
  deletePortfolioAction: remove,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import PortfolioForm, { RenameToggle } from "@/app/(app)/portfolios/PortfolioForm";
import DeletePortfolioButton from "@/app/(app)/portfolios/DeletePortfolioButton";

beforeEach(() => {
  create.mockReset().mockResolvedValue({ ok: true, data: { id: 1, name: "Main", createdAt: "x" } });
  rename.mockReset().mockResolvedValue({ ok: true });
  remove.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("PortfolioForm", () => {
  it("create mode submits the trimmed name, clears the input and refreshes", async () => {
    render(<PortfolioForm mode="create" />);
    const input = screen.getByLabelText("Binder name");
    fireEvent.change(input, { target: { value: "  Main Binder  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create binder" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("Main Binder"));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(refresh).toHaveBeenCalled();
  });

  it("rename mode prefills, submits (id, name) and calls onDone", async () => {
    const onDone = vi.fn();
    render(<PortfolioForm mode="rename" id={7} name="Old name" onDone={onDone} />);
    const input = screen.getByLabelText("Binder name");
    expect(input).toHaveValue("Old name");
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith(7, "New name"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it("Cancel closes without calling the action", () => {
    const onDone = vi.fn();
    render(<PortfolioForm mode="rename" id={7} name="Old name" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it("shows the action's error as an alert", async () => {
    create.mockResolvedValueOnce({ ok: false, error: "Portfolio name must be 1–80 characters" });
    render(<PortfolioForm mode="create" />);
    fireEvent.change(screen.getByLabelText("Binder name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create binder" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Portfolio name must be 1–80 characters"));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("RenameToggle", () => {
  it("swaps the Rename button for the rename form and back", async () => {
    render(<RenameToggle id={3} name="Main" />);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByLabelText("Binder name")).toHaveValue("Main");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument());
  });
});

describe("DeletePortfolioButton", () => {
  it("confirms with the card count, then deletes and refreshes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeletePortfolioButton id={5} name="Main" count={312} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith('Delete "Main" and its 312 cards?');
    await waitFor(() => expect(remove).toHaveBeenCalledWith(5));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    confirm.mockRestore();
  });

  it("does nothing when the confirm is dismissed", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DeletePortfolioButton id={5} name="Main" count={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
