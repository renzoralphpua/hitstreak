// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { create, rename, remove, refresh } = vi.hoisted(() => ({
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/app/(app)/collections/actions", () => ({
  createCollectionAction: create,
  renameCollectionAction: rename,
  deleteCollectionAction: remove,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import CollectionForm from "@/app/(app)/collections/CollectionForm";

beforeEach(() => {
  create.mockReset().mockResolvedValue({ ok: true, data: { id: 1, name: "Main", createdAt: "x" } });
  rename.mockReset().mockResolvedValue({ ok: true });
  remove.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("CollectionForm", () => {
  it("create mode submits the trimmed name, clears the input and refreshes", async () => {
    render(<CollectionForm mode="create" />);
    const input = screen.getByLabelText("Collection name");
    fireEvent.change(input, { target: { value: "  Main Collection  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("Main Collection"));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(refresh).toHaveBeenCalled();
  });

  it("rename mode prefills, submits (id, name) and calls onDone", async () => {
    const onDone = vi.fn();
    render(<CollectionForm mode="rename" id={7} name="Old name" onDone={onDone} />);
    const input = screen.getByLabelText("Collection name");
    expect(input).toHaveValue("Old name");
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith(7, "New name"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it("Cancel closes without calling the action", () => {
    const onDone = vi.fn();
    render(<CollectionForm mode="rename" id={7} name="Old name" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it("shows the action's error as an alert", async () => {
    create.mockResolvedValueOnce({ ok: false, error: "Collection name must be 1–80 characters" });
    render(<CollectionForm mode="create" />);
    fireEvent.change(screen.getByLabelText("Collection name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Collection name must be 1–80 characters"));
    expect(refresh).not.toHaveBeenCalled();
  });
});
