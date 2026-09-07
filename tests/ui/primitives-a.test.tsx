// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, Pill, Panel, SectionHeading, StatTile, PriceDelta, ProgressBar } from "@/components/ui";

describe("Button", () => {
  it("renders primary by default and secondary on request, forwards clicks", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Add to binder</Button>);
    const b = screen.getByRole("button", { name: "Add to binder" });
    expect(b.className).toMatch(/bg-chip/);
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalled();
    render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" }).className).toMatch(/border-hairline/);
  });
});

describe("Pill", () => {
  it("is a toggle chip: selected inverts, aria-pressed reflects state", () => {
    render(<Pill selected>30D</Pill>);
    const p = screen.getByRole("button", { name: "30D" });
    expect(p).toHaveAttribute("aria-pressed", "true");
    expect(p.className).toMatch(/bg-chip/);
    render(<Pill>7D</Pill>);
    expect(screen.getByRole("button", { name: "7D" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Panel", () => {
  it("wraps children in a surface with hairline border", () => {
    render(<Panel data-testid="p">x</Panel>);
    expect(screen.getByTestId("p").className).toMatch(/bg-surface/);
  });
});

describe("SectionHeading", () => {
  it("renders a display-font title with optional caption and trailing slot", () => {
    render(<SectionHeading title="Top cards" caption="sorted by value" trailing={<span>List</span>} />);
    expect(screen.getByRole("heading", { name: "Top cards" }).className).toMatch(/font-display/);
    expect(screen.getByText("sorted by value")).toBeInTheDocument();
    expect(screen.getByText("List")).toBeInTheDocument();
  });
});

describe("StatTile", () => {
  it("shows label and value; tone=gain colors the value", () => {
    render(<StatTile label="Gain" value="+$908.25" tone="gain" />);
    expect(screen.getByText("Gain")).toBeInTheDocument();
    expect(screen.getByText("+$908.25").className).toMatch(/text-gain/);
  });
});

describe("PriceDelta", () => {
  it("formats a positive change with ▲ and gain color, negative with ▼ and accent", () => {
    render(<PriceDelta amount={132.1} ratio={0.028} />);
    const up = screen.getByText(/\+\$132\.10/);
    expect(up.textContent).toMatch(/▲/);
    expect(up.textContent).toMatch(/\+2\.8%/);
    expect(up.className).toMatch(/text-gain/);
    render(<PriceDelta amount={-6.8} ratio={-0.15} />);
    const down = screen.getByText(/−\$6\.80/);
    expect(down.textContent).toMatch(/▼/);
    expect(down.className).toMatch(/text-accent/);
  });
  it("renders a neutral em dash when amount is null", () => {
    render(<PriceDelta amount={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("ProgressBar", () => {
  it("clamps value to 0..1 and exposes it via aria", () => {
    render(<ProgressBar value={0.34} label="Set completion" />);
    const bar = screen.getByRole("progressbar", { name: "Set completion" });
    expect(bar).toHaveAttribute("aria-valuenow", "34");
    render(<ProgressBar value={1.7} label="Over" />);
    expect(screen.getByRole("progressbar", { name: "Over" })).toHaveAttribute("aria-valuenow", "100");
  });
});
