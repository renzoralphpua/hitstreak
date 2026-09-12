// @vitest-environment jsdom
// The modal shell. The case that matters most is the one that shipped broken: typing in a dialog
// must not steal focus from the field being typed into.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Dialog from "@/components/ui/Dialog";

describe("Dialog", () => {
  it("renders nothing at all when closed", () => {
    render(<Dialog open={false} onClose={() => {}} title="New collection"><p>body</p></Dialog>);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Not merely hidden: the content's effects must not run behind a closed dialog.
    expect(screen.queryByText("body")).toBeNull();
  });

  it("names itself after its heading", () => {
    render(<Dialog open onClose={() => {}} title="New collection"><p>body</p></Dialog>);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("New collection");
  });

  it("KEEPS FOCUS IN A FIELD WHILE TYPING", async () => {
    // The regression, reproduced the way it happens: a BUTTON opens the dialog, so the effect
    // captures that button as the opener. onClose is an inline arrow — a new function every render —
    // so depending on it re-ran the effect on every keystroke, and the cleanup's opener.focus() put
    // the cursor back on the Create button. Naming a collection lost focus after each character.
    function Host() {
      const [open, setOpen] = useState(false);
      const [name, setName] = useState("");
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Create</button>
          <Dialog open={open} onClose={() => setOpen(false)} title="New collection">
            <input aria-label="Collection name" value={name} onChange={(e) => setName(e.target.value)} />
          </Dialog>
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Create" });
    opener.focus();
    fireEvent.click(opener);

    const input = screen.getByLabelText("Collection name") as HTMLInputElement;
    input.focus();
    for (const ch of ["M", "a", "i", "n"]) {
      fireEvent.change(input, { target: { value: input.value + ch } });
      expect(document.activeElement, `focus lost after "${ch}"`).toBe(input);
    }
    expect(input.value).toBe("Main");
  });

  it("does not steal focus from content that autofocused itself", () => {
    render(
      <Dialog open onClose={() => {}} title="New collection">
        <input aria-label="Collection name" autoFocus />
      </Dialog>
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Collection name"));
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="New collection"><p>body</p></Dialog>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls the LATEST onClose, not the one captured when it opened", () => {
    // The ref exists for this: skipping the dep must not freeze a stale handler.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Dialog open onClose={first} title="T"><p>body</p></Dialog>);
    rerender(<Dialog open onClose={second} title="T"><p>body</p></Dialog>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("closes on a click that starts on the scrim", () => {
    const onClose = vi.fn();
    const { container } = render(<Dialog open onClose={onClose} title="T"><p>body</p></Dialog>);
    fireEvent.mouseDown(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open for a drag that starts INSIDE the panel", () => {
    // Releasing outside after selecting text is a selection, not a dismissal.
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="T"><p>body</p></Dialog>);
    fireEvent.mouseDown(screen.getByText("body"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to whatever opened it", async () => {
    function Host({ open }: { open: boolean }) {
      return (
        <>
          <button type="button">opener</button>
          <Dialog open={open} onClose={() => {}} title="T"><p>body</p></Dialog>
        </>
      );
    }
    const { rerender } = render(<Host open={false} />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    rerender(<Host open />);
    rerender(<Host open={false} />);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
