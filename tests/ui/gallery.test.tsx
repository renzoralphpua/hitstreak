// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/dev/ui", notFound: () => { throw new Error("NOT_FOUND"); } }));

import Gallery from "@/app/dev/ui/page";

describe("/dev/ui gallery", () => {
  it("renders a section for every primitive", () => {
    render(<Gallery />);
    for (const n of ["Button", "Pill", "Panel", "SectionHeading", "StatTile", "PriceDelta", "ProgressBar", "TierBadge", "ValidationList", "SearchField", "Input", "CardTile", "CardRow", "TopNav", "BottomTabBar", "ThemeToggle", "MoneyDisplay", "EmptyState"]) {
      expect(screen.getByRole("heading", { name: n })).toBeInTheDocument();
    }
  });
});
