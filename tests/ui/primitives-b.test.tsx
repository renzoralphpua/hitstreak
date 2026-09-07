// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TierBadge, ValidationList, SearchField, CardTile, CardRow } from "@/components/ui";

describe("TierBadge", () => {
  it("renders 'Tier N' with tier 1 emphasized", () => {
    render(<TierBadge tier={1} />);
    expect(screen.getByText("Tier 1").className).toMatch(/bg-gain/);
    render(<TierBadge tier={2} />);
    expect(screen.getByText("Tier 2").className).toMatch(/bg-hairline/);
  });
});

describe("ValidationList", () => {
  it("lists errors and passes with distinct markers", () => {
    render(
      <ValidationList
        items={[
          { ok: false, text: "61 cards — a Standard deck must have exactly 60." },
          { ok: true, text: "1 ACE SPEC" },
        ]}
      />
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-ok", "false");
    expect(items[1]).toHaveAttribute("data-ok", "true");
  });
});

describe("SearchField", () => {
  it("is a labelled search input that reports changes", () => {
    const onChange = vi.fn();
    render(<SearchField value="" onChange={onChange} placeholder="Find a card…" />);
    const input = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(input, { target: { value: "pika" } });
    expect(onChange).toHaveBeenCalledWith("pika");
  });
});

describe("CardTile", () => {
  it("owned tiles show a ×N chip; missing tiles are dashed and dimmed", () => {
    render(<CardTile name="Umbreon ex" subtitle="Prismatic Evolutions · 161/131" price="$1,465.00" quantity={2} imageUrl={null} />);
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Umbreon ex" }).className).not.toMatch(/border-dashed/);
    render(<CardTile name="Pidgeot ex" subtitle="OBF 164" price="$23.35" quantity={0} imageUrl={null} />);
    expect(screen.getByRole("img", { name: "Pidgeot ex" }).className).toMatch(/border-dashed/);
    expect(screen.queryByText("×0")).not.toBeInTheDocument();
  });
  it("is clickable when onClick is given", () => {
    const onClick = vi.fn();
    render(<CardTile name="A" subtitle="s" price="$1" quantity={1} imageUrl={null} onClick={onClick} />);
    const button = screen.getByRole("button", { name: /^A/ });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("CardRow", () => {
  it("renders thumb, name, subtitle, and right-aligned figures", () => {
    render(<CardRow name="Shanks" subtitle="Two Legends · OP08-118" imageUrl={null} right={<span>$204.30</span>} />);
    expect(screen.getByText("Shanks")).toBeInTheDocument();
    expect(screen.getByText("$204.30")).toBeInTheDocument();
  });
});
