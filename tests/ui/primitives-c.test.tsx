// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState, Input, Textarea, MoneyDisplay } from "@/components/ui";

describe("EmptyState", () => {
  it("renders a title heading, body text, and the action node", () => {
    render(<EmptyState title="No cards yet" body="Add your first card to get started." action={<button>Add card</button>} />);
    expect(screen.getByRole("heading", { name: "No cards yet" })).toBeInTheDocument();
    expect(screen.getByText("Add your first card to get started.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add card" })).toBeInTheDocument();
  });

  it("omits the body when not given", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByRole("heading", { name: "Empty" })).toBeInTheDocument();
    expect(screen.queryByText(/get started/i)).not.toBeInTheDocument();
  });
});

describe("Input", () => {
  it("carries the field classes, merges className last, and forwards input props", () => {
    render(<Input aria-label="Collection name" className="max-w-xs" placeholder="New collection…" maxLength={80} />);
    const input = screen.getByLabelText("Collection name");
    expect(input.className).toMatch(/border-hairline/);
    expect(input.className).toMatch(/max-w-xs$/);
    expect(input).toHaveAttribute("placeholder", "New collection…");
    expect(input).toHaveAttribute("maxlength", "80");
  });

  it("with a label it wraps itself in one, so the input is still reachable by label text", () => {
    render(<Input label="Email" type="email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("type", "email");
    expect(input.closest("label")?.className).toMatch(/text-muted/);
  });
});

describe("Textarea", () => {
  it("carries the same field skin as Input, merges className last, and forwards textarea props", () => {
    render(<Textarea aria-label="Decklist" className="min-h-64" rows={4} placeholder="4 Charmander" />);
    const box = screen.getByLabelText("Decklist");
    expect(box.tagName).toBe("TEXTAREA");
    expect(box.className).toMatch(/border-hairline/);
    expect(box.className).toMatch(/min-h-64/);
    expect(box.className).not.toMatch(/min-h-32/); // className wins over the default floor
    expect(box).toHaveAttribute("rows", "4");
    expect(box).toHaveAttribute("placeholder", "4 Charmander");
  });

  it("with a label it wraps itself in one", () => {
    render(<Textarea label="Decklist" />);
    expect(screen.getByLabelText("Decklist").closest("label")?.className).toMatch(/text-muted/);
  });
});

describe("MoneyDisplay", () => {
  it("renders whole dollars in a display-font element and cents dimmed", () => {
    render(<MoneyDisplay amount={4812.4} />);
    const whole = screen.getByText("$4,812");
    expect(whole.className).toMatch(/font-display/);
    const cents = screen.getByText(".40");
    expect(cents.className).toMatch(/text-dim/);
    expect(whole.textContent).toBe("$4,812.40");
  });

  it("renders an em dash for null amounts", () => {
    render(<MoneyDisplay amount={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("applies the lg size class", () => {
    render(<MoneyDisplay amount={12} size="lg" />);
    expect(screen.getByText("$12").className).toMatch(/text-hero/);
  });
});
