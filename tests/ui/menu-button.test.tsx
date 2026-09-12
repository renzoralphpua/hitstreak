// @vitest-environment jsdom
// The overflow menu. Its whole reason to exist is that a tile is a link — so the two things that
// matter are that opening the menu does not navigate, and that choosing an item does not either.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MenuButton, { MenuItem } from "@/components/ui/MenuButton";

const rename = vi.fn();
const remove = vi.fn();
const navigate = vi.fn();

beforeEach(() => {
  rename.mockReset();
  remove.mockReset();
  navigate.mockReset();
});

// A menu sitting inside a clickable tile, which is exactly where it is used. The href is a
// fragment rather than a route so the Next lint rule does not ask for <Link> in a unit test.
const inTile = () => (
  <a href="#tile" onClick={navigate}>
    Main Binder
    <MenuButton label="Actions for Main Binder">
      <MenuItem onClick={rename}>Rename</MenuItem>
      <MenuItem tone="danger" onClick={remove}>Delete</MenuItem>
    </MenuButton>
  </a>
);

const trigger = () => screen.getByRole("button", { name: "Actions for Main Binder" });

describe("MenuButton", () => {
  it("stays shut until asked", () => {
    render(inTile());
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens without following the link it sits inside", () => {
    render(inTile());
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    // The tile's own click handler must not have fired — opening a menu is not navigation.
    expect(navigate).not.toHaveBeenCalled();
  });

  it("runs the item and closes, still without navigating", async () => {
    render(inTile());
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(rename).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("closes on Escape", async () => {
    render(inTile());
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(rename).not.toHaveBeenCalled();
  });

  it("closes when the pointer goes down outside it", async () => {
    render(
      <div>
        <button type="button">elsewhere</button>
        {inTile()}
      </div>
    );
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole("button", { name: "elsewhere" }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("stays open when the pointer goes down inside it", () => {
    render(inTile());
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("toggles shut on a second click of the trigger", async () => {
    render(inTile());
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("marks the destructive item rather than relying on its position", () => {
    render(inTile());
    fireEvent.click(trigger());
    const del = screen.getByRole("menuitem", { name: "Delete" });
    expect(del.className).toMatch(/text-accent/);
    expect(screen.getByRole("menuitem", { name: "Rename" }).className).not.toMatch(/text-accent/);
  });

  it("names the trigger after what it acts on", () => {
    render(inTile());
    // "More actions" on four tiles is four identical controls; the collection's name is the point.
    expect(trigger()).toHaveAccessibleName("Actions for Main Binder");
  });
});
