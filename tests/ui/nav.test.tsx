// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pathname = { current: "/collections" };
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

import { TopNav, BottomTabBar } from "@/components/ui";
import ThemeToggle from "@/components/theme/ThemeToggle";

describe("TopNav", () => {
  it("renders the four sections and marks the active one", () => {
    render(<TopNav search={<input aria-label="Search" />} right={<span>avatar</span>} />);
    for (const n of ["Collection", "Sets", "Decks", "Alerts"]) expect(screen.getByRole("link", { name: n })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Collection" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Sets" })).not.toHaveAttribute("aria-current");
  });
});

describe("BottomTabBar", () => {
  it("marks the active tab by pathname prefix", () => {
    pathname.current = "/sets/604";
    render(<BottomTabBar />);
    expect(screen.getByRole("link", { name: "Sets" })).toHaveAttribute("aria-current", "page");
  });
});

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = "light";
  });
  it("flips data-theme and persists the choice", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /dark/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: /light/i }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
